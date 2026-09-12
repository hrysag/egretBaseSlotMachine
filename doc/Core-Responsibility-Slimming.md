# 責任重劃與瘦身：量測結果與決議

> 對象：`src/SlotMachine/Core`
> 對照基準：`D:\Tools\project\Game1024\assets\Scripts\GameScripts\ReelTemplate\v3\Scripts`
> 姊妹文件：[Slot-Base-Unit-Refactor-1x1.md](Slot-Base-Unit-Refactor-1x1.md)（主線，決議 1～20 不在此推翻）
> 執行期流程：[Core-Runtime-Flow.md](Core-Runtime-Flow.md) —— 決議 21／22 的第三項證據記於該文 §3
>
> **本文一律以「類別.成員」指路，不寫行號。** 行號會被重排洗掉，指錯比不指更糟。
> 所有數字皆為實測，量法見 §1，可重現。

---

## 0. 決議摘要（接續主線 doc 的編號）

| # | 決議 | 狀態 |
|---|---|---|
| 21 | **`ReelIconManager` 縮成純顯示層**；strip 陣列、group 歸屬、strip 幾何、對齊驗證全部移回 `BaseReel` | 未執行 |
| 22 | 介面方向反轉：改由 `BaseReel` **推**算好的位置給 `ReelIconManager`，不再由後者提供 7 個唯讀 getter 讓前者去拉 | 未執行 |
| 23 | **幾何不動。** 位置計算經量測僅 49 行（v3 為 21 行），健康，不列入瘦身範圍 | — |
| 24 | **Movement 不動。** `BaseMovement` + `ReelAxisEffect` 對上 `UniMovement` 只多約 54 行，卻多了時間控制且讓 Icon 不必繼承它 | — |
| 25 | 決議 21 **不減行數**，目的是讓類別名稱對得上內容；減行另由 §4 三條槓桿負責 | — |
| 26 | **`handoffOneCell()` 只負責循環**，停輪規劃獨立成 `tryCommitResultAtBoundary()`，對齊 v3 `moveOnceComplete` 與 `setIconData` 的分工 | **已執行** |
| 27 | **`BaseReel` 依主題分區、主線前移**；`init()` 拆成三個具名步驟，class JSDoc 標明主線讀法 | **已執行** |
| 28 | **重複的可變狀態收斂成單一來源**：`moveInterval` 三份 → 一份，`layoutType` / `inverseDirection` 兩份 → 一份 | **已執行** |
| 29 | `_quickStopRequested`（機台層 vs 軸層）與 `cellPitch`（Manager 與各 Icon）**不合併** —— 前者是不同作用域的不同值，後者設定一次即不變，都不是會分歧的重複 | — |

---

## 1. 量測方法（可重現）

行數比較若只用 `wc -l` 會嚴重失真 —— v3 的註解密度是我們的兩倍以上。本文一律改用**實際程式碼行數**：

> 排除三種行：空行、純註解行（`//`、`/* */` 區塊內）、只有收尾符號的行（`}`、`)`、`];`、`,`）。

```js
function codeLines(lines) {
    let n = 0, inBlock = false;
    for (const raw of lines) {
        const s = raw.trim();
        if (s === '') continue;
        if (inBlock) { if (s.includes('*/')) inBlock = false; continue; }
        if (s.startsWith('/*')) { if (!s.includes('*/')) inBlock = true; continue; }
        if (s.startsWith('//')) continue;
        if (/^[})\];,]+$/.test(s)) continue;
        n++;
    }
    return n;
}
```

---

## 2. 量測結果

### 2.1 整體規模

|  | 總行數 | 空行 | 註解 | 收尾括號 | **實際程式碼** |
|---|---:|---:|---:|---:|---:|
| v3（7 檔） | 1,740 | 248 | 730 | 175 | **594** |
| 我們（量測當時，20 檔） | 5,152 | 774 | 1,019 | 722 | **2,657** |
| 我們（§3 執行後，21 檔） | 5,178 | 769 | 1,121 | 696 | **2,613** |

**實際是 4.4 倍，不是總行數顯示的 3.0 倍。**

`UniReel.ts` 561 行裡只有 175 行是程式碼，註解佔 268 行（48%）。我們的註解比例較低（22%），**註解不是瘦身標的** —— §3 執行後註解反而增加了 102 行，那是刻意的。

### 2.2 `ReelIconManager` 的四類拆分（現況 333 行方法）

| 類別 | 行數 | 佔比 | 主要成員 |
|---|---:|---:|---|
| **幾何（位置計算）** | **49** | 15% | `getAxisPosition` 9、`getBaseAxisPosition` 7、`applyMovementValue` 7、`mapAxisToLocal` 5、`setVisualAxisOffset` 5、`pendingHandoffCount` 4、`resetMovement` 4、4 個 getter 8 |
| **group／佔位綁定** | **106** | 32% | `expandSection` 21、`initialize` 19、`rebindEntryRuntime` 17、`recycleExitedCellKeepingData` 13、`getReplaceableEntryRuntimes` 13、`resolveGroupOffset` 11、`recycleExitedCell` 7、`getCellSpan` 5 |
| **顯示層（Egret）** | **97** | 29% | `sortIconDisplayLayers` 19、`initializeIcons` 16、`syncIcon` 15、`createDisplayMaskRect` 11、`configureDisplay` 9、`syncAllIcons` 7、`clearIcons` 7、`cleanup` 7、`resultEntryAtDisplayStart` 4、`icons` 2 |
| **查詢／驗證** | **59** | 18% | `isAligned` 24、`validateData` 11、`validateResultData` 10、`getVisibleCellSymbolIds` 9、`getVisibleRuntimes` 5 |
| 設定樣板 | 22 | 7% | `configure` 14、4 個 getter 8 |

**這個類別叫 `ReelIconManager`，但幾何只佔 15%，四件事各佔約四分之一。**
名稱與內容對不上，是「責任線畫錯」最直接的症狀 —— 這是決議 21 的依據。

### 2.3 幾何不是元凶（推翻原本的假設）

同一量法下 `UniReel` 的全部幾何：

```
isVertical 2 + moveDis 3 + moveDir 5 + iconDis 2
+ deltaDis 2 + topPos 3 + initLayout 4          =  21 行
```

我們 **49 行**，只多 28 行，且多出來的每一項都有來由：

| 多出來的 | 來源 |
|---|---|
| `cellOffset[k]` 那一層 | 決議 #18（掉落式預留） |
| `visualAxisOffset` | 啟動效果／停止效果（決議 #20） |
| `stripOffset` 取模不累加 | 決議 #17（零漂移） |

方向處理兩邊一樣便宜：v3 用 `Vec3` 的 `moveDir` 5 行，我們用 `mapAxisToLocal` 5 行。

### 2.4 驗證：v3 有 0 個 `throw`

| | 量測當時 | §3 執行後 | v3 |
|---|---:|---:|---:|
| `throw new Error` 數量 | 80 | **73** | **0** |
| `assert*` / `validate*` 函式定義 | 160 行 | **90 行** | 0 |
| `if (...) { throw }` 守衛 | 254 行 | **234 行** | 0 |
| 純轉手 getter | 90 行 | 87 行 | 30 行 |
| **合計** | **504 行** | **411 行** | **30 行** |

錯誤訊息的分類（量測當時 59 則）：

| 類型 | 數量 | 例子 |
|---|---:|---|
| **呼叫時機守衛** | ~27 | `"Roll timing cannot be changed while the reel is active."`、`"BaseReel is already active."` |
| 參數型別／範圍 | ~13 | `"cellPitch must be a positive finite number."` |
| 資料完整性 | ~19 | `"Result SymbolData must contain exactly ..."` |

第一類**不是 27 個獨立判斷，是一張狀態轉移表被展開成 27 個 `if`**，尚未處理（§4 槓桿一）。

### 2.5 其他佐證

- **薄委派不是元凶**：`BaseReel` 所有 public 方法中，「三行以內且只是轉呼叫」的僅 12 個、合計 38 行。其餘是真的在做事。
- **public 介面膨脹**：Reel 層四個類別合計超過 110 個 public 成員，對上 `UniReel` 的 25 個。
- **`alignmentEpsilon` 真正被用到只有 1 處**（`ReelIconManager.isAligned()` 裡的 `_stripOffset > _alignmentEpsilon`），卻配了 config 欄位、驗證、建構參數、私有欄位、public getter 共 10 行管線。
- **內部類別之間不能互相說話**：`BaseReel` 開了 3 個 callback 轉接器，經 5 個傳遞點散出去，`ReelDataFlow` 的方法簽章提及達 41 次。詳見 [Core-Runtime-Flow.md](Core-Runtime-Flow.md) §3。
- **`displayPriority` 的價碼**：`sortIconDisplayLayers()` 19 行，v3 的 `changeSibling()` 做同樣的事只要 4 行。多的 15 行全在「用 `setChildIndex` 而非 `zIndex`」加上穩定排序（決議 #19 的實際成本）。
- **`ReelDataList` 的設計理由沒被使用**：檔頭寫「可以檢視完整資料、已消耗資料與剩餘資料」，但 `consumedData` / `allData` 在框架內零呼叫者。真正需要「不刪前端」的是 `ReelDataFlow` 的 `_resultStartIndex` / `_resultEndIndex` **絕對索引**鏈（→ `resultSpinId` → `isAligned()` 的第三道檢查），檔頭一個字都沒提。

---

## 3. 已執行的項目

以下在移植完成後執行，每一步都經 `egret build` 與 56 項純 TS 斷言驗證。

### 3.1 去除重複（決議 28 及相關）

| 項目 | 前 | 後 |
|---|---|---|
| `assert*` 數值 helper | 15 份散在 7 個類別 | `Core/Internal/NumberAssert.ts` 的 5 個純函式；`assertDuration` 折成 `assertNonNegativeFiniteNumber` |
| 結構完全相同的函式對（≥50% 相似） | 7 對 | **0 對** |
| `takeNextPerformanceSymbolThatFits` / `takeNextSingleCellPerformanceData`（82% 相同） | 2 份 | 合併為 `takeNextPerformanceSymbol(accepts, …)` |
| `visualSize` 驗證 | `ReelDataList` 與 `ReelIconManager` 各一份，1×N Symbol 會驗 N+1 次 | 只留 `ReelIconManager.validateData()`（有 label 上下文）；`ReelDataList` 僅擋 null |
| `moveInterval` | **3 份**（`BaseReel._moveInterval`、`ReelStopFlow._timing.moveInterval`、外加當參數傳的第三份） | 1 份；`ReelStopFlow` 改持有 `_targetStopTime`，需要 moveInterval 時由呼叫端傳入 |
| `_layoutType` / `_inverseDirection` | 2 份（`BaseReel` + `ReelIconManager`） | 1 份；`ReelIconManager` 獨家持有並新增 `resultEntryAtDisplayStart` getter |
| 可變狀態欄位 | 74 | **70** |
| 只寫不讀的欄位 | 1（`_currentCellFirstHandoffPending`） | **0** |

> **`moveInterval` 那組修掉了一個真實分歧。** `BaseReel.init()` 原本只設 `_moveInterval`、不呼叫 `_stopFlow.setTiming()`，所以 `init()` 之後到 `setRollTiming()` 之前兩份是不一致的。當時不會出錯（`ReelStopFlow` 沒有 `targetStopTime` 就早退），但那是分歧的實例而非理論風險。

### 3.2 清除死碼

| 項目 | 說明 |
|---|---|
| `ReelStopFlow.quickStopRequested` / `pendingVisibleResult` / `pendingRequiredTail` | 外部拿不到 `ReelStopFlow` 實例，留著等於死碼 |
| `tryCommitResultAtHandoff()` 的 `completedHalfCellCount` 參數 | 從未被讀取；註解在解釋「為什麼不用它」。1×N 奇偶修正刪了、參數留著 |
| `BaseReel._completedHalfCellCount` | 7 處維護，唯一讀取點就是餵給上面那個死參數 |
| `BaseReel._currentCellFirstHandoffPending` | 宣告 1 次、賦值 4 次、讀取 0 次。v3 在半格中間交接時代的遺留，決議 #15 之後失去用途 |

**保留不刪**（外部可經 `reel.movement` / `reel.dataList` 取得實例，是刻意留給遊戲層的出口）：
`BaseMovement` 的 `timeScale` / `isPaused` / `queuedCommandCount` / `activeMoveRemainingOffset`；
`ReelDataList` 的 `remainingCount` / `allData` / `consumedData` / `peek` / `preview`。

### 3.3 補上拿不到的出口

原本只有 `reel.movement` 與 `reel.dataList` 兩個物件出口。新增：

| `BaseReel` 新成員 | 用途 |
|---|---|
| `stopEffectDuration` | 停止效果總秒數，遊戲層排時間軸用（原本只有 `stopEffectActive` 布林） |
| `firstVisibleIndex` | 顯示區第一格索引；沒有它，拿到 `symbols` / `icons` 也切不出可視段 |
| `getVisibleRuntimes()` | 顯示區逐 Cell 的 Runtime |
| `icons` | 整條 strip 的 Icon，索引與 `symbols` 對應。中獎表演需要（見主線 doc §6 的 `getGroupIcons()`） |

> 這四個目前零呼叫者是正常的 —— 遊戲層還沒寫。**待整體完成後回頭巡視是否真的需要。**

### 3.4 流程與編排（決議 26、27）

- **停輪規劃移出 `handoffOneCell()`**，獨立成 `BaseReel.tryCommitResultAtBoundary()`，由 `_secondHalfCompleteHandler` 在 `drainPendingHandoffs()` 之前呼叫。`handoffOneCell()` 從 18 行降到 10 行，熱路徑觸及檔數從 6 降到 5（`ReelStopFlow` 退出）。
- **`BaseReel` 依主題重排成八個區塊**：欄位與 handler → 建立 → 滾動資料與時間 → **主線** → 急停與即停 → 查詢 → 等待／重設／釋放 → 零件。19 個 getter 從檔案最前面移到後段。分組原則改成照主題而非照可見性，與 v3 一致。
- **`init()` 從 40 行降到 8 行**，拆成 `configureGeometry()` / `configureTiming()` / `wireMovementAndReset()` 三個具名步驟，執行順序不變。
- **class JSDoc 新增「主線讀法」**：標明讀 `init()` → `setInitialLayout()` → `startRoll()` → `updateMovement()` → `_secondHalfCompleteHandler` 五個就懂滾輪怎麼轉。

**未解決**：`_secondHalfCompleteHandler` 與 `handoffOneCell` 仍隔著約 510 行（原本 826）。前者是 `private readonly` 箭頭函式欄位，必須待在欄位宣告區以保證 `_stopFlow` 的初始化依賴；要搬到一起得改成一般方法再用 closure 包裝。目前以 class JSDoc 補償。

---

## 4. 尚未執行的減行槓桿

| # | 槓桿 | 現況 | 估計可減 | 風險 |
|---|---|---|---:|---|
| 一 | **狀態機守衛收成轉移表** | ~27 處 `if-throw`，`BaseReel` 佔 18 | 150～200 行 | 低，不動行為 |
| 二 | ~~`assert*` helper 合併~~ | **已完成**（§3.1） | 實際淨減約 40 行 | — |
| 三 | **QuickStop／Immediate API 瘦身** | 散在 6 個檔，七個入口 | 未估 | 中，要動流程 |

### 4.1 槓桿二的估計誤差（記錄下來避免重複犯）

原估「~120 行」，實際淨減約 40 行。錯在把先前量到的 `assertDefs=160` 當成「重複的 assert helper」—— 那個數字涵蓋**所有** `assert*` / `validate*` 方法（含 `validateSpinConfig`、`validateReelTiming` 這些不重複的）。真正重複的 15 個數值 helper 約 105 行，去重後模組 24 行，再加上 7 個檔案各多一段 import，淨效果就小很多。

### 4.2 槓桿三的觀察

1×1 之後 QuickStop 的**演算法**已經瘦了 —— `calculateQuickStopHalfCellCount()` 從 57 行的模擬迴圈縮成 8 行算術。但**介面**還是 1×N 時代的形狀，七個入口：

```
requestQuickStop / calculateQuickStopHalfCellCount / applyQuickStopPadding
/ applyQuickStopDataSkip / skipPendingPerformanceData
/ insertPerformanceCellsBeforeResult / prepareFastQuickStopPadding
```

且每個入口都再分岔一次「結果 commit 了沒」。**演算法瘦了，API 沒跟著瘦。**

---

## 5. 未定案

- 決議 21／22 的搬遷要在階段 9（測試場景）之前還是之後做。
- 槓桿一與槓桿三的執行順序。
- 槓桿一的轉移表要不要同時吃掉 `BaseSlotMachine` 的 throw（那邊也有 `_spinning` / `_stopping` / `_quickStopRequested` 三個布林在當狀態機）。
- `alignmentEpsilon` 只剩 1 處使用，是否還需要是「可設定的」。
- `displayPriority` 的 19 行實作（決議 #19）是否值得保留現在的穩定排序寫法。
- `ReelDataList` 是否併回 `ReelDataFlow` —— 真正需要的邏輯（絕對索引 + 結果區段 + spinId）約 25 行，但公開的 `reel.dataList` 出口要保留，型別會消失，需要另外處理。
- §3.3 新增的四個出口是否真的被遊戲層使用。

---

## 6. 本文推翻了什麼

量測推翻的假設，記錄下來避免重複繞路：

> **假設**：`BaseReel` + `ReelIconManager` 相對 `UniReel` 暴漲，元凶是幾何計算變複雜。
> **實測**：幾何 49 行 vs 21 行，只多 28 行且每項都有決議來源。
> 真正的重量在 group／佔位（106）、顯示層（97）、查詢驗證（59），三者對上 v3 的約 45 行。

> **假設**：`_quickStopRequested` 在 `BaseSlotMachine` 與 `ReelStopFlow` 各一份是重複。
> **實測**：前者是「本輪玩家已按急停」（用來讓急停後才啟動的軸立刻套用、決定是否跑 Turbo 補牌、擋重入），後者是「這一軸已套用」（`requestQuickStop()` 的每軸冪等保護）。**不同作用域的不同值，重設時機不同是正確的。**

> **假設**：v3 精簡是因為設計比較好。
> **實測**：v3 框架 594 行程式碼，但 Game1016 的 Slot 層有 2,369 行 —— 其中 `UniReelView1016.calculateRandomDataLength()` 一個函式就 83 行程式碼（255 總行數），內容是從停輪間隔、聽牌時間、`moveInterval` 與鎖定狀態**在遊戲層重新推導每軸何時停**。
> v3 沒有停輪時間、沒有結果驗證、零個 `throw`；**成本沒有消失，只是推給每一個遊戲各付一次**。
> 另有一部分差距來自引擎補貼（Cocos 的 `Component.update()`、`Prefab`、`Vec3`、`@property`），與設計無關。
