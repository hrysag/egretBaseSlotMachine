# 掉落式（Drop）模組：現況評估與前置決議

> 對象：`src/SlotMachine/Core`（尚未實作 Drop）
> v3 對照原始碼：`D:\Tools\project\Game1016\Web_Slot\assets\Scripts\GameScripts\ReelTemplate\v3\Scripts\DropReel`
> 姊妹文件：[Slot-Base-Unit-Refactor-1x1.md](Slot-Base-Unit-Refactor-1x1.md)（主線，決議 1～20、30～32；§2.10 是位置模型為 Drop 預留的那一層）、[Core-Responsibility-Slimming.md](Core-Responsibility-Slimming.md)（決議 21～29）、[Core-Runtime-Flow.md](Core-Runtime-Flow.md)
>
> **本文一律以「類別.成員」指路，不寫行號。**
> 決議編號**由 33 起**接續主線。

---

## 0. 決議摘要

| # | 決議 | 狀態 |
|---|---|---|
| 33 | **消除清單的單位是 group，由遊戲層丟入**；框架不從可視格索引反推整組 | 已定案，未實作 |

> 尚未編號的部分全部列在 §5 未定案。本文目前是**評估**，Drop 尚未動工。

---

## 1. 一句話結論

**架構撐得住，而且比 v3 更適合做 Drop** —— 集中式 Movement、計算式位置、以及已經接在公式裡的 `cellOffset[k]` 三項都到位。

真正的工作量不在幾何，在**把 v3 所有 per-icon 的東西重新推導成 per-group**，以及決議 31（截斷兩端都可能）之後「一個 group 可以有格子在顯示區外」帶來的新狀況。

---

## 2. v3 Drop 實際做了什麼

`UniDropReel` 全檔 183 行，對外三個入口：`startDropOut()` / `startDropIn()` / `startDropRefill()`（各有一個 `…Async` 版本，用 `waitForDropComplete` 這個 resolve 欄位包成 Promise）。

四個核心機制：

| 機制 | 所在 | 內容 |
|---|---|---|
| **每張各走各的距離** | `UniDropReel.getDropCount()` | `DropOut` 一律 `iconAmount`（整條掉出畫面）；`DropIn` / `Refill` 由 `_getRefillDropDistanceByPos()` 以「現在位置 vs 目標索引位置」反推 `Math.round(distance / moveDis)` |
| **等速不等時** | `UniDropReel.drop()` | `dropTime = moveInterval * dropCount`，每張自己一條 `moveBy()`，並各自掛 `dropComplete` callback |
| **瞬移 + 到位換資料** | `UniDropReel.setDropIconTopPos()` | `moveTo(targetPos, 0)` 把要掉入的牌瞬移到上方排隊（彼此間隔 `moveDis * i`），附 callback 在到位時 `setDropIconData()` 才寫入資料 |
| **陣列分割重排** | `UniDropReel.reorderDropIcon()` | `[first, ...dropOutIcons, ...remainIcons, last]`（`inverseDirection` 時對調中間兩段）—— **分割重排，不是旋轉** |

另外兩件值得記的：

- **起點必須是對齊格線的靜止盤面。** `startDropOut()` 開頭固定 `initLayout()` + `resetMovements()`。對應到我們就是 `stripOffset === 0`。
- **頭尾兩張不參與。** `reorderDropIcon()` 用 `slice(1, length - 1)`、`getRefillIdList()` 的範圍是 `1 … length - 1`。v3 的預備牌只有頭尾各一張；我們兩端各有 `maxCellSpan` 格，餘裕更大。
- **狀態機只有四個值。** `DropType.NoDrop / DropOut / DropIn / Refill`，掛在 `UniDropIconBase._dropType` 上；`dropComplete()` 把它設回 `NoDrop`，全部都是 `NoDrop` 時 resolve。

多軸層 `UniDropSlotMachine` 只是把 `number[][]`（逐軸的索引清單）往下發，自己不做判斷。

---

## 3. 我們已經備好的部分

### 3.1 `cellOffset[k]` 真的接在公式裡

決議 18 不是只寫在文件上，`ReelIconManager.getAxisPosition()` 的實作就是：

```ts
return this.getBaseAxisPosition(index)
    + this._stripOffset
    + cellOffset
    + this._visualAxisOffset;
```

主線 doc §2.10 的分層因此直接成立：

| 階段 | 位移來源 |
|---|---|
| 滾動期 | `stripOffset`（整軸統一），`cellOffset[k]` 全為 0 |
| 靜止 | `stripOffset === 0`，每格精確落在格線 |
| 掉落期 | `cellOffset[k]`（每格各自），`stripOffset === 0` |

### 3.2 集中式 Movement 是 Drop 能移植的**前提**，不是障礙

v3 靠 `UniIconBase extends UniMovement` 讓每張 Icon 天生是一條 Movement。Egret 沒有 Component，**這條路不通**。

我們的 `BaseMovement` 是純值物件，不碰顯示、不繼承任何東西，要做 Drop 時由 Reel 持有一組 `BaseMovement[]` 即可，`BaseReelIcon` 依然什麼都不必繼承。

### 3.3 其餘三項

| 項目 | 現況 |
|---|---|
| 固定長度、雙陣列同索引 | `ReelIconManager._symbols` ↔ `_icons` 永久同索引配對，分割重排是純陣列操作，兩條一起重排即可 |
| 顯示層級 | `ReelIconManager.sortIconDisplayLayers()` 已存在（決議 19），對應 v3 的 `changeSibling()`。掉落期大量重疊時需要它 |
| 掉落起點 | `stripOffset === 0` 與 v3 的 `initLayout()` 語意相同；`ReelIconManager.resetMovement()` 對應 `resetMovements()` |

---

## 4. 連續牌（group）逼出來的問題

這是 v3 完全沒有的維度 —— v3 沒有大 Symbol，所以它全部的操作都可以是 per-icon。

### 4.1 Drop 的單位必須是 group，不是 cell

一張 1×3 佔三格，**三格必須同時、同距離移動**。

有一個反直覺的陷阱要先寫下來：**圖是 head 畫的，follower 不畫**（§2.2）。所以如果只有 head 動、follower 沒動，**畫面上看起來完全正常** —— 錯誤要到掉落結束、重新滾動、`resolveGroupOffset()` 依鄰居推導時才爆出來。這種 bug 極難追，必須從設計就擋掉。

因此 `dropType`、掉落距離、`BaseMovement` 全部要以 group 為單位，或強制同組共用同一份值。

### 4.2 決議 33：消除清單的單位是 group，由遊戲層丟入

v3 的 `removeIdList` / `dropOutIdList` 是**可視格索引**。若沿用，框架必須把「第 3 格」展開成「那一整組」，而決議 31 之後這件事會跨出可視區：

```text
可視格 [1, 2, 7]，7 是 1×3
        ╞════════╡
 可視   │   1    │
        │   2    │
        │  7:0   │ ← 遊戲層說「消除第 3 格」
        ╞════════╡
 退場   │  7:1   │ ← 但要動的是三格，
 buffer │  7:2   │    其中兩格玩家看不到
        └────────┘
```

**決議：遊戲層直接丟 group，框架不做展開。**

| | 遊戲層丟 group（採用） | 遊戲層丟可視格（否決） |
|---|---|---|
| 框架負擔 | 不必展開、不必驗證聯集完整性 | 要展開、要驗證、要處理跨出可視區的格 |
| 遊戲層負擔 | 要知道 group 結構 | 與 v3 介面一致 |
| 錯誤型態 | 遊戲層丟錯 → 可當場驗證並 throw | 框架默默展開出玩家沒預期的結果 |

遊戲層要取得 group 結構，現成入口是 `BaseReel.symbols`（讀 `groupOffset`）、`BaseReel.firstVisibleIndex` 與 `BaseReel.getGroupIcons()`。**`getGroupIcons()` 已實作**（主線 doc §3.9），但 Drop 要動的是每格的 `cellOffset`，那在 Runtime 上不在 Icon 上 —— **還缺一個回傳 Runtime 的同組入口**（`getGroupRuntimes()`），那是 Drop 的第一個相依。

### 4.3 `groupOffset` 的推導規則撐不住 refill

`ReelIconManager.resolveGroupOffset()` 有一個隱含前提：**一次一格、從進場端進來、朝退場方向的鄰居已經綁好了**。

refill 完全不是這樣 —— 一次多格、落在任意索引、資料在「到位 callback」裡才寫進去，當下鄰居可能還沒綁。這與第二棒踩過的 `replaceEntryPreparationData()` 綁定順序反了那個 bug 是同一類問題。

**方向**：改成**批次推導** —— 對受影響的區段整段從退場端往進場端掃，與 `ReelDataFlow.createGroupCompletionCells()` / `createExitTruncationCells()` 同一套做法。不採用「嚴格規定寫入順序」，那是靠紀律而不是靠結構。

### 4.4 分割重排不能切斷 group

`reorderDropIcon()` 把陣列切成兩堆再接起來，**每一堆內部是保序的**。所以只要一個 group 不會被拆到兩堆去，重排後它仍然連續且順序正確，存著的 `groupOffset` 依然有效。

這正是決議 33 的另一種說法：**清單以 group 為單位，重排就安全**；反之會直接製造孤兒 follower。

### 4.5 refill 的資料來源要整組取

我們的資料佇列是逐 Cell 展開的（§2.0）。v3 的 `setDropIconData()` 是 `getData()` 逐張取；照抄會取到「一張 1×3 的其中一格」，那就是決議 30 與 §3.5 剛修完的「殘組」問題換到掉落路徑上再來一次。

`ReelDataFlow.takeNextPerformanceSymbol()` 那條搜尋可以重用，但需要一個**「取一整組」的公開入口**。

---

## 5. 未定案

- **滾動計數器要怎麼隔離。** `ReelIconManager._travelledCellCount` / `_handedOffCellCount` 是滾動期的計數器，交接完全靠它們驅動（決議 15）。掉落**不走 handoff**，這兩個值在掉落期間不能被碰到，掉落結束要 `resetMovement()` 歸零。v3 沒有對應物可抄。
- **退場 buffer 被掉空之後補什麼。** 決議 31 之後，被截斷的 group 有格子住在退場 buffer；整組掉出去之後那幾格要補什麼、從哪裡補，沒有先例。
- **`DropType` 狀態機放哪一層。** v3 掛在 `UniDropIconBase._dropType`（Icon 上）。我們的 `BaseReelIcon` 是純空殼，狀態機掛在 `ReelSymbolRuntime` 或 Reel 持有的並行陣列上都可以，未定。
- **`BaseMovement[]` 的歸屬與數量。** 每 group 一條，還是每 cell 一條但同組共用參數，未定。
- **掉落期的 `displayPriority`。** 多個 group 以不同速度交錯時，`sortIconDisplayLayers()` 的穩定排序夠不夠用，未實測。
- **Drop 與停輪流程的邊界。** v3 的 Drop 完全繞開 `moveOnce` 循環；我們的 `BaseReel` 主線（`_secondHalfCompleteHandler` 那三段）在掉落期要整段停用，`ReelState` 需不需要多一個狀態，未定。
- **多軸掉落的同步。** `UniDropSlotMachine` 只是把 `number[][]` 往下發，各軸自己跑；我們有唯一心跳（`BaseSlotMachine._tickHandler`），同步條件比 v3 好，但沒設計過。

---

## 6. 建議的動工順序

1. `getGroupRuntimes()` —— `getGroupIcons()` 已實作（主線 §3.9），走訪邏輯現成（`ReelIconManager.getGroupIndexRange()`），只差一個回傳 Runtime 的公開入口
2. `groupOffset` 的批次推導（§4.3）—— 把現有的單格規則抽成可以整段跑的版本
3. 「取一整組表演資料」的公開入口（§4.5）
4. `DropType` 與 `BaseMovement[]` 的歸屬決定（§5）
5. `startDropOut()` —— 三個入口裡最單純的（距離固定 = 整條掉出），先把分層與計數器隔離驗證起來
6. `startDropIn()` / `startDropRefill()`
