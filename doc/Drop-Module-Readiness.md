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
| 33 | **消除清單的單位是 group，由遊戲層丟入**；框架不從可視格索引反推整組。**2026-09-26 字面修正**：遊戲層傳該組在畫面上露出的全部格子（可視格索引），缺格就報錯，框架連同畫面外的格子整組消除（見 §7.4 Q1） | 已定案，未實作 |

> 尚未編號的部分全部列在 §5 未定案。本文目前是**評估**，Drop 尚未動工。
>
> **§7 是 2026-09-26 依現況（決議 34～48 落地後）重新盤整的結果**，其中有兩處更正 §4.5 與 §5，讀 §4～§6 時請一併看 §7。
> **§7.6 已定案**：Drop 單獨使用是純掉落，透過組合（滾輪 Icon 內包掉落軸，參考 Game1024）變成先滾再掉；另開 `src/SlotMachine/Drop/`，不與滾動共用機台與 Reel。

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

> 這個順序在 §7 盤整後仍然成立，但第 2、3 步之前要先回答 §7.4 的 Q1～Q3。

---

## 7. 現況盤整（2026-09-26）

> 基準：`ad47b91` 加上未 commit 的決議 41～48（斷言 281 項）。
> 本節原本只記事實與問題；之後逐題討論定案的結果直接寫在各題之下。
>
> **目前進度（2026-09-28）**：§7.6 資料夾與組合方式已定案；§7.4 Q1～Q7、§7.6 的 Q10 已定案，Q8、Q9 隨 §7.6 消失／回答；**下一題 Q11**。

### 7.1 已備好的底層（逐項對過程式碼）

| 項目 | 現況 | 所在 |
|---|---|---|
| 每格偏移 | `cellOffset` 接在位置公式裡；回收、改綁時歸零 | `ReelIconManager.getAxisPosition()`、`recycleExitedCell()`、`rebindEntryRuntime()` |
| 數值動畫 | 純值物件，有 `moveTo` / `moveBy` / `addCallback` / 自訂 easing / `TIME_EPSILON` | `BaseMovement` |
| 停輪後仍有心跳 | `init()` 就開始跳、只有 `cleanup()` 才停；`update()` 每幀推進**每一個** `inited` 的軸，不管在不在轉 | `BaseSlotMachine.init()` / `update()` / `cleanup()` |
| 同組走訪 | 以「id 相同且 `groupOffset` 連續」往兩邊走，自然停在 strip 邊界 | `ReelIconManager.getGroupIndexRange()`（**私有**） |
| 整段推導 `groupOffset` | 對齊的整段：`expandSection()`；截斷的兩端：`createGroupCompletionCells()` / `createExitTruncationCells()` | `ReelIconManager`、`ReelDataFlow` |
| 取指定大小的表演牌 | 同一條搜尋，差在判斷式 | `ReelDataFlow.takeNextPerformanceSymbol()`（**私有**；公開的只有 1×1 版 `takeSingleCellPerformanceSymbol()`） |
| 不碰引擎的斷言環境 | 測試子類別覆寫 `startTicking()`，時間是決定性的 | `tests/CoreGeometry.test.ts` 的 `HeadlessSlotMachine` |
| 遮罩 | 蓋在機台上（決議 36），掉入前排在顯示區外的格子自然被遮住 | `BaseSlotMachine` |

### 7.2 評估寫完之後才落地、會影響 Drop 的決議

| 決議 | 影響 |
|---|---|
| 34 | Icon 的「我是什麼」只有換人才推。若掉落時只重排 `_symbols`，大量 Icon 會在掉落開始那一幀同時被 `setData()` 換圖 —— 見 Q5 |
| 39（未實作） | 表演物件每幀跟著 Icon 的 worldPos。掉落中 Icon 會移動，方向相容；但 Icon 若在掉落開始時被換內容，表演物件會跟錯人 —— 同 Q5 |
| 41 | 自動旋轉歸遊戲流程層。**連消的「消 → 判獎 → 補 → 再判」迴圈同理**，框架只給單步入口；v3 的 `UniDropSlotMachine` 也只是往下傳清單，對得上 |
| 44／48 | 多軸掉落的軸間隔：v3 用 `startSpaceTime`（掉出）與 `stopDropSpaceTime`（掉入），Turbo 時不等。原本列為 Q8，已隨 §7.6 消失 |

### 7.3 對 §4.5 與 §5 的更正

**① §4.5「refill 的資料來源」寫錯了來源。** v3 的 `setDropIconData()` 呼叫 `UniReel.getData()`，
它讀的是 `this.data` 佇列，**佇列是遊戲層用 server 盤面填的**
（`UniDropReelView.startDropIn()` / `startDropRefill()` 逐軸先呼叫 `setReelDataCallback(index, resultData[index])`）；
隨機牌只是佇列空了的後備（`createRandomSymbol()`）。

所以掉進顯示區的格子，資料來自 **server 盤面**，不是表演牌庫。表演牌庫（與「取一整組」的入口）只用在**顯示區外**的 buffer 格。
§4.5「不能逐格取、要整組取」的結論仍然對，只是對象從表演牌庫換成 server 盤面。

**② §5 第一項「滾動計數器要怎麼隔離」在結構上已經成立。** `ReelIconManager.applyMovementValue()` 唯一的呼叫點是
`BaseReel._movementValueChangedHandler`，也就是只有滾動用的那條 `_movement` 會動到兩個計數器；`startRoll()` 開頭又會
`resetMovement()`。所以只要掉落**不借用 `_movement`**，計數器就碰不到。這從「未定案」降為「實作約束」。

### 7.4 讀完才冒出來的問題

依相依順序排列。**全部未定案。**

**Q1　消除清單用什麼表示 → 已定案（2026-09-26）**

**遊戲層傳畫面上的格子位置**（逐軸、畫面閱讀順序的可視格索引，例如 `[0, 2]`），與伺服器給的中獎位置同一種格式，不用轉換。

規則只有兩條：

1. **大圖在畫面上露出的格子必須全部列上**，只列一部分就報錯（throw），框架不猜
2. **整組一起消**：列齊之後，框架連同該組在畫面外、沒露出的格子一起消掉

```text
畫面 3 格，7 佔 3 格
畫面外   7 的第 1 格   ← 沒露出，一起消掉
─────────────
畫面     7 的第 2 格   ← 遊戲層列這格
         7 的第 3 格   ← 遊戲層列這格
         1
─────────────
遊戲層傳 [0, 1] → 整張 7 消掉
```

不採用的做法：傳框架內部的 `ReelSymbolRuntime` 或 strip 索引 —— 遊戲層得懂框架內部的排列順序，而且一掉落就會變，容易拿到舊的。

**未查證的前提**：伺服器對大圖的中獎位置會不會列出露出的每一格。1016、1024 的掉落都沒有大圖，查不到；若伺服器只給一格，由遊戲層補齊再傳，框架照樣只收完整的。

> 與決議 33 的關係：原意（以整組為單位、丟錯當場擋下）不變；字面由「遊戲層丟 group」改為「遊戲層丟該組露出的全部格子，框架驗證完整後整組消除」。
> §4.2 表格裡否決「丟可視格」的理由，在「缺格就報錯」之後不再成立。
> 消完之後上面的牌掉幾格、畫面外空出的位置補什麼，是 Q2。

**Q2　被截在退場端的 group 被消掉時，上面的格子掉幾格 → 已定案，見本題末段。** 照 strip 索引算會錯：

```text
可視 3、maxCellSpan 3。可視 = [1, 2, 7:0]，7 是 1×3，7:1、7:2 在退場 buffer
消掉 7 → strip 上空出 3 格（idx5～7）

照索引掉 3 格：1、2 掉進退場 buffer 看不見，顯示區換成原本進場 buffer 的表演牌
玩家預期：    可視只少了 1 格，1、2 各往下掉 1 格
```

掉落距離要以**顯示區內被消掉的格數**計，退場 buffer 裡被掉空的那幾格要另外補 —— 這就是 §5 第二項，現在有具體例子了。
進場端截斷（head 在進場 buffer、follower 在顯示區）是鏡像情況，要一起定。

**→ Q2 已定案（2026-09-26），依據是 v3 底層與 1024 的實際做法：**

v3 `UniDropReel.startDropRefill()` 的步驟：被消掉的 Icon 搬到畫面上方排隊（`setDropIconTopPos()`，一格疊一格）→
內容從佇列取（`getData()`，佇列由遊戲層先用 server 資料填好）→ 陣列重排（`reorderDropIcon()`）→ 每張依自己的距離等速掉（`drop()`）。
最上面那張預備牌不動、不換內容（`getRefillIdList()` 從 1 起算）。

1024 的 server 資料每軸兩份，**數量相同**：要消的位置 `removeData`、補進來的新牌 `reFillData`
（`ProcessSlotData1024.getWinRemoveDataForGame()` / `getReFillDataForGame()`；`TestMain` 註解的例子
`[[1,3,5],[3],[1,2]…]` 對 `[[0,0,5],[6],[10,3]…]`）。

| 牌 | 來源 |
|---|---|
| 原本就在畫面上、位置比消除處高的牌 | 不換內容，只往下掉 |
| 從上方掉進畫面的新牌 | **server 給的**，數量 = 該軸**畫面上**消掉的格數 |
| 畫面外的預備格 | 不動，玩家看不到 |
| 大圖被消掉後，畫面外空出來的格子 | **框架補**（玩家看不到；用什麼牌實作時再定）。v3／1024 沒有大圖，沒有這種情況 |
| server 補的新牌是大圖、只露出一部分（頭在畫面外） | **框架把畫面外那部分補齊** |

```text
畫面外   7 的第 1 格   ← 一起消掉，空出來；server 不知道這格 → 框架補
─────────────
畫面     7 的第 2 格   ← 消
         7 的第 3 格   ← 消
         1
─────────────
server 給 2 張新牌 → 從上方掉進畫面前 2 格
```

**Q3　進場 buffer 在補牌時的角色 → 隨 Q2 定案。** 進場 buffer 裡是表演牌，玩家沒看過，**不跟著掉**；
掉進畫面的新牌從它更外面進來（與 v3 最上面那張預備牌不動相同）。
推論（未另外討論）：畫面上的大圖往下掉時整組一起掉 —— 若它的頭在進場 buffer、身體在畫面上，頭也跟著掉，不能拆開。

**Q4　掉入的盤面若含截斷的大 Symbol → 已定案，見本題末段。** 「整盤掉出 → 整盤掉入」（`startDropOut` → `startDropIn`）等於不經滾動直接換盤面。
若 server 盤面頂端或底端是半組大圖，兩端補格（決議 31）要不要、怎麼套用。連消遊戲的盤面實務上會不會出現截斷的大圖，要先確認。

**→ Q4 已定案（2026-09-26）：補齊。** 整盤掉入時，server 盤面的最上面或最下面若是半張大圖，框架把畫面外那部分補齊
（與 Q2「server 補的新牌是半張大圖時補齊」同一條規則；做法沿用滾動時的兩端補格）。
連消盤面實務上會不會出現半張大圖仍未查證，但框架照樣支援。

**Q5　掉落時兩條陣列要不要一起重排 → 已定案（2026-09-28）：一起重排，見本題末段。**（2026-09-27 更新：滾動已改成牌掛在空殼上、跟著空殼走，與 Cocos 版相同，經過另記在
[SESSION-2026-09-27-Rolling-Fixes.md](SESSION-2026-09-27-Rolling-Fixes.md)。所以「兩條一起重排」與滾動的做法一致，不再是例外。）

| | 只重排 `_symbols` | 兩條一起重排 |
|---|---|---|
| 掉落開始那一幀 | 大量 Icon 同時換圖（位置用 `cellOffset` 補回，看起來不變） | Icon 帶著自己的內容一起掉 |
| Icon 上的動畫、決議 39 的表演物件 | 跟錯人 | 跟著對的 Symbol |
| 之後滾動 | 不受影響 | 槽位順序被打亂，但配對本來就只看索引，也不受影響 |

**→ Q5 已定案（2026-09-28）：資料與空殼一起重排。** 牌掛在空殼上、跟著空殼走 —— 空殼帶著自己的牌一起往下掉；
被消掉的空殼搬到進場端（上方）的預備區、換上新牌再掉進來。

- 與滾動一致（`ReelIconManager.rotateExitedIconToEntry()`，兩條陣列一起轉）
- 與 v3 一致：`UniDropReel.startDropRefill()` 把被消掉的 Icon 搬到上方排隊（`setDropIconTopPos()`）、換內容，再由 `reorderDropIcon()` 重排
- 只重排資料會讓掉落開始那一幀大量空殼同時換圖，掛在上面的動畫與決議 39 的表演物件跟錯牌，不採用

**Q6　掉落期間的狀態與守衛 → 已定案（2026-09-28），見本題末段。** 掉落發生在 `ReelState.Stopped`，但 `startRoll()`、`setInitialLayout()`、`reconfigureStoppedLayout()`
在掉落途中都不會被擋。要新增 `ReelState`，還是比照停止效果用一個 `active` 旗標擋（`startRoll()` 第一行就是這樣擋停止效果的）。
順帶：`reconfigureStoppedLayout()` 連停止效果都還沒擋（主線 §6 已記）。
> **隨 §7.6 改寫**：Drop 不繼承 `BaseReel`，上面這幾個滾動入口不會出現在掉落軸上。剩下的是掉落軸**自己**的狀態：
> 掉落途中能不能再下一次掉落指令、能不能重設盤面。「要新增狀態還是用旗標」的問題照舊。

**→ Q6 已定案（2026-09-28）：**

- 掉落軸自己持有一個「掉落中」旗標，**不新增 `ReelState`**（掉落軸不繼承 `BaseReel`，用不到滾動的狀態）
- 掉落途中再下掉落指令、或重設盤面 → **直接 throw**，與滾動「轉動中再 `startSpin()` 就 throw」同一種做法
- 遊戲層以 `await` 等掉落結束再做下一步
- **不做掉落急停**（跳過動畫直接到位）；v3 也沒有，之後有需求再加

依據：v3 `UniDropReel` 完全沒擋 —— 掉落途中再呼叫，`waitForDropComplete` 被新的 resolve 蓋掉，第一次的 `await` 永遠不會結束；
`moveBy()` 疊在還沒走完的指令後面，牌走到錯的位置。

**Q7　每幀誰把位置推給 Icon、查詢 API 在掉落期代表什麼 → 已定案（2026-09-28），見本題末段。**
- `syncAllIcons()` 目前只由滾動 `_movement` 的 `onValueChanged` 觸發，掉落要有自己的觸發點（隨 §7.6：放在掉落軸自己的每幀入口，見 Q10）
- `getVisibleIcons()` 只看 `stripOffset`；`isAligned()` 不看 `cellOffset`。掉落途中兩者的答案都不代表畫面（若掉落軸共用 `ReelIconManager` 才有這個問題）

**→ Q7 已定案（2026-09-28）：**

1. **位置由框架算，不讓 Icon 自己動**（v3 是每個 Icon 自帶移動指令）。位置 = 第 k 格基準位置 + `cellOffset[k]`（決議 18 預留的那一層）
   - 每一組一條移動，推的是該組的 `cellOffset`，從掉落距離歸零（§7.5：同組掉落距離相同）
   - 掉落軸每幀先推進全部移動，再**一次**把位置推給全部空殼
   - 每幀由誰呼叫掉落軸的更新，歸 Q10
2. **掉落途中查詢回傳掉完之後的盤面**，不擋、不 throw，寫進 API 說明。
   Q5 定了掉落一開始就把資料與空殼重排好、以 `cellOffset` 補回畫面位置，所以索引查到的就是最終盤面；
   v3 同樣在掉落開始時 `reorderDropIcon()`，查到的也是掉完的結果。遊戲層判獎本來就要最終盤面

**Q8　~~多軸掉落的軸間隔從哪來~~** → **隨 §7.6 消失**：掉落有自己的機台，不沿用 `SlotMachineSpinConfig`，軸間隔由掉落自己的設定定義（內容仍待定）。

**Q9　~~放在哪一層~~** → **由 §7.6 回答**：Drop 另開 `src/SlotMachine/Drop/`，不塞進 `ReelIconManager`，也不繼承 `BaseReel`。
連帶影響決議 21：若 Drop 要共用 `ReelIconManager` 的 strip，決議 21「strip 收回 `BaseReel`」會把它綁進滾動那一側，
屆時要改寫成「strip 獨立成共用類別」。共用與否在實作 Drop 時再定，決議 21 目前不動。

### 7.5 已確認的一條好性質

**決議 33 保證同一組的每一格掉落距離相同。** 某格的掉落距離 = 它朝退場方向那一側被消掉的格數；
同組的格子彼此相鄰，只要被消掉的格子不落在組內（清單以 group 為單位就不會），它們看到的被消格數就相同。
所以「每組一條 Movement」和「每格一條但數值相同」在數學上等價，§5 第四項可以純粹依實作方便來選。

### 7.6 資料夾與組合方式（2026-09-26 與使用者討論定案）

**定案**：Drop **單獨使用是純掉落**，**透過組合可以變成「先滾出盤面，再掉落」**。滾動與掉落**不共用同一組機台與 Reel**。

#### 參考：Game1024 的組合方式（已讀原始碼）

`D:\Tools\project\Game1024\assets\Game1024\Script\Slot`。組合**不是同一條 strip 又滾又掉，而是一層包一層**：

```text
UniSlotMachine1024 / UniReelView1024        外層：普通滾輪機台
 └ UniReel1024（每軸可視 _iconAmount = 1）   場景存檔 7 軸都是 1
    └ UniIcon1024                            外層的一格 = 一整軸
       └ UniDropReel1024                     Icon 裡包一個掉落軸（原始碼註解：「1個icon裡面有一個dropReel」）
          └ UniDropIcon1024                  真正的 Symbol
```

| 事實 | 所在 |
|---|---|
| 外層滾的是「整軸」；外層 Symbol 的 `symbolID` 是**這一軸有幾格**（2～7，Megaways 形式） | `UniReel1024.createRandomSymbol()` / `setData()` |
| 外層 Icon 一收到 Symbol 就依格數重建裡面的掉落軸 | `UniIcon1024.symbol` setter → `setDropReelLength()` → `UniDropReel1024.changeDropReelSize()` + `reSetReelContent()` |
| 結果那一格靠旗標辨認：取到結果時 `setResultData()` 把 `isResultIcon` 設成 true，停輪後再逐格找 | `UniReel1024.getData()`、`getCurrentResultDropReel()` |
| 連消**只用補牌**，沒有用到掉出／掉入（註解：「這裡不會有startDropIn<因為是整軸掉落>」） | `UniReelView1024.startReFillDrop()` → `UniReel1024.startDropRefill()` |
| 掉落軸節點上有自己的 `Mask` | `UniDropReel1024.setInitData()` |
| 掉落軸沒有大 Symbol | 全檔無 cellSpan 概念 |
| wild 撐開整軸（`setWildFillSymbol()` / `updateExpand()`）動態增加格數與改格高 | `UniDropReel1024`，看起來是遊戲專屬 |

v3 本身是繼承（`UniDropReel extends UniReel`、`UniDropSlotMachine extends UniSlotMachine`），掉落機台因此背著整套滾動，
`UniDropReelView.fastStopRoll()` 還要覆寫成空的來關掉滾動那一支。1024 的組合其實**沒有用到**這層繼承帶來的滾動能力。

#### 資料夾

```text
src/SlotMachine/
  Core/        現有，先不搬：滾動 + 共用零件
  Drop/        新增：BaseDropReel、BaseDropSlotMachine、Config/、Internal/
```

- **相依單向**：`Drop` 可以引用 `Core` 的共用零件（`BaseReelIcon`、`ReelSymbolRegistry`、`SymbolData`、`ReelData`、`BaseMovement`、`NumberAssert`，視需要加 `ReelIconManager`）。`Core` **不得**引用 `Drop`。
  以上零件已查過 import，都不依賴滾動
- **分兩步**：先只新增 `Drop/`，現有檔案一個都不搬；等 Drop 成形、共用邊界確定，再考慮把滾動搬進 `Roll/`。現在搬會牽動測試的 import 與所有文件裡的路徑
- **組合放在遊戲層**：「先滾再掉」由遊戲層的 Icon 把掉落軸包進去，框架不另開「滾＋掉」類別。示範放 `src/test/`，與 `TestSlotMachine` 同一層
- **結果路由不需要旗標**：`SymbolData` 允許遊戲層擴充欄位，外層結果那一格的資料可以直接帶整軸盤面（例如 `{ id: 5, column: [...] }`），
  Icon 在 `setData()` 收到什麼就顯示什麼，不需要 1024 的 `isResultIcon`

小瑕疵：`BaseReelConfig` 混著幾何與啟動／停止效果。Drop 若要共用設定，可能要把幾何那一半拆出來。

#### 組合方式帶出的新問題（未定案，接在 Q1～Q9 之後）

**Q10　內嵌時誰推時間 → 已定案（2026-09-28），見本題末段。** 掉落軸要有與決議 37 同形狀的 `update(deltaTime)`。單獨使用時由掉落機台的心跳推；
內嵌在外層 Icon 裡時，外層的 `BaseReel.updateMovement()` 不會推 Icon 的內容物，要另外定誰推。

**→ Q10 已定案（2026-09-28）：掉落軸只由掉落機台推，不靠外層空殼。**

- 掉落機台與滾動機台同形（決議 37）：`update(deltaTime)` 推進全部掉落軸，預設自帶 `egret.startTick` 心跳，遊戲層可覆寫 `startTicking()` 改由自己驅動
- 單獨使用與內嵌都是同一台掉落機台在推 —— 內嵌時遊戲層照樣建一台掉落機台管那些掉落軸（顯示層級不歸它，見 Q11）
- 畫面上會有兩個心跳（滾動機台、掉落機台），都來自同一個 Egret ticker，每幀 deltaTime 相同；1024 也是外層停下之後才掉落，兩者先後不影響

參考：v3／1024 沒有這個問題 —— Cocos 引擎每幀自動呼叫每個元件的 `update()`（`UniMovement.update()` 在 `updateSelf` 時自己 `updateMove()`），
內嵌的掉落 Icon 自己會動。Egret 沒有逐元件自動更新，所以要明定由誰推。

**Q11　與決議 36 的衝突：收養 → 暫定（2026-09-28），見本題末段。** 決議 36 是「機台 `init()` 把 Reel 收成子項」。內嵌時掉落軸的父層是外層 Icon，
不能被掉落機台收養 —— 掉落機台要能**只管時序、不管顯示層級**。

**→ Q11 暫定（2026-09-28）：** 掉落機台與滾動機台同形（顯示物件、`init()` 預設收養）；另加設定「不收養」，內嵌時打開，
掉落軸留在原本的父層、機台只管時序。不採用「已有父層就不收」的自動判斷（太隱晦）。不收養時機台層 mask 無意義，mask 歸 Q12。

**Q12　mask 要跟著掉落軸走。** 外層滾動時畫面同時露出兩格外層 Icon，內嵌掉落軸的預備格會蓋到隔壁那一格，
所以掉落軸要有自己的裁切（1024 也是這樣做）。這與決議 36「mask 蓋在機台、不逐軸」不同，要定單獨使用時 mask 放哪、內嵌時放哪。

**Q13　每輪改可視格數與格高。** 1024 每輪依 2～7 格重建整個掉落軸。我們的 `visibleCellCount` / `cellSize` 在 `init()` 定死、
strip 長度與 Icon 數量固定（主線 §2.0）。要不要支援「每輪重設格數」是需求問題。

**Q14　wild 撐開。** 1024 的 `updateExpand()` 動態增加格數並改格高。傾向歸遊戲層，**未查證前不下結論**。

**Q15　內嵌時每輪要掉落的軸不同。** 1024 是外層每個 Icon 裡各有一個掉落軸，外層滾動時 Icon 會輪替，
每輪停在結果位置、真正要掉落的是不同的掉落軸（1024 停輪後用 `getCurrentResultDropReel()` 逐格找）。
但掉落機台管哪些軸在 `init()` 時就定死，要另外定怎麼對應。（2026-09-28 討論 Q11 時發現）

> 1024 沒有大 Symbol，所以 Q2～Q4（大 Symbol 的掉落距離與兩端 buffer）它驗證不到。這些問題照樣保留。

### 7.7 雛形（2026-09-28）

使用者決定：主要規則已定，先寫雛形，有問題實際跑起來再討論。

| 檔 | 內容 |
|---|---|
| `src/SlotMachine/Drop/BaseDropReel.ts` | 單軸：`startDropOut()` / `startDropIn(board)` / `startDropRefill(removePositions, refillCells)`、`update(deltaTime)`、查詢 |
| `src/SlotMachine/Drop/BaseDropSlotMachine.ts` | 多軸：`dropOut(fastMode)` / `dropIn(boards, fastMode)` / `dropRefill(...)`、心跳、收養設定 |
| `src/SlotMachine/Drop/Config/` | `DropReelConfig`、`DropSlotMachineConfig`（`adoptReels`、掉出／掉入軸間隔） |
| `ReelIconManager.reorderCells()` | Core 唯一新增：資料與空殼照同一個順序重排 |

- 與滾動共用 strip 模型（`ReelIconManager`），牌一律往退場端掉；每組一條 `BaseMovement` 推 `cellOffset`，等速不等時（掉 n 格花 n × moveInterval）
- 已照定案實作：Q1（畫面位置、整組列齊）、Q2（新牌張數 = 消掉的格數）、Q5（一起重排）、Q6（途中 throw、無急停）、Q7（位置由框架推、查詢回傳掉完的盤面）、Q10（機台推）、Q11 暫定（`adoptReels`）
- 軸間隔照 v3：掉出、掉入各一個間隔，Turbo 不等；補牌全軸同時
- 斷言 294 → **314**（§12～12d，20 項）；讓重排時空殼不跟著動，紅 4 項

**雛形未支援、遇到就 throw**：被畫面邊緣截斷的大圖（頭或尾在 buffer 裡）—— 牽涉 Q2／Q4「框架補齊畫面外那部分」。

**還沒處理**：Q12 mask（目前照滾動，機台或單軸 `createDisplayMaskRect()`）、Q13、Q14、Q15；測試場景還沒有掉落示範，沒在瀏覽器跑過。
