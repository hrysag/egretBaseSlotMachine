# 基本單位改回 1×1：設計決議與修改清單

> 對象：`D:\cocosTest\NewSlotMachine\SlotFrameWork\SlotMachine\assets\Script\SlotMachine\Core`（Cocos 完成版）
> 目的：移植到 Egret 的同時，把「Runtime = 1×N Symbol」改成「Runtime = 1×1 Cell」。
> 姊妹文件：[Cocos-To-Egret-Slot-Port-Map.md](Cocos-To-Egret-Slot-Port-Map.md)、[Egret-Slot-Exml-Editable-Surface.md](Egret-Slot-Exml-Editable-Surface.md)、[ReelTemplate-v3-Reference-Study.md](ReelTemplate-v3-Reference-Study.md)
> 後續：[Core-Responsibility-Slimming.md](Core-Responsibility-Slimming.md) —— 移植完成後的責任重劃與瘦身量測，決議 21 起編號於該文
> 執行期：[Core-Runtime-Flow.md](Core-Runtime-Flow.md) —— 從心跳到停輪的實際路徑流程圖
> 掉落式：[Drop-Module-Readiness.md](Drop-Module-Readiness.md) —— Drop 模組的現況評估與前置決議，決議 33 起編號於該文
> 盤點：[Port-Completeness-Audit.md](Port-Completeness-Audit.md) —— Cocos ↔ Egret 的成員層級對照、四個真缺口、以及「搬完但沒跑過」的清單
> 本文行號以 Cocos 完成版為準。

---

## 0. 決議摘要

| # | 決議 |
|---|---|
| 1 | **Runtime／Icon 一律 1×1**；大 Symbol 由 N 個連續 cell 組成一個 group |
| 2 | group 的 **head 在進場側**，圖從 head 往**退場方向**延伸 `cellSpan` 格 |
| 3 | 由 server per-cell 結果推導 group 時，**從退場端往進場端掃**，貪婪開組 |
| 4 | ~~被顯示區截斷的 group **只會截在進場端**~~ → **改為：兩端都可能被截斷**，各有一套補格（見 §2.3.1） |
| 5 | 進場／退場 buffer **對稱，各 = maxSpan**（**各軸之間不必一致**，見 §2.4 的更正） |
| 6 | `ReelSymbolRuntime.cellSpan` **換成** `groupOffset`（換，不是加） |
| 7 | 不在 runtime 上存 group 總長，需要時查 Registry |
| 8 | 表演資料入口維持 **Symbol 為單位**，框架在入列時展開成 N 格 |
| 9 | View 只讀 `groupOffset`；同組存取用 on-demand helper，不存引用 |
| 10 | `ReelLayoutSource` 改成三段陣列，**手寫初始盤面必須乾淨對齊** |
| 11 | `maxSpan` 自動由 Registry 取最大值，**允許 Config 明寫覆蓋** |
| 12 | `replaceEntryPreparationData()` 必須尊重 group 完整性 |
| 13 | 座標**維持中心原點**：顯示區中央 = 0，`axisPosition` = 該格**中心** |
| 14 | Icon node 恆為 1×1、`anchorOffset` 恆為常數；head 的大圖是**子物件**，往退場方向偏移 |
| 15 | 交接改用**計數器**（每完整 Cell 固定回收一格），不再做幾何比較 |
| 16 | 陣列循環**沿用 v3 的 `pop` / `unshift`**，不採用環形游標 |
| 17 | 位置改為**計算取得**：整軸單一 `stripOffset`，不再逐格累加絕對座標 |
| 18 | 位置公式預留 `cellOffset[k]` 一層供未來掉落式使用，滾動期恆為 `0` |
| 19 | `displayPriority` **保留**（美術可能溢出單格） |
| 20 | 啟動／停止效果**合併成單一 `ReelEffectConfig`**，欄位改對稱的 `startEffect` / `stopEffect`（見 §3.10） |
| 30 | 提交結果前**拆掉**進場端沒湊滿的那一組（改寫成 1×1），**不補完**（見 §2.2.2） |
| 31 | 截斷**兩端都要補**：進場端往佇列**末端補**、退場端往佇列**前端墊**（見 §2.3.1）。此決議推翻決議 4 |
| 32 | **`cellSpan` 不得大於 `visibleCellCount`**。超過的話「盤面被單一 Symbol 填滿」時缺口落在哪一端無法從盤面判斷（見 §2.3.1 末段） |
| 34 | Icon 的輸入**拆成「我在哪」與「我是什麼」兩個介面**（`ReelIconLayout` / `ReelIconCell`），後者只在值真的改變時才推；`cellSpan` 與 `displayPriority` 由框架現查 Registry 後投影過去（見 §3.9） |
| 35 | 方向的對外出口**只給推導結果**（`exitTowardPositiveAxis` / `layoutType`），`inverseDirection` 不暴露 —— 避免遊戲層複製框架的座標慣例（見 §2.5） |
| 36 | **機台是顯示物件**（`extends eui.Component`），`init()` 把 Reel 收成子項，**mask 蓋在機台**而非逐軸（見 §3.8） |
| 37 | 推進抽成 **`update(deltaTime)`**，心跳只是預設的那層殼；鉗上限留在殼、不放進 `update()`。心跳維持 `startTick`（見 §3.8） |
| 38 | **Icon 收在 `BaseReel` 內的普通容器**，避開 eui 在子項增刪時的強制重測量（見 §3.9） |
| 39 | 跨軸表演**搬的是表演物件不是 Icon**，Icon 位置維持框架獨佔，表演物件每幀單向跟隨 worldPos（見 §3.9）。未實作 |
| 40 | Reel 之間的層級排序用**保留槽位**，不指派連續索引，以免推走機台底下的美術子項（見 §3.9）。未實作 |

> 決議 21～29 在 [Core-Responsibility-Slimming.md](Core-Responsibility-Slimming.md)、決議 33 在 [Drop-Module-Readiness.md](Drop-Module-Readiness.md)。決議 30～32、34～40 因為屬於 group 模型與其顯示層對應，記在本文。

**不變的東西**：`cellSpan` 仍然由企劃在 `registerSymbolCells()` 填寫，格式一字不改；server 結果格式（per-cell、長度 === `visibleCellCount`）不變；`moveInterval`＝一個 Cell 的時間不變；半格 Movement 拆分不變；`targetStopTime` 的對外語意不變；座標原點與 `axisPosition` 的語意不變；**Movement 維持集中在 Reel 推進單一數值軸，Icon 不繼承 Movement**。

---

## 1. 為什麼改

### 1.1 程式自己承認撐不住

```ts
// ReelDataFlow.ts:427
/** Turbo 同步補牌只能使用 1×1，避免多格 Symbol 改變 Handoff 相位。 */
private takeNextSingleCellPerformanceData(...)
```

```ts
// BaseSlotMachine.ts prepareFastQuickStopPadding()
if (difference % 2 !== 0) {
    throw new Error("Turbo QuickStop cannot synchronize Reels whose "
        + "remaining distances differ by half a Cell.");
}
```

只要需要相位可預測，程式就自己退回 1×1；退不回去就丟例外。根因是 **Buffer 是「一張完整 Symbol」而不是固定區域**，進退場端的缺口會隨當下那張牌的 span 改變，相位因此不是常數。

### 1.2 連帶代價（全部可在程式裡指出）

| 症狀 | 位置 |
|---|---|
| 停輪時間算不出來，只能逐半格預演（兩個 `halfCount <= 1000` 迴圈） | `ReelIconManager.ts:360`、`:438` |
| 為了預演要複製整份假 Runtime 並模擬回收 | `ReelIconManager.ts:881-1000` |
| 表演牌變成裝箱問題，放不下就跳過、補不滿就接受時間誤差 | `ReelDataFlow.ts:355-450` |
| Server per-cell → collapse 成 Icon → 驗證時又 expand 回 per-cell | `collapseResultCellData()` ↔ `isAligned()` 的 `Math.round(overlap / cellPitch)` |
| 半格奇偶要額外修正 | `ReelStopFlow.ts:154` |
| 跨輪相位要另外保存 | 至今未接回 |

### 1.3 改完之後

```text
剩餘時間 = 剩餘 cell 數 × moveInterval        ← 精確算術，不再預演
```

Egret 移植另外賺一筆：`anchorOffset` 不再需要隨 `cellSpan` 變動（見 Port Map §3.2 標記的新失敗點，直接消失）。

### 1.4 這是不是「改回 v3」？

**幾何與循環機制：是，而且是刻意的。**

改完之後這幾項與 v3 完全一致：strip 等距單一尺寸、回收位置固定、半格→交接→半格、`pop`/`unshift` 輪轉、出場端由 `inverseDirection` 決定、`layoutType` + `inverseDirection` 兩個設定。

原因是 **v3 的「等高循環」不是限制，是前提**。1×N 版把前提拿掉，整套相位與時間計算就得靠逐半格預演才能成立 —— `ReelIconManager` 那兩個 `halfCount <= 1000` 迴圈就是拆掉前提後被迫長出來的東西。

而且兩款參考專案誰也沒真的打破它（見 [ReelTemplate-v3-Reference-Study.md](ReelTemplate-v3-Reference-Study.md) §7）：1016 是加預備牌＋補牌，1024 是查表把子盤 icon 縮小，**都是繞過而非解決**。

所以 1×1 + group 的本質是：**保留 v3 的幾何前提，把「佔位」搬到資料層表達**。這也表示本次重構風險偏低 —— 要回去的是被兩款上線遊戲驗證過的循環模型。

**但新框架不只是「v3 + 佔位」。** 四項 v3 沒有的能力必須保留：

| 能力 | v3 現況 | 1016 為此付出的代價 |
|---|---|---|
| **停輪時間** | 只有「最低滾動時間」門檻（`UniSlotMachine.canStopRoll()`），沒有「每軸何時停」的概念 | `UniReelView1016.calculateRandomDataLength()` **252 行** |
| **停止驗證** | `data.count === 0` 就停，盤面正確性外包給遊戲層 | 排錯只能靠眼睛看 |
| **Movement 歸屬** | 每張 Icon 一個 `UniMovement`（Cocos Component） | Egret 沒有 Component，此路不通 |
| **佔位** | 無 | 預備牌從 2 張加到 5 張，相關公式全改 |

另外三項較小但有感的差異：`ReelDataList`（陣列＋`readIndex`，本輪資料可回溯）取代 v3 的 `Queue<S>`；急停的「保護尾段」寫進底層而非各遊戲自己砍 Queue；`resultSpinId` 防止連續兩輪相同牌面誤停（v3 無此防護）。

**本次改動的正確描述：**

```text
v3 的循環幾何          ← 拿回來
+ groupOffset 佔位      ← 新增，但只佔四分之一
+ 時間驅動停輪          ← 保留，且 1×1 之後才真的準
+ 結果對齊驗證          ← 保留
+ Movement 集中於 Reel  ← 保留，Egret 移植的前提
```

1×N 那條路的產出是時間模型與對齊驗證，並且證明了等高前提拆不掉。現在是把幾何還回去，其餘留著。

---

## 2. 核心模型

### 2.0 名詞：strip 與資料佇列

整份文件反覆出現這兩個詞，而且**最容易混淆的錯誤都來自把它們當成同一件事**，所以先定義。

#### strip

**一條軸上那串固定數量的格子。** 狀態列印的 `strip = 9 cells` 就是它。

```text
strip 長度 = maxCellSpan + visibleCellCount + maxCellSpan
           =     3       +        3         +     3        = 9
```

```text
        ┌────────┐
 進場   │  idx0  │ ┐
 buffer │  idx1  │ │ maxCellSpan 格 —— 還沒露出來的預備區
        │  idx2  │ ┘
        ╞════════╡ ← mask 上緣
 可視   │  idx3  │ ┐
        │  idx4  │ │ visibleCellCount 格 —— 玩家唯一看得到的區域
        │  idx5  │ ┘
        ╞════════╡ ← mask 下緣
 退場   │  idx6  │ ┐
 buffer │  idx7  │ │ maxCellSpan 格 —— 已經滾出去、等著被回收
        │  idx8  │ ┘
        └────────┘
```

| 東西 | 位置 |
|---|---|
| 每格的資料 | `ReelIconManager._symbols`（對外 `BaseReel.symbols`），9 個 `ReelSymbolRuntime` |
| 每格的顯示物件 | `ReelIconManager._icons`（對外 `BaseReel.icons`），9 個 `BaseReelIcon`，**與上面永久同索引配對** |
| 長度 | `BaseReel.stripCellCount` |
| 可視段起點 | `BaseReel.firstVisibleIndex`（恆等於 `maxCellSpan`） |

兩個關鍵性質：

1. **數量永遠不變。** 建立時建 `stripCellCount` 個，之後不增不減。「滾動」是把退場端最外格搬回進場端再換上新資料（`pop()` / `unshift()`，見 §2.9），不是生成新物件。決議 30（§2.2.2）敢「就地改寫」也是建立在這條上 —— 那幾格是固定的容器。
2. **它不是資料來源。** 資料從資料佇列流進來，一個 Cell 邊界搬一格。

名字沿用拉霸機的「輪帶」。v3 叫 `_iconList`；本文用 strip 是因為要同時涵蓋資料（`_symbols`）與顯示（`_icons`）兩條同索引的陣列。

#### 資料佇列

**本輪還沒進場的資料**，`ReelDataFlow` 持有的 `ReelDataList`（對外 `BaseReel.dataList`）。以 **Cell** 為單位，1×N Symbol 在入列時就展開成 N 筆相同 id（§3.5）。

```text
   資料佇列（ReelDataList）              strip（_symbols）
   本輪還沒進場的資料，會用完       ←→   固定 stripCellCount 格，永遠不變
   [7, 7, 7, 1, 62, …]                  [idx0 … idx8]
         │                                    ↑
         └──── consumeNextData() ─────────────┘
               每個完整 Cell 邊界搬一格
```

#### 為什麼一定要分清楚

`groupOffset` 只存在於 **strip** 上（`ReelSymbolRuntime.groupOffset`），是入場那一刻由鄰居推導出來的（§2.2）；**資料佇列裡只有 id，沒有 group 歸屬**。

所以「這一組有沒有湊滿」這個問題，在兩邊要用完全不同的方式看：

| | 怎麼看出「這組壞了」 |
|---|---|
| strip | 直接讀 `_symbols[0].groupOffset`，不是 0 就是沒湊滿 |
| 資料佇列 | **看不出來** —— 只有 id，要回去追它是被誰、怎麼切出來的 |

決議 30（§2.2.2）巡的是 strip，所以管不到「還躺在佇列裡、已經被切壞」的組 —— 那是 §6 仍未處理的一項。

### 2.1 不變量（整份重構的依據）

> **一個 group 的所有 cell 同生共死。**
> 整組在進場 buffer 裡組完才開始露出；整組完全離開顯示區之後才開始拆。

這條同時決定了三件事：buffer 為何要對稱、`replaceEntryPreparationData()` 為何要改、大 Symbol 動畫為何不會遇到「圖還在但底下資料已經換人」的中間狀態。

### 2.2 `groupOffset` 的定義與推導

```text
groupOffset = 0   → head，負責畫整張圖，圖往退場方向延伸 cellSpan 格
groupOffset > 0   → follower，不畫
```

綁定時的 O(1) 規則（在 handoff 換資料的當下執行）：

```ts
const neighbour = 朝退場方向的隔壁那一格;   // 已經綁好了

if (neighbour !== undefined
    && neighbour.data.id === data.id
    && neighbour.groupOffset > 0) {
    runtime.groupOffset = neighbour.groupOffset - 1;   // 接續同一組
} else {
    runtime.groupOffset = registry.getCellSpan(data.id) - 1;   // 開新組
}
```

head 放進場側的理由：head 最後進場，圖畫出來時 follower 全都就位；而且整組還在進場 buffer 內，玩家不會看到半成品。反過來把 head 放退場側，圖會往回蓋到還沒換資料的格子上。

實作在 `ReelIconManager.resolveGroupOffset()`，由 `recycleExitedCell()`、`recycleExitedCellKeepingData()` 與 `rebindEntryRuntime()` 三處呼叫：

```ts
private resolveGroupOffset(
    data: SymbolData,
    neighbourTowardExit?: ReelSymbolRuntime,
): number {
    if (
        neighbourTowardExit !== undefined
        && neighbourTowardExit.data.id === data.id
        && neighbourTowardExit.groupOffset > 0
    ) {
        return neighbourTowardExit.groupOffset - 1;
    }

    return this.getCellSpan(data) - 1;
}
```

**判斷條件只有 id 與 offset，沒有「這格屬於哪一批資料」的概念** —— 表演牌與正式結果若是同一張 Symbol，邊界會被接在一起。這就是決議 30（§2.2.2）要處理的事。

### 2.2.1 怎麼讀一整條 strip 的 `groupOffset`

排錯時最常看的就是 `BaseReel.symbols` 逐格印出來的 `groupOffset` 陣列。它依內部陣列順序排列，也就是**進場端 → 退場端**。

**讀法只有一條規則：每遇到一個 `0` 就是一組的開始，後面連著遞增的數字都是它的 follower。**

```text
0, 1, 2   一張 1×3（head 在最前，圖往退場方向蓋三格）
0, 1      一張 1×2
0         一張 1×1，或一張大牌只剩 head 還沒走完
```

最後一項從 offset 本身分不出來，要配 `ReelSymbolRegistry.getCellSpan()` 或可視格的 id 才能確定。

實例（可視 3 格、`maxCellSpan = 3`、strip 9 格、`firstVisibleIndex = 3`）：

```text
groupOffset = [0, 1, 2,   0, 1, 2,   0, 1,   0]
               └─ idx0~2 ┘└─ idx3~5 ┘└idx6,7┘ └idx8

        ┌────────┐
 進場   │   0    │ idx0  ┐
 buffer │   1    │ idx1  │ 一組 1×3
        │   2    │ idx2  ┘
        ╞════════╡ ← 顯示區上緣
 可視   │   0    │ idx3  ┐
 3 格   │   1    │ idx4  │ 一組 1×3，剛好填滿顯示區
        │   2    │ idx5  ┘
        ╞════════╡ ← 顯示區下緣
 退場   │   0    │ idx6  ┐ 一組 1×2
 buffer │   1    │ idx7  ┘
        │   0    │ idx8    單獨一格
        └────────┘
```

**判讀重點：可視段（`firstVisibleIndex` 起算 `visibleCellCount` 格）必須自成完整的組。**
出現下列形狀就是壞掉了：

| 可視段長相 | 意義 |
|---|---|
| `0, 1, 2` | 正常，一張 1×3 填滿顯示區 |
| `1, 2, 0` | **錯位**。前兩格是 head 在進場 buffer 那組的 follower，第三格是另一組的 head —— 畫面上前兩格空白、第三格只露出大圖的頭一格 |
| 可視段以 `1` 或 `2` 開頭 | 該組的 head 在顯示區外，圖是從上面蓋下來的；只有「上一輪滾出來的截斷盤面」才合法（§2.1、決議 4） |
| 出現 `0` 之後接的不是 `1` | 兩組之間斷開，或有孤兒 follower |

follower 不畫圖，所以**孤兒 follower 在畫面上就是空格**，不是黑框也不是錯圖 —— 看到空格先印這條陣列。

### 2.2.2 決議 30：提交結果前拆掉進場端沒湊滿的那一組

**問題**：`ReelDataFlow.commitResult()` 換掉未讀尾段時，進場端可能正有一組大 Symbol 只進場了一部分（head 還沒進來）。它剩下的格子被 `takePerformanceCellsByBudget()` 依預算砍掉之後，正式結果的第一格入列時，退場側鄰居就是那組沒湊滿的 Cell。`resolveGroupOffset()` 只比對 id 與 offset，**同一張牌就會被接進去**，整批 offset 跟著錯位，可視段變成上表的 `1, 2, 0`。

**決議：把那一組拆掉，不補完。**

- 已經進場的那幾格就地改寫成各自獨立的 1×1（`ReelIconManager.dissolveIncompleteEntryGroup()`）
- 佇列裡屬於該組的未讀格數一併丟棄（`ReelDataFlow.commitResult()` 的 `dissolvedEntryGroupCellCount`）
- 入口在 `BaseReel.dissolveIncompleteEntryGroup()`，由 `tryCommitResultAtBoundary()` 在提交前呼叫

**為什麼可以就地改寫**：group 的 span 最多 `maxCellSpan`，進場 buffer 也正好是 `maxCellSpan` 格，所以已進場的部分最多 `maxCellSpan - 1` 格，必定整批還在 buffer 內 —— 玩家從來沒看過它們。

**為什麼替代品只能是 1×1**：每格自成完整的一組（offset 恆為 0），任何數量都湊得出來。與 `ReelDataFlow.insertPerformanceCellsBeforeResult()`（Turbo 同步補牌）同一個理由，也共用 `takeSingleCellPerformanceSymbol()` 這條搜尋。牌庫至少要有一張 1×1 的約束（§3.5）因此再多一個依賴點。

**為什麼不用「補完同 id」**（曾評估，否決）：

| | 補完同 id | 拆成 1×1 |
|---|---|---|
| 額外行程 | 1 ～ `maxCellSpan - 1` 格 | **0 格** |
| 停輪時間 | 補齊格繞過 `performanceCellBudget`，急停時失準 | 完全由預算決定 |
| 副作用 | 把本該丟掉的表演牌救活，**同一張大 Symbol 會連出兩次**，而且必定連出（會吸附的前提就是同 id） | 那組在 buffer 內就被拆掉，沒露過臉 |

停輪時間精確是本框架相對 v3 的主要價值（§1.4），不值得讓一張表演牌的殘組侵蝕它。

**已知未涵蓋**：`takePerformanceCellsByBudget()` 仍可能從**尾端**切斷一個 group，留下的殘組會造成同樣的吸附；那是另一個待決議項（見 [Core-Responsibility-Slimming.md](Core-Responsibility-Slimming.md)）。另外 `ReelIconManager.isAligned()` 只比對 `data.id` 與 `resultSpinId`，**不檢查 group 完整性**，錯位的盤面它會放行。

### 2.3 結果進場佇列的建立

1. 把 server 的**畫面閱讀順序**陣列，依當前方向轉成**退場端 → 進場端**順序。
2. 依序入列，每格套用 §2.2 的規則。
3. **收尾**：若最後一格的 `groupOffset > 0`，再補上 `groupOffset` 格同 id。

第 3 步就是「補出被顯示區截斷的那幾格」，不需要偵測邏輯 —— 它是同一條規則跑到 offset 歸零的自然結果。

完整推導（7 是 1×3，3 格盤面，server 給 `[7,7,1]`）：

| 進場順序 | id | 朝退場方向的隔壁 | `cellSpan` | 算出的 `groupOffset` |
|---|---|---|---|---|
| 1 | 1 | 舊表演牌 | 1 | `1-1 = 0` → head |
| 2 | 7 | 上一格 id=1，不同 | 3 | `3-1 = 2` → 開新組 |
| 3 | 7 | 上一格 offset=2 > 0 | 3 | `2-1 = 1` → 接續 |
| 4（框架補的） | 7 | 上一格 offset=1 > 0 | 3 | `1-1 = 0` → head，停在進場 buffer |

### 2.3.1 決議 31：截斷的兩端

> **本節推翻決議 4。** 原本寫「被顯示區截斷的 group 只會截在進場端」，錯了。

head 恆在進場側（決議 2），圖往退場方向延伸。把一張大 Symbol 從進場走到出場看一遍就知道兩端都會截：

```text
進場中（head 還沒到）          出場中（身體已經走了）
        ╞════════╡                     ╞════════╡
 可視   │  7:1   │              可視   │   1    │
        │  7:2   │                     │   2    │
        │   2    │                     │  7:0   │ ← 只剩 head
        ╞════════╡                     ╞════════╡
 缺的是 head，在進場端外        缺的是 follower，在退場端外
```

右邊那個狀態是**每一張大 Symbol 出場的必經過程**，不是特例。

兩端各有一套補格，**互為鏡像**，都在 `ReelDataFlow.commitResult()` 內完成：

| | 進場端截斷 | 退場端截斷 |
|---|---|---|
| 缺的是 | head（offset 0） | follower（offset 較大的那幾格） |
| 那幾格相對結果 | **更晚**進場 | **更早**進場 |
| 補在佇列的 | **末端**（append） | **前端**（prepend） |
| 實作 | `createGroupCompletionCells()` | `createExitTruncationCells()` |
| 判斷依據 | 掃完最後一格 `offset > 0` | 開頭那段 run 的長度不是 `cellSpan` 的整數倍 |

退場端的推導（7 是 1×3、3 格盤面、server 給 `[1,2,7]`）：

```text
畫面上→下 = [1, 2, 7]
進場順序   = [7, 2, 1]        ← 開頭就是退場端
開頭 run   = 1 格，cellSpan 3 → 墊 3 - 1 = 2 格 7

佇列 = [7, 7, 7, 2, 1]
offsets =  2  1  0  0  0
可視段（上→下）= 1:0  2:0  7:0     ← 最下面那格是 head，圖往顯示區外延伸兩格
```

**沒有歧義。** head 恆在進場側，所以退場端那段 run 的上方若是別的 id，它就只能是「某一組的前 k 格」，缺的必定在退場端外。1016 之所以需要 server 額外給 `direction` 欄位（`UPWARD` / `DOWNWARD`），是因為它的 wild **兩個方向都能長**；我們的方向是常數，從 per-cell 陣列加 Registry 的 `cellSpan` 就推得出來。

**時間要一起算。** 墊的那幾格比結果更早進場，結果因此多走同樣的格數。`ReelStopFlow.tryCommitResultAtHandoff()` 先向 `ReelDataFlow.countExitTruncationCells()` 問出格數，加進 `resultEntryHalfCellCount` 之後才算預算與 `directResultStopTime`，否則停輪時間會短算。

#### 決議 32：`cellSpan <= visibleCellCount`

唯一推不出來的情況是 **run 一路貼滿兩端**（整個盤面同一個 id）。例：可視 3 格、盤面 `[7,7,7]`、7 是 1×4 ——

```text
截在進場端？  可視是 offset 1,2,3
截在退場端？  可視是 offset 0,1,2，第 4 格在下方外
兩端都截？    可視是 offset 1,2,3 的某段
```

三者從盤面分不出來。**限制 `cellSpan <= visibleCellCount` 之後這個情況消失**（盤面填滿時 run 長度 ≥ cellSpan，必定是完整組的整數倍或可由既有規則解出）。

程式目前**不擋**這件事；`createExitTruncationCells()` 遇到 run 貼滿兩端時直接回傳空陣列，把缺口交給進場端那套補。要不要在 `registerSymbolCells()` 或 `init()` 加一道 `cellSpan <= visibleCellCount` 的驗證，未定（§6）。

驗證見 `tests/CoreGeometry.test.ts` 的 `7f. 截斷盤面：進場端與退場端都要補`。

### 2.4 Strip 長度

```text
strip = maxSpan + visibleCellCount + maxSpan
```

範例：`maxSpan = 4`、`visibleCellCount = 3` → 11 個 runtime／Icon。

~~多軸請務必讓所有軸的 strip 長度一致（`maxSpan` 統一），Turbo 同步停輪才不會因幾何不同而出現相位差。~~

> **這條理由是錯的，已實測反證。** Turbo 同步是把各軸剩餘的**半格數**補齊到最大值（`prepareFastQuickStopPadding()`），補的是**格數**不是時間 —— 幾何差異會被補牌完全吸收。
>
> 三軸 fastMode + quickStop 實測停輪離散：
>
> | 情境 | 離散 |
> |---|---|
> | 全部相同 | 0.0000s |
> | `maxCellSpan` 1/2/3 不同 | **0.0000s** |
> | 可視格數 3/4/5 不同（3-4-5 機台） | **0.0000s** |
> | 兩者都不同 | **0.0000s** |
> | `moveInterval` 0.06/0.08/0.10 不同 | **0.2333s** |
>
> 真正的前提是 **`moveInterval` 一致**，已加守門（`BaseSlotMachine.assertUniformMoveInterval()`，只在 `fastMode` 檢查）。**各軸的 `maxCellSpan` 與可視格數可以不同** —— 3-4-5-4-3 這種機台是合法設定，擋掉才是錯的。斷言見 `tests/CoreGeometry.test.ts` §11f／§11g。
>
> **但上面那張表有盲點，補記於此**：它全部用 1×1 盤面，所以沒有任何補格。改用會產生退場端截斷的盤面之後，Turbo 是**失步的** —— 那是另一個 bug，見 §3.6 的「Turbo 補牌看不到退場端墊格」。修掉之後幾何差異與截斷差異都能同步。

### 2.5 方向

一律用**進場端／退場端**描述，不得出現「上／下」「左／右」。四個滾動方向共用同一套規則，方向轉換由既有的 `resultEntryAtDisplayStart` 負責。

**幾何本身不含方向** —— `axis(k)` 一律往退場方向遞增，`groupOffset` 推導、交接、對齊、兩端補格全都不知道上下左右。整個框架只有**三個地方**碰方向：

| 位置 | 做什麼 |
|---|---|
| `ReelIconManager.mapAxisToLocal()` | 軸向數值映射到 `x` 還是 `y`、正負號 |
| `ReelIconManager.createDisplayMaskRect()` | mask 的長邊擺哪一軸 |
| `ReelIconManager.resultEntryAtDisplayStart` | server 結果的閱讀順序要不要反轉 |

#### 已修：Horizontal 的閱讀順序推導是反的

第三項原本從 Cocos 版**一字不改**搬過來：

```ts
return this._layoutType === ReelIconDirection.Vertical
    ? !this._inverseDirection
    : this._inverseDirection;      // ← Horizontal 這一支
```

Cocos 的 `movementSign = inverse ? 1 : -1`，水平正向是往 `-x` 走，也就是**右→左**，那邊這條是對的。移植時 `mapAxisToLocal()` 重新推導成 y-down 並把水平改成**左→右**（與 `ReelIconDirection` 的 JSDoc 一致），這條卻沒跟著改，於是 Horizontal 整個反掉：盤面左右鏡像，而且 `isCommittedResultAligned()` 用的是同一個布林，所以會「自洽地停在錯的盤面」。

因為四方向從沒被執行過（Port Audit §5），一直沒露面。

**修法**：整條塌縮成 `return this.exitTowardPositiveAxis;`。兩者同值，因為兩個軸的閱讀順序都是從座標小的一端開始（Egret 的 y 往下、x 往右）：垂直由上而下、水平由左而右，所以「退場在正向」⟺「進場在座標小的那端」⟺「進場在閱讀順序的開頭」。

#### 決議 35：方向的對外出口只給推導結果

`layoutType` / `inverseDirection` 是 `BaseReelConfig` 的欄位，**遊戲層本來就有**。但 Icon 需要的是「退場方向是不是局部座標的正向」，遊戲層只能自己寫 `!inverseDirection` 推出來 —— 而那條等式的正確性依賴框架內部 `mapAxisToLocal()` 的慣例。

這正是上面那個 bug 的同一種病：**同一條方向慣例存在兩份推導**，一份在框架內（`resultEntryAtDisplayStart`）、一份在遊戲層（`TestSlotMachine.createIcon()`），改了一邊另一邊靜默失效。

| 對外暴露 | 理由 |
|---|---|
| `exitTowardPositiveAxis: boolean` | 唯一需要知道慣例的那一位。給了之後全專案只有 `mapAxisToLocal()` 一處定義「退場方向對應哪個號」 |
| `layoutType: ReelIconDirection` | Icon 要知道長邊擺哪一軸。這是**原始設定不是推導**，還回去沒有慣例外洩的問題 |
| **不暴露** `inverseDirection` | 它單獨沒有意義，必須配合慣例才能解讀 —— 暴露它就等於把慣例洩出去 |

`BaseReel` 與 `ReelIconManager` 各有這兩個 getter；`TestSlotMachine` 仍然持有方向設定（它是設定的作者），但 `createIcon()` 改成向 reel 問：

```ts
private createIcon(reel: BaseReel): TestReelIcon {
    return new TestReelIcon(
        reel.exitTowardPositiveAxis,
        reel.layoutType === ReelIconDirection.Vertical,
    );
}
```

驗證見 `tests/CoreGeometry.test.ts` §10／10b／10c。把修正還原之後，§10 與 §10c 會紅 6 項 —— 那條回歸是有牙齒的。

### 2.6 座標模型：維持中心原點

**原點 = 顯示區中央，`axisPosition` = 該格中心。** 與現況完全相同，不改。

曾評估過改成「進場端邊緣 = 0」以消掉公式裡的 0.5，**否決**。兩個理由：

1. **解析度適配**：軸以中心為基準，畫面縮放時對稱處理最單純。
2. **顯示區位置不隨 `maxSpan` 改變**（這條更硬）。邊緣原點的顯示區在 `[maxSpan*pitch, (maxSpan+visible)*pitch]`；哪天加一張更大的牌讓 `maxSpan` 從 3 變 4，每一軸的視覺位置就整個平移一格，得回頭補償。中心原點永遠是 `±visible*pitch/2`，buffer 多大都不影響。

**公式**（`i` = 從進場端數起的 cell 索引，0-based，涵蓋整條 strip）：

```text
strip 長度 L = 2 * maxSpan + visibleCellCount

axis(i) = (i - maxSpan - visibleCellCount / 2 + 0.5) * cellPitch
```

驗證（`visible = 3`、`maxSpan = 1`、`pitch = 1`）：axes = `-2, -1, 0, 1, 2`，顯示區 `[-1.5, +1.5]`，三個可視格中心落在 `-1, 0, +1`。

這其實**就是現有 `createVisibleLayout()` 的同一條式子**（`ReelIconManager.ts:199-207`），只是 `centerFromStart = occupiedCellsFromStart + cellSpan * 0.5` 在 1×1 之後塌縮成 `i + 0.5`，並延伸到涵蓋 buffer。所以這塊是簡化，不是重寫。

### 2.7 顯示層映射：Icon 恆為 1×1

中心原點在 Egret 會讓 `anchorOffset` 與 mask 帶負值（Egret 預設原點在左上、mask 是 `Rectangle(x, y, w, h)` 從左上量）。解法**不是**改原點，而是：

| 項目 | 決定 |
|---|---|
| icon node 尺寸 | 恆為 1×1（`cellPitch`） |
| icon `anchorOffset` | 恆為 `cellPitch / 2`，**常數，不隨資料變** |
| head 的大圖 | icon 的**子物件**，往退場方向偏移 `(span - 1) * cellPitch / 2` |
| follower | 不畫 |
| mask | `new egret.Rectangle(-w/2, -visible*cellPitch/2, w, visible*cellPitch)` |

這樣「runtime 是 1×1」一路貫徹到顯示層，而不是在 View 那邊又長回 1×N。

Port Map §3.2 標記的失敗點（「1×3 換成 1×1 忘了重設 `anchorOffsetY` 會偏半格」）因此消失 —— 不是因為 anchor 變成 0，而是因為它變成**常數**，沒有東西可以忘記重設。

### 2.8 位置模型：由計算取得，不再逐格累加

現況是**每格存絕對座標，每幀全部加一次**：

```ts
// ReelIconManager.ts:665
public applyOffset(offset: number): void {
    for (const runtime of this._symbols) {
        runtime.axisPosition += offset;     // ← 每格各自累加
    }
    this.syncAll();
}
```

因為每格位置是累加出來的，所有幾何判斷都不敢信任精確值，於是 `alignmentEpsilon` 在 `ReelIconManager` 裡出現 **21 次**（交接、可見、進場 buffer、對齊判斷全都要配容差）。

**改成整軸一個偏移量，位置用算的：**

```text
位置(k) = axis(k) + stripOffset + cellOffset[k] + visualAxisOffset
           ↑固定      ↑滾動用       ↑掉落用         ↑bounce／啟動效果（整軸）

axis(k) = (k - maxSpan - visibleCellCount / 2 + 0.5) * cellPitch
```

`stripOffset` **不累加**，直接從 Movement 的值取模：

```ts
const travelled      = Math.abs(movementValue);
const cellsTravelled = Math.floor(travelled / cellPitch);
const stripOffset    = travelled - cellsTravelled * cellPitch;   // ∈ [0, pitch)，零累積誤差
```

`cellsTravelled` 每增加 1 就回收一格 —— 這**就是 §3.4 決定的「交接用計數器」**，兩件事合而為一，不是兩套機制。

於是 `isAligned()` 可以完全不碰幾何：停止只發生在完整 Cell 邊界（`stripOffset === 0`），可視格就是陣列索引 `maxSpan … maxSpan + visible - 1`，直接讀 id 比對即可。

> 位置表示法是 `ReelIconManager` 的**私有實作細節** —— `axisPosition` 在框架內出現 37 次全部在該檔內，外部程式碼 0 次讀取。換表示法不影響任何其他檔案。
> 唯一的對外考量：`ReelSymbolRuntime` 是公開匯出的介面，遊戲端理論上可以讀 `axisPosition`。需要相容時提供 `getAxisPosition(runtime)` 或計算屬性即可。

### 2.9 陣列循環：沿用 v3 的 `pop` / `unshift`

曾評估改用**環形游標**（陣列不動，`entryIndex` 遞減）以省下每次回收的 O(n) 搬移，**否決**。兩個理由：

**① 效能理由站不住。** strip 長度 `L = 2 × maxSpan + visible`，以 maxSpan 4、visible 3 計為 11。即使 L2 最快模式（`moveInterval = 0.016`，約 60 次回收／秒），也只有 `11 × 2 × 60 = 1,320` 次元素搬移／秒／軸，5 軸 6,600 次／秒 —— 在 JS 裡量不出來。

**② 掉落式需要的是分割重排，不是旋轉**（見 §2.10）。游標只能表達旋轉。

另外澄清一點：環形游標並沒有多給「icon↔cell 配對固定」這個好處 —— `_symbols[i]` ↔ `_icons[i]` 本來就一直配對著。

> **Egret 版只轉 `_symbols`，`_icons` 完全不動。** Cocos 版是兩條一起 `pop` / `unshift`；移植後改成「Icon 是固定的槽位，第 k 格的資料每次交接後重新綁到固定待在第 k 格的那個 Icon」（`ReelIconManager.recycleExitedCell()` 只碰 `_symbols`，配對由 `syncIcon(k)` 維持）。
>
> 兩個推論：① 滾動期間 `ReelIconLayout.index` 對同一個 Icon 是常數；② 一次交接會讓**多數槽位的內容換人**，不是只有被回收的那一格 —— 決議 34 的觸發頻率實測就是這個原因（§3.9）。
> 掉落式的分割重排要兩條陣列一起動，屆時 `index` 才會真的變，所以它仍然每幀重推而不由 Icon 自己記住。

### 2.10 掉落式（Drop）對位置模型的影響

v3 內建的 `DropReel`（`v3/Scripts/DropReel/`）目前不在移植範圍，但位置模型必須先為它留路，否則之後要加會動到核心。

> 本節只處理**位置模型**這一層。Drop 模組整體的現況評估、v3 四個核心機制的對照、連續牌（group）帶出的五個問題與決議 33，見 [Drop-Module-Readiness.md](Drop-Module-Readiness.md)。

**Drop 違反「整軸統一位移」的四個特性：**

```ts
// v3 UniDropReel.ts:64-75
const dropIcons = this._iconList.filter(icon => icon.dropType !== DropType.NoDrop);
for (let i = 0; i < dropIcons.length; ++i) {
    const dropCount = this.getDropCount(dropIcons[i]);               // ① 每張各算距離
    const dropDis   = this.moveDir.clone().multiplyScalar(this.moveDis * dropCount);
    const dropTime  = this.moveInterval * dropCount;                 // ② 等速不等時
    dropIcons[i].moveBy(dropDis, dropTime, ease, easedValueCustom);  // ③ 各自一條 Movement
}
```

① 距離不同、② 時間不同、③ 有些完全不動（被 `filter` 掉）、④ **陣列被分組重排而非旋轉**：

```ts
// v3 UniDropReel.ts:152-172 reorderDropIcon()
this._iconList = !this.inverseDirection ?
    [firstIcon, ...dropOutIcons, ...remainIcons, lastIcon] :
    [firstIcon, ...remainIcons, ...dropOutIcons, lastIcon];
```

**但兩者不會同時發生。** Drop 永遠從對齊格線的靜止盤面開始：

```ts
public startDropOut(dropOutIdList: number[], ...): void {
    this.initLayout();        // ← 先歸位到格線
    this.resetMovements();    // ← 清掉殘留 deltaTime
    ...
}
```

這正是 `stripOffset === 0` 的狀態。所以分層成立：

| 階段 | 位移來源 |
|---|---|
| 滾動期 | `stripOffset`（整軸統一），`cellOffset[k]` 全為 0 |
| 靜止 | `stripOffset === 0`，每格精確落在格線 |
| 掉落期 | `cellOffset[k]`（每格各自），`stripOffset === 0` |

**本次決議：`cellOffset[k]` 這一層現在就加進位置公式（滾動期恆為 0），實際掉落行為等要做的時候再實作。** 成本是每格多一個 number（11 格 = 11 個），換到的是「將來要支援掉落」這件事寫進結構而非只寫在文件裡。

> **集中式 Movement 反而是 Drop 能移植的前提。** v3 靠 `UniIconBase extends UniMovement` 讓每個 Icon 天生是一條 Movement，代價是 Icon 被綁死在 Cocos `Component` 上 —— Egret 沒有 Component，此路不通。
> 新框架的 `BaseMovement` 是純值物件，要做 drop 時由 **Reel 持有一組** `BaseMovement[]` 即可，Icon 依然什麼都不繼承。

---

## 3. 修改清單（逐檔）

### 3.1 `Reel/Data/ReelData.ts`

**改 `ReelSymbolRuntime`（`:37`）**

```ts
// before
export interface ReelSymbolRuntime {
    data: SymbolData;
    cellSpan: number;          // 這個 runtime 佔幾格
    resultSpinId?: number;
    axisPosition: number;
}

// after
export interface ReelSymbolRuntime {
    data: SymbolData;
    groupOffset: number;       // 我離 head 幾格（0 = head）
    resultSpinId?: number;
    cellOffset: number;        // 掉落式預留，滾動期恆為 0（§2.10）
}
```

C 裡每個 runtime 恆為一格，原 `cellSpan` 欄位值恆等於 1，直接改用同一個位置記 group 內位置。
**不存 group 總長** —— `reconfigureStoppedLayout()` 允許中途重新註冊 `cellSpan`，存了就會變髒資料。
`axisPosition` 一併移除，位置改為計算取得（§2.8）。

**`groupOffset` 沿內部陣列方向遞增。** 內部陣列固定是「進場端 → 退場端」，head 在 group 的進場側，所以同一組讀起來是 `0(head), 1, 2 …`，與 `resolveGroupOffset()` 的「鄰居 − 1」方向一致。

> 實作時踩過一次：初始展開若寫成 `cellSpan - 1 - offset` 方向就反了，與 handoff 推導對不上。

**改 `ReelLayoutSource`（`:8-20`）**

```ts
// before
export interface ReelLayoutSource {
    readonly topBuffer: SymbolData;        // 一張
    readonly visible: SymbolData[];
    readonly bottomBuffer: SymbolData;     // 一張
}

// after
export interface ReelLayoutSource {
    readonly entryBuffer: SymbolData[];   // 展開後 === maxCellSpan
    readonly visible: SymbolData[];       // 展開後 === visibleCellCount
    readonly exitBuffer: SymbolData[];    // 展開後 === maxCellSpan
}
```

三段都以**資料流方向**（進場端 → 退場端）排列。順便改掉 `topBuffer`／`bottomBuffer` 這兩個在水平或反向滾動時會誤導人的名字。

**約束：手寫初始盤面不允許大 Symbol 跨越 buffer／顯示區邊界**，三段各自獨立驗證。截斷盤面只有一個來源 —— 上一輪滾出來的結果，那是框架自己產生並保存在 runtime 上的，不經過 `setInitialLayout()`。

### 3.2 `Reel/Config/ReelConfig.ts`

**`BaseReelConfig` 新增**

```ts
/**
 * 進場／退場 buffer 各自的 Cell 數。
 * 未設定時由 ReelSymbolRegistry 已註冊的 cellSpan 取最大值。
 * 多軸請統一明寫，避免各軸 strip 長度不同而影響 Turbo 同步停輪。
 */
readonly maxCellSpan?: number;
```

自動算 + 允許覆蓋：自動算會讓「這一軸的牌庫剛好沒有大牌」變成 buffer 比別軸小；明寫可以先把未來要加的大牌空間預留好。

### 3.3 `Reel/Data/ReelSymbolRegistry.ts`

**不改介面**，`ReelSymbolCellDefinition` 一字不動（`cellSpan` 仍是企劃唯一的輸入）。

**新增**

```ts
/** 目前已註冊的最大 cellSpan；供 BaseReel 決定 buffer 大小。 */
public getMaxCellSpan(): number;
```

### 3.4 `Reel/Internal/ReelIconManager.ts` — 改動最大

**位置計算：整段換成 §2.8 的計算式**

不是簡化，是**刪除**。改成位置由索引算出來之後，這幾個「依鄰居推算位置」的函式全部沒有存在意義：

| 函式 | 位置 | 處置 |
|---|---|---|
| `getPositionBefore()` | `:835` | 刪 |
| `getPositionAfter()` | `:846` | 刪 |
| `getEntryPosition()` | `:858` | 刪 |
| `sortByDisplayOrder()` | 依 `axisPosition` 排序 | 刪，改索引算術 |
| `applyOffset()` | `:665` | 改寫成一次賦值，不再 O(n) 累加 |
| `createVisibleLayout()` 的 `occupiedCellsFromStart` 累加 | `:190-214` | 刪，改 `axis(k)` |

初始 Layout 變成單一迴圈：

```ts
for (let k = 0; k < stripLength; k++) {
    // 位置不存，需要時用 axis(k) + stripOffset + cellOffset[k] 算
}
```

**`syncIcon()`（`:776`、`:779`）**

```ts
// before
layout.height = runtime.cellSpan * this.cellPitch;

// after —— head 才有尺寸，follower 不畫
const span = this.getCellSpan(runtime.data);
layout.height = runtime.groupOffset === 0 ? span * this.cellPitch : this.cellPitch;
```

實際上「follower 要不要畫、head 圖多大」屬於顯示層，建議只把 `groupOffset` 交給 Icon，由 `BaseReelIcon` 的 Hook 決定，`ReelIconManager` 不再碰尺寸。

**`recycleExitedIcon()`（`:238`）／`rebindEntryRuntime()`（`:319`）**

原本的 `runtime.cellSpan = this.getCellSpan(nextData)` 換成 §2.2 的 `groupOffset` 推導。

**`canHandoffExitBuffer()`（`:~400`）—— 必須改成計數器，不是可選優化**

現況比較的是**顯示區**邊界：

```ts
const fullyExitedEdge = candidate.axisPosition - this.movementSign * halfLength;
return this.movementSign * fullyExitedEdge > visibleHalfLength + this._alignmentEpsilon;
```

buffer 變成 `maxSpan` 格之後，回收時機必須是「完全離開 **strip**」（走完整個退場 buffer），否則退場 buffer 永遠是空的。邊界要改成 `(visible/2 + maxSpan) * cellPitch`。

**但改完之後這個比較會退化。** 每格等寬、初始又對齊 grid，走完剛好一個完整 Cell 之後，退場端那格的進場側邊緣會**精確落在邊界上**：`>` 不成立、`>=` 成立，答案由 `alignmentEpsilon` 與浮點誤差決定。跑久了會飄，且飄的方向會讓交接在「第二個半格」與「下一格的第一個半格」之間跳。

1×N 舊模型不會遇到，因為各格寬度不同、邊界幾乎不可能正好對齊。**等距反而把這個退化情況變成常態。**

所以：

> **每完成一個完整 Cell Movement，退場端固定回收一格。**
> 不做幾何比較、不用 epsilon、沒有相位歧義。

連帶決定：交接發生在**第二個半格結束時**（由模型決定，不需實測），與停止判斷落在同一個點（`_secondHalfCompleteHandler`）。

`tryHandoffExitedIcon(completedHalf)` 因此從「每半格檢查一次」變成「只在第二個半格固定執行」。

> v3 是在兩個半格**中間**交接（`UniReel.moveOnce()` 把 `moveTo(topPos)` 插在兩個 `moveBy` 之間），因為它 buffer 只有一格，非這樣不可。我們 buffer 有 `maxSpan` 格的餘裕，放到整格結束更單純。

**`getEntryBufferRuntimes()`（`:551`）**

buffer 固定 `maxSpan` 格，回傳數量恆定。但要新增 group 完整性判斷，見 §3.6。

**`isAligned()`（`:576`）／`getVisibleCellSymbolIds()`（`:624`）**

那套 `Math.round(overlapLength / this.cellPitch)` 的重疊面積換算整段刪掉，改成直接讀可視 cell 的 `data.id`。少一個浮點誤差來源。

**新增 helper**

```ts
/** 取得與 runtime 同組的全部 Icon；即時往鄰居走，不存引用。 */
public getGroupIcons(runtime: ReelSymbolRuntime): BaseReelIcon[];
```

回收改綁會讓任何存下來的引用立刻變髒，一律即時計算。**已實作**，語意與邊界情況見 §3.9。

### 3.5 `Reel/Internal/ReelDataFlow.ts`

**`commitResult()`（`:158-205`）重寫**

- 刪掉 `collapseResultCellData()` 呼叫，改成 §2.3 的三步驟。
- `performanceCellBudget` 的意義不變，但因為每格都是一格，預算計算變精確。

**表演資料展開（新增）**

`getNextPerformanceData()` 簽章不動，仍回傳一張 `SymbolData`；框架在入列時查 `cellSpan` 展開成 N 格並配好 `groupOffset`。遊戲端的 `setPerformanceDataBank()`、`appendPerformanceData()` 完全不受影響。

**裝箱收尾（保留但降級）**

停輪時間 = 剩餘 cell 數 × `moveInterval`，仍需湊到精確 cell 數。策略不變：**塞到放不下為止，尾巴用 1×1 補滿**。牌庫至少要有一張 1×1 的約束維持。

> **實作補記**：`takePerformanceCellsByBudget()` 原本第一行是 `remainingCells.slice(0, cellBudget)`，那一刀會切在 group 中間，在正式結果正前面留下湊不滿的組（結果同 id 會被吸走，不同 id 則留下孤兒 follower）。已改成**逐組取**：讀 `cellSpanResolver` 一次前進一整組，遇到第一個放不進預算的組就停，零頭再由牌庫補（`takeNextPerformanceSymbol(cellSpan <= shortfall)`）。牌庫湊不出東西時接受低於預算，不切壞任何一組。
>
> 這一步成立之後，`createGroupCompletionCells()` JSDoc 寫的前提 ——「結果之前的表演資料永遠以完整 group 結尾」—— 才真的被保證。另一半由決議 30（§2.2.2）負責：進場端**已經進場**的殘組拆成 1×1、佇列裡的殘餘一併丟棄。兩者合起來才涵蓋 group 邊界的兩個破口。
>
> 驗證見 `tests/CoreGeometry.test.ts` 的 `7e. 預算切資料不得切在 group 中間`。

差別是：現在裝箱失敗會造成**時間誤差**（「接受低於預算，不為補滿而超時」），改完之後只影響**表演牌的長相**，時間永遠精確。

### 3.6 `Reel/BaseReel.ts`

**`replaceEntryPreparationData()`（`:~1380`）—— 必修，否則第二輪就會出錯**

現況：

```ts
const entryRuntimes = this._iconManager.getEntryBufferRuntimes();
for (const runtime of entryRuntimes) {
    const consumedData = this.consumeNextData();
    ...   // 全部換成本輪的表演資料
}
```

**問題**：上一輪若停在 `[7,7,1]`，那個 1×3 的 head 就坐在進場 buffer 裡，兩個 follower 還在顯示區。新一輪開始時 head 被換走，顯示區剩下兩個孤兒 follower，**圖直接消失**。

1×N 版不會發生（整張是同一個 runtime，要嘛整換要嘛不換），C 拆開後才暴露。

**修法**（§2.1 不變量的直接應用）：

> 進場 buffer 的某一格可以被換掉，只有當**它整組都在 buffer 裡**。
> head 是組內最靠進場端那格，buffer 索引 `i` 上的 head 佔用 `i … i + span - 1`；
> 安全條件是 `i + span - 1 <= 最後一個 buffer 索引`。

從進場端往內走，遇到第一個跨越 buffer／顯示區邊界的組就停。

**`calculateQuickStopHalfCellCount()`（`:~735`）**

不再呼叫投影模擬，改成純算術：剩餘 cell 數 × 2（half-cell）＋ 目前 Movement 的剩餘相位。

#### 已修：Turbo 補牌看不到退場端墊格

`BaseSlotMachine.prepareFastQuickStopPadding()` 把各軸剩餘的半格數補齊到最大值，但它問的 `calculateQuickStopHalfCellCount()` **看不到退場端截斷會在結果前面墊幾格**。

根因是時序：補牌在 `stopSpin()` 內、`commitResult()` 之後立刻決定，而 `commitResult()` 只把結果記進 `ReelStopFlow`，**一格資料都沒動** —— 真正墊格要等到下一個 Cell 邊界的 `tryCommitResultAtHandoff()`（見 [Core-Runtime-Flow.md](Core-Runtime-Flow.md) §1.1）。所以決定補幾格的當下，Reel 還不知道自己等一下要墊幾格。

**實測（修正前，三軸幾何相同、`moveInterval` 相同）**

| 盤面 | 退場端墊格 | 停輪 |
|---|---|---|
| `[1,2,3]` | 0 | 0.8833 |
| `[1,7,7]` | 1 | 0.9667 |
| `[1,2,7]` | 2 | 1.0500 |

三軸的 `halfCellCount` 都回報 12，補牌算成 `[0,0,0]`，**失步量精確等於墊格數**。

**修法**：`ReelStopFlow.pendingExitTruncationCellCount` 回報尚未提交的結果會墊幾格，`calculateQuickStopHalfCellCount()` 把它加進行程。用的是與 `tryCommitResultAtHandoff()` **同一個** `countExitTruncationCells()`，不產生第二份推導。

進場端截斷的補格**不算** —— 那幾格接在結果後面，盤面對齊之後才進場，實測 `[7,7,1]`／`[7,1,1]` 皆無延遲。

**驗算（360 組：maxCellSpan 3/4 × 可視 3/4/5 × 各 10 種盤面 × moveInterval 3 種 × quickStop 時機 2 種，零失敗、盤面全對）**

| 退場端墊格 | 修正前公式的誤差（格） | 組數 |
|---|---|---|
| 0 | −0.15 ～ 0.33 | 228 |
| 1 | **0.85 ～ 1.33** | 96 |
| 2 | **1.85 ～ 2.33** | 36 |

加上該項之後，殘差收斂成六個離散值、每個恰好 60 組 —— 而變因剛好是 `moveInterval`（3）× quickStop 時機（2）。也就是**殘差只隨相位變動、與盤面無關**。fastMode 各軸同時啟動且 `moveInterval` 相同（由 `assertUniformMoveInterval()` 守門），殘差因此各軸一致，相減即歸零。

> **1016 沒有這個問題，因為它沒有這個功能。** `UniReel1016.fastStopRoll()` 是把佇列砍到 `iconAmount + 1 + _endCardCount`，而 `_endCardCount` 是該軸連續牌需要的補牌數、**逐軸不同** —— 砍完各軸剩的量本來就不一樣，它從來沒有宣稱同時停。我們的框架有宣稱，所以這是 bug。

斷言見 `tests/CoreGeometry.test.ts` §11i；把該項拿掉會紅兩條。

#### 已修：急停的另一個進入順序（結果先到、玩家後按）

上一節修的是「玩家先按、結果後到」。急停有**兩個進入順序**，`prepareFastQuickStopPadding()` 也因此有兩個呼叫點：

| 順序 | 觸發點 | 當下狀態 | 失步成因 |
|---|---|---|---|
| 玩家先按、結果後到 | `stopSpin()` 內 | 結果**未寫進佇列** | 看不到「等一下會墊幾格」 |
| **結果先到、玩家後按** | `quickStop()` 內 | 結果**已寫進佇列**，且 `applyQuickStopDataSkip()` 剛砍掉未讀表演牌 | 墊格**被併在結果區段開頭**，`_resultStartIndex` 指的是墊格不是本體 |

第二條的關鍵在 `ReelDataFlow.commitResult()`：

```ts
const resultEntryCells = [
    ...exitTruncationCells,      // ← 墊格
    ...visibleResultEntryCells,
];
```

墊格與結果本體被併成同一個 `resultSegment`，所以 `_resultStartIndex` 指向墊格。砍掉表演牌之後 `pendingCellCountBeforeResult()` 三軸都歸零，行程算出來一樣長 —— 但實際還要多走墊格那幾格。

**實測（修正前，三軸幾何相同、盤面墊 0/1/2 格）**：`padding` 讀到的 half 是 `[11, 11, 11]`，補牌 `[0,0,0]`，停輪 `0.9667 / 1.05 / 1.1333`。

**修法**：`ReelDataFlow` 在 commit 時記下 `_resultExitPadCellCount`，新增 `pendingCellCountBeforeResultBody()` 算到**結果本體**；`calculateQuickStopHalfCellCount()` 改用它。

> **`skipPendingPerformanceData()` 的砍除範圍不動** —— 它只能砍到 `_resultStartIndex`，**墊格砍掉盤面就壞了**。兩個計數刻意分開，不要合併。§11j 最後一條斷言（盤面正確）就是這道防線。

兩個來源**互斥**，不會重複計算：`pendingCellCountBeforeResultBody()` 在結果未提交時早退回 0；`pendingExitTruncationCellCount` 則在 `clearResultEntry()` 之後回 0，而那正是資料提交同一個函式的尾端。

**驗算（1080 組：兩種順序 × maxCellSpan 3/4 × 可視 3/4/5 × 各 10 種盤面 × moveInterval 3 種 × 開始時機 2 種 × 提交後再走 0/2 格，零失敗、盤面全對）**

| 順序 | 墊格 | 組數 | 修正前誤差（格） | 修正後 |
|---|---|---|---|---|
| post | 0 | 456 | 0.03 ~ 0.63 | 0.03 ~ 0.63 |
| post | 1 | 192 | **1.00 ~ 1.63** | **0.00 ~ 0.63** |
| post | 2 | 72 | **2.00 ~ 2.63** | **0.00 ~ 0.63** |
| pre | 0 | 228 | −0.31 ~ 0.31 | −0.31 ~ 0.31 |
| pre | 1 | 96 | −0.31 ~ 0.31 | −0.31 ~ 0.31 |
| pre | 2 | 36 | −0.31 ~ 0.28 | −0.31 ~ 0.28 |

`pre` 三列與前一節修完之後**逐格相同** —— 這次的改動沒有動到它。

> `post` 的殘差整段偏正約半格（`pad = 0` 那 456 組也一樣），與墊格數無關，是 `applyQuickStopDataSkip()` 砍完之後的相位落點。同一輪裡所有軸走同一條路徑，偏移量共同，相減歸零，因此不影響同步。

斷言見 §11j；把 `pendingCellCountBeforeResultBody()` 換回 `pendingCellCountBeforeResult()` 會紅一條。

### 3.7 `Reel/Internal/ReelStopFlow.ts`

- `tryCommitResultAtHandoff()` 的 `requiredRemainingParity` 奇偶修正（`:154-163`）可刪 —— 每格等寬，相位恆定。
- 已經是死碼的 `getResultTravelCellCount()`（`:339`）與 `getExitMissingCellCount()`（`:358`）一併刪除。

#### 已修：停輪時間的柵欄錯誤（早一格）

`BaseReel.calculateResultEntryHalfCellCount()` 回傳的值被 `ReelStopFlow` 當**時間**用，但它算的是**交接次數**，兩者差一：

```ts
// 修正前
const travelCells = firstVisibleIndex + visibleCellCount;   // 6 = 交接次數
return travelCells * 2;
```

結果的第一格要從 idx0 走到可視段最外格，確實需要 `firstVisibleIndex + visibleCellCount` 次交接。但**其中第一次與 commit 同刻發生** —— `_secondHalfCompleteHandler` 是 `tryCommitResultAtBoundary()` 緊接 `drainPendingHandoffs()`（見 [Core-Runtime-Flow.md](Core-Runtime-Flow.md) §2.3），所以 N 次交接只跨過 **N−1** 個 `moveInterval`。

**影響**：`earliestStopTime` 晚報一格；`performanceCellBudget` 因為扣掉了灌水的值而少補一格表演牌，實際停輪因此比要求的時間**早約一格**。

```ts
// 修正後
return (handoffCells - 1) * 2;
```

**實測（252 組參數組合，單軸直接驅動）**

涵蓋 `maxCellSpan` ∈ {1,2,3} × 可視格數 ∈ {1,3,5} × `moveInterval` ∈ {0.05,0.08,0.12} × 目標時間 ∈ {1.0,1.6,2.5} × commit 時機 ∈ {0.2,0.6}，另加含 1×3 大牌與兩端截斷的盤面。

| | 修正前 | 修正後 |
|---|---|---|
| `realized − plan.actualStopTime` | **−1.000 個 moveInterval**（143/218 組剛好，其餘落在 ±0.11 的取樣粒度內） | **0**（殘差 ±0.11 為取樣粒度） |
| `realized − requested` | −1.04 ～ −1.88 格 | **−0.21 ～ −0.83 格**，永遠不晚 |
| 因不可能而被鉗制的組合 | 34 | 24 |
| 盤面錯誤 | 0 | 0 |

差距與 `maxCellSpan`／可視格數／`moveInterval`／目標時間**都無關**，固定一格 —— 這是判定它是柵欄錯誤而非等比例誤差的依據。

**剩下的誤差是必然的**：停輪只能發生在完整 Cell 邊界（決議 15），所以剩餘時間一定要量化成整數格。兩個 `floor` 保證**不晚於**要求的時間，最壞早一格。曾評估改成 `round`（誤差砍半成 ±0.5 格）但**否決** —— 那會讓某軸停在比目標晚的時刻，而 `BaseSlotMachine.createCurrentStopTimings()` 是靠「requested 遞增」保證停輪順序的；一旦可以向上取整，`staggerStart` 小於 `moveInterval` 時順序就可能反轉。

斷言見 `tests/CoreGeometry.test.ts` §11d 的「實際停輪時間等於 plan.actualStopTime」—— 修正前那兩條不成立。


### 3.8 `Core/BaseSlotMachine.ts`

**`prepareFastQuickStopPadding()`**

```ts
if (difference % 2 !== 0) {
    throw new Error("Turbo QuickStop cannot synchronize Reels whose ...");
}
```

**這個 throw 刪掉。** 每格等寬之後不可能出現半格差，各軸剩餘距離必為整數格。同步計算簡化成「取各軸剩餘 cell 數最大值，差額補 1×1」。

#### 決議 36：機台是顯示物件，Reel 是它的子項，mask 蓋在機台

`BaseSlotMachine` 原本是純 class、不在場景樹上。這與 Cocos 版不符 —— 那邊是 `@ccclass export class BaseSlotMachine extends Component`，掛在 Node 上，本來就是場景的一員。

**決議：`extends eui.Component`。**

選 `eui.Component` 而非 `egret.DisplayObjectContainer`：它是唯一吃得下 `skinName` 的類別，也是能出現在 Egret UI Editor「Custom」面板的前提（見 [Egret-Slot-Exml-Editable-Surface.md](Egret-Slot-Exml-Editable-Surface.md) §1.1），對應規劃中的 `SlotMachineSkin.exml`。與 `BaseReel` 一致。

連帶兩件事：

| 項目 | 內容 |
|---|---|
| `init()` 收養 Reel | `adoptReels()`：`reel.parent !== this` 的就 `addChild`。exml skin 產生的 Reel 本來就掛好了，不會動到 |
| mask 移到機台層 | `BaseSlotMachine.createDisplayMaskRect(crossSize)`。沿軸長度取各軸共用的 `visibleCellCount × cellPitch`；**跨軸長度由呼叫端給** —— 那取決於各軸怎麼擺與美術寬度，是場景／skin 的佈局，框架不知道 |

`BaseReel.createDisplayMaskRect()` 保留，給需要逐軸各自遮罩的情況。

> Cocos 版的框架裡**完全沒有 mask 程式碼**，遮罩是場景自己掛 Mask component。Egret 版提供矩形的產生、由呼叫端指派，比原版前進一步。

#### 決議 37：推進抽成 `update(deltaTime)`，心跳只是預設的那層殼

`BaseSlotMachine` 原本把「從引擎取時間」和「推進」焊在同一個 `_tickHandler` 裡。對照之下 `BaseReel.updateMovement(deltaTime)` 是公開入口、零引擎相依 —— 機台是整個框架**唯一**還自己抓引擎時間的地方。

```ts
public update(deltaTime: number): void        // 推進，機台層唯一入口
protected startTicking(): void                // private → protected
protected stopTicking(): void
public static readonly MAX_DELTA_TIME         // private → public
```

**鉗上限留在殼，`update()` 不鉗。** 0.1 秒上限防的是分頁切回來的時間跳躍，那是**時間源**的性質；鉗在 `update()` 裡會讓 `update(0.5)` 靜默只前進 0.1，對測試與外部驅動都是陷阱。

覆寫 `startTicking()` 成不做事即可改由外部驅動 —— 這條路徑的價值不只是測試：`egret` 在本類別只出現三次（`getTimer` / `startTick` / `stopTick`），全在這兩個方法裡，關掉之後整條路完全不碰引擎。

##### 為什麼心跳仍然用 `startTick` 而不是 `ENTER_FRAME`

曾評估改用 `Event.ENTER_FRAME`，**否決**。查證結果：

| | `startTick` | `ENTER_FRAME` |
|---|---|---|
| 觸發 | 每個 rAF（`SystemTicker.update()` 開頭，在 frameRate 閘門**之前**） | 只在通過閘門、真正渲染的幀 |
| 帶時間 | `timeStamp`（毫秒） | **沒有** —— `dispatchEventWith(Event.ENTER_FRAME)` 沒傳 `data` |
| 前提 | 只相依一個函式 | **必須有一個 DisplayObject 當事件源**（`DisplayObject.$addListener` 把自己推進 `$enterFrameCallBackList`） |

「只有 `startTick` 帶時間」不是真正的理由 —— `egret.getTimer()` 是公開函式（`Date.now() - sys.$START_TIME`），兩條路都要自己相減。真正的理由是**語意**：引擎對 `startTick` 的說明是「註冊並啟動一個計時器」，那正是一個非顯示協調者要的東西；`ENTER_FRAME` 是顯示物件的每幀回調。

至於「ENTER_FRAME 頻率對齊渲染、不做白工」：實際估算 5 軸 × 11 格，60Hz 對 30Hz 多出約 1,650 次屬性寫入／秒，在 JS 裡量不出來，而 Movement 是時間驅動的，多推進幾次不影響正確性。**省下的極少。**

> 補記：決議 36 之後機台已經是 DisplayObject，`ENTER_FRAME` 的「要有事件源」前提消失了。但上面的語意理由與效益評估不變，所以維持 `startTick`。要改的話現在只是換掉殼，`update()` 不動。

### 3.9 `Reel/BaseReelIcon.ts`

**Icon node 恆為 1×1，`anchorOffset` 恆為 `cellPitch / 2`。** span 的差異全部推到子物件的偏移上（§2.7）：

```text
icon node       尺寸 cellPitch × cellPitch，anchor 固定在自己的中心
  └─ 美術子物件  head：尺寸 span × cellPitch，從自己這一格起往退場方向延伸
                follower：不顯示
```

**附帶好處**：head 綁定的那一刻就是「這組到齊了」的信號（head 一定最後進場），不需要另外發 group-complete 事件。

#### 決議 34：Icon 的輸入拆成「我在哪」與「我是什麼」

原本只有一個 `ReelIconLayout`，同時帶 `x` / `y` 與 `groupOffset`，由 `applyLayout()` 每幀推一次。問題是**兩種資訊的變動頻率差一個數量級**：位置每幀都變，group 歸屬只有這一格換人才變。綁在一起的結果是遊戲端的 `onLayoutChanged()` 每幀都要重算美術尺寸 —— `TestReelIcon` 實作出來就是這樣，每幀查一次 `cellSpan` 再設一次 `width` / `height` / `x` / `y`。

**決議：拆成兩個介面、兩個 Hook。**

```ts
/** 我在哪 —— 每幀推。 */
export interface ReelIconLayout {
    readonly x: number;
    readonly y: number;
    readonly index: number;      // 本格在 symbols／icons 上的索引
}

/** 我是什麼 —— 只有值真的變了才推。 */
export interface ReelIconCell {
    readonly groupOffset: number;
    readonly cellSpan: number;        // 由 Registry 現查
    readonly displayPriority: number; // 由 Registry 現查
}
```

| Hook | 觸發 | 放什麼 |
|---|---|---|
| `onLayoutChanged(layout)` | 每幀 | 基底已設完 `x` / `y`，一般不必覆寫 |
| `onCellChanged(cell)` | 只在這一格的 cell 值改變時 | 換圖、改尺寸、改偏移 |

同步順序固定為 `setData()` → `applyCell()` → `applyLayout()`，所以 `onCellChanged()` 內讀 `this.data` 拿到的一定是本格當下的資料。

**變更偵測放在 `ReelIconManager.syncIconCell()`**，也就是 `syncIcon()` 裡面 —— push 點只有這一個，不可能漏刷新；而且值一律現查 Registry，`reconfigureStoppedLayout()` 重新註冊後會在下一次同步自動跟上。**這不違反決議 7**：決議 7 擋的是「存進 runtime 之後沒人再管」，這裡是每次同步都從唯一來源重推的投影。

**實測的觸發頻率**（`tests/CoreGeometry.test.ts` §8b）：

| 情境 | `onCellChanged` |
|---|---|
| 只推進位置、不交接 | **0 次** |
| 一次交接、strip 全為 1×1 | **0 次**（每格的 cell 值前後相同） |
| 一次交接、strip 含 1×2 與 1×3 | 9 格中 7 格（值真的不同的那幾格） |

> 注意第三列：交接輪轉的是 `_symbols`，`_icons` **不動**，所以第 k 格的 Icon 會改為顯示原本第 k−1 格的資料 —— 多數槽位的內容都換人了。「只有被回收的那一格會重推」是錯的直覺（見 §2.9 的補註）。

**`cellSpan` 為什麼由框架推給 Icon，而不是讓遊戲端自己查**：`cellSpan` 是遊戲端經由 `registerSymbolCells()` 交給框架的，框架卻沒有還給它的路徑，結果 `TestReelIcon` 得自備一份 `TestSymbolTable` 對照表。推過去之後那份平行表就只剩「哪張圖」的用途。

**View 的判斷就兩行：**

```ts
protected onCellChanged(cell: ReelIconCell): void {
    if (cell.groupOffset !== 0) {
        this.art.visible = false;                         // follower 不畫
        return;
    }
    this.art.visible = true;
    this.art.height = cell.cellSpan * this.cellPitch;     // 往退場方向延伸
}
```

#### `getGroupIcons()`

```ts
public getGroupIcons(runtime: ReelSymbolRuntime): BaseReelIcon[];
```

大於一格的 Symbol 只有 head 畫圖，中獎表演與掉落式要以整組為單位處理時由此取得。回收會就地改綁資料，**任何存下來的同組引用下一次交接就變髒**，所以一律即時走訪、回傳新陣列（決議 9）。

**走鄰居，不用 `cellSpan` 算。** `headIndex = index - groupOffset` 加 `cellSpan` 可以一步算出範圍，但那個範圍可能落在 strip 之外 —— 一個 group 進場時 head 還沒進來、出場時 follower 已經被回收，兩端都會有格子不在陣列上。改走鄰居（**id 相同且 `groupOffset` 連續**）有三個好處：自然停在 strip 邊界、不受中途重新註冊 `cellSpan` 影響、相鄰兩個同 id 的 group 不會被黏成一組（後一組的 head 是 `0`，不等於前一格的 offset + 1）。

因此**回傳格數可能少於 `cellSpan`**，那是進出場途中的正常狀態，不是錯誤。要判斷 head 在不在其中，用 `BaseReelIcon.isGroupHead`。

> **兩種截斷要分清楚。** 「head 在進場 buffer、follower 在可視段」（§2.2.1 的 `1,2,0`）是相對**顯示區**的截斷，此時整組都在 strip 上，`getGroupIcons()` 會把 head 一起回傳。head 真的不存在只發生在該組還在一格一格組裝、整組都關在進場 buffer 裡的時候 —— 因為 `groupOffset <= maxCellSpan - 1` 而 `firstVisibleIndex === maxCellSpan`，所以**查詢可視段或更靠退場端的任一格，head 必定在 strip 上**。

傳進來的 runtime 不在 strip 上時丟例外，不回空陣列 —— 那只可能是呼叫端存了過期引用，靜默回空會把錯誤藏起來。

#### `getVisibleIcons()`

```ts
// ReelIconManager：進場端 → 退場端
// BaseReel / BaseSlotMachine：畫面閱讀順序
public getVisibleIcons(): BaseReelIcon[];
```

**「可視段的每一格」與「圖有露出來的 group」不是同一件事**，截斷盤面上兩者會分岔：

```text
可視 [73, 73, 1]，73 是 1×3        實機輸出（tests §9 與測試場景狀態列一致）
 idx2 │ 73:0 │ ← head 在進場 buffer   visible ids  = [73, 73, 1]
 ═════╪══════╡ ← 顯示區上緣           visibleIcons = [2:73, 5:1]
 idx3 │ 73:1 │ ← follower，不畫
 idx4 │ 73:2 │ ← follower，不畫
 idx5 │  1:0 │
 ═════╧══════╡
```

`getVisibleRuntimes()` 給的是 idx3~5 —— 其中兩格什麼都沒畫，而**真正畫著圖的 head 反而不在那份清單裡**。中獎表演要拿的是 `getVisibleIcons()`。

**判準：該 group 在可視段裡至少擁有一格，回傳那一組的 head。** 圖正好等於 head 起算 `cellSpan` 格，所以這個條件與「圖與顯示區有交集」等價，而且是純索引算術 —— Cocos 版的 `getIntersectingSymbols()` 要做幾何比較加 `alignmentEpsilon`，1×1 之後整段消失。一個 group 只回一個載體，不會因為占三格就出現三次。

**滾動中多露一格**：`stripOffset > 0` 時整條 strip 往退場方向滑了不到一格，進場側再外面那一格會有一部分露進顯示區，因此列入；`stripOffset === 0` 時它的邊緣正好貼齊上緣、交集為零，排除。判斷只需要比較 `stripOffset` 與 `0`，不需要容差。

> 這一項同時把 [Port-Completeness-Audit.md](Port-Completeness-Audit.md) §4 的缺口 2 與缺口 3 一起結掉 —— 缺口 3 原本卡在「『有交集』的判準要先討論」，上面那條就是判準。剩下的只有「要不要再開一個回傳 Runtime 的版本」。

#### 決議 38：Icon 收在普通容器裡，不直接掛在 `BaseReel` 上

```text
BaseReel (eui.Component)
  └─ _iconLayer (egret.DisplayObjectContainer)   ← 建立時加一次，之後不動
        └─ icon × stripCellCount
```

`eui` 系的容器會在每次子項增刪時強制重新測量：

```ts
// src/extension/eui/core/UIComponent.ts:1847-1867
export function implementUIComponent(descendant, base, isContainer?): void {
    ...
    if (isContainer) {
        prototype.$childAdded = function (child, index) {
            this.invalidateSize();
            this.invalidateDisplayList();
        };
        prototype.$childRemoved = function (child, index) { /* 同上 */ };
    }
}
```

`eui.Component` 與 `eui.Group` 兩個註冊時都傳 `true`（`Component.ts:1023`、`Group.ts:905`），而普通 `DisplayObjectContainer` 的同名方法是**空實作**（`DisplayObjectContainer.ts:681`）。

關鍵在 `setChildIndex()` —— `displayPriority` 重排正是靠它，而它會**同時觸發兩者**：

```ts
// DisplayObjectContainer.doSetChildIndex()
if (lastIndex == index) { return; }        // ← 位置沒變就早退，兩個 hook 都不跑
this.$childRemoved(child, lastIndex);
this.$children.splice(lastIndex, 1);
this.$children.splice(index, 0, child);
this.$childAdded(child, index);
```

**成本是有條件的，不是持續在付**：`sortIconDisplayLayers()` 的次要排序鍵就是目前的 child index，所以權重全等時排序結果等於現狀、每次 `setChildIndex` 都是 no-op → 零失效。真正付錢的是牌庫裡有不同 `displayPriority` 的 Symbol 時（決議 19 保留它的使用情境）。

內移是**預防**，不是止血 —— 成本五行，換掉一個會靜默出現的坑。mask 仍然設在 `BaseReel`（或機台）上，照樣夾住整棵子樹；`_iconLayer` 位置是 `(0, 0)`，icon 座標完全不變。

> 這也回到 [Egret-Slot-Exml-Editable-Surface.md](Egret-Slot-Exml-Editable-Surface.md) §3.2 的原規劃（「Icon 掛在殼內的普通 `DisplayObjectContainer`」）。該文原本連 `BaseReel` 都規劃成純 class 另加 `ReelView` 殼，實作沒有走那條 —— `BaseReel` 直接 `extends eui.Component`。差異保留，只把 Icon 那一層的理由拿回來。

#### 決議 39：跨軸表演搬的是表演物件，不是 Icon

大 Symbol 要蓋過隔壁軸時，巢狀容器表達不出交錯的 z 序 —— reel A 的全部子項一定整批在 reel B 的全部子項之前或之後。

**決議：不靠 z 序交錯，改用 overlay 層 + 單向跟隨。**

```text
BaseSlotMachine  (mask 在這 → overlay 也被裁切)
  ├─ reel[k] → _iconLayer → icon[k] → 美術子物件
  └─ overlay                          ← 層級在全部 reel 之上
```

| 規則 | 內容 |
|---|---|
| **Icon 永遠不搬** | 位置維持由框架獨佔（`syncIcon()` 每幀寫 `icon.x/y`） |
| **搬的是掛在 Icon 上的表演物件** | Icon 持有它的引用 |
| **跟隨是單向的** | 進入轉移狀態後每幀 `表演物件.worldPos = icon.worldPos` |
| **overlay 在機台 mask 之內** | 搬上去的表演物件仍然受顯示窗裁切 |

因為跟隨是單向的，框架照常寫 icon 座標**不會**跟 overlay 上的擺位打架 —— 原本擔心要在 `syncIcon()` 加 detach 判斷，不需要。`localToGlobal()` / `globalToLocal()` 兩個都在（`DisplayObject.ts:1807` / `:1765`）。

**尚未實作。要做時框架要補三樣：**

1. **overlay 容器** —— 機台子項，層級在 reel 之上
2. **每幀跟隨的驅動** —— **不能掛在 `syncAllIcons()` 上**：它只在 Movement 的值變化時才跑，停穩且效果播完之後就不跑了，而中獎表演正好都在那個時候。要掛在 `BaseSlotMachine.update()`（決議 37 抽出來的那個，每幀都跑）。機台自己動時（整台震動、縮放）world position 會變而 `syncAllIcons()` 不會觸發，也只有機台層的每幀迴圈接得住
3. **`BaseReelIcon` 的表演物件契約** —— 目前它是純空殼，美術在遊戲子類別裡私有（`TestReelIcon._art`）。框架要驅動跟隨就需要基底層有這個引用。**這是唯一會動到現有公開介面的一項**

> 這條路對應 Game1016 的 `SymbolAniHandoffManager`（422 行）。[ReelTemplate-v3-Reference-Study.md](ReelTemplate-v3-Reference-Study.md) §10 記著「新 Framework 目前把這塊完全排除在外，但遲早要面對」—— 現在知道要面對的形狀了。

#### 決議 40：Reel 與 Reel 之間的層級排序，用保留槽位的做法

reel 之間也要能排層級高低。不能照抄 `sortIconDisplayLayers()` 的「排完指派 0…n-1」—— 那是因為 `_iconLayer` 整個容器由框架獨佔；機台底下還會有外框、光暈那類美術子項，指派連續索引會把它們一起推走。

**決議：收集 Reel 目前占用的那幾個 child index，排序後依序塞回同一批槽位**，非 Reel 的子項一格都不動。

```text
機台子項：  [底框, reel0, reel1, reel2, 上框]
Reel 槽位： 索引 1、2、3
重排後：    [底框, reel2, reel0, reel1, 上框]     ← 兩個框都沒動
```

配合 `doSetChildIndex()` 的早退，只有真的換位的 Reel 才付失效成本。不另外插一層 `_reelLayer`，因為那會讓 exml skin 的子項被搬離 host，換 skin 時 eui 的清理會跳過它們（`Component.ts:279-287` 的 `if (child.$parent == this)`），留下孤兒。

**尚未實作。** 層級優先度的**來源**也還沒定：`displayPriority` 是 `ReelSymbolRegistry` 上「這張牌」的屬性，而 Reel 層要的比較像「這一輪哪一軸有溢出的大牌」，是 per-spin 的動態值，不是同一個軸。與 `displayPriority` 一起在整頓機台時設計。

### 3.10 軸向效果設定：兩個同構介面合併成一個

**問題**：`ReelStartEffectConfig`（27 行）與 `ReelBounceConfig`（26 行）**欄位完全相同** —— `enabled` / `distance` / `outwardDuration` / `returnDuration` / `outwardEasing` / `returnEasing`。而 `ReelBounce.ts:6-13` 內部還有第三份一模一樣的私有 `ReelAxisEffectConfig`。

執行面也是同一套，`BaseReel` 用**同一個 class** 開兩個實例，只差方向正負號：

```ts
// BaseReel.ts:102-103
private readonly _startEffect = new ReelBounce();
private readonly _bounce      = new ReelBounce();

// 啟動逆滾動方向、停止順滾動方向
this._startEffect.start(-this._iconManager.movementSign, this._effectTimeScale);
this._bounce.start(      this._iconManager.movementSign, this._effectTimeScale);
```

**命名不對稱是病徵**：`StartEffect` 用**時機**命名、`Bounce` 用**行為**命名。前者暗示「只有開始才有效果」，後者把停止端鎖死成「回彈」這一種表現。

**決議**：

```ts
// 新增：Config/ReelEffectConfig.ts（把 ReelBounce.ts 的私有介面升為公開）
export interface ReelEffectConfig {
    readonly enabled: boolean;
    readonly distance: number;          // 沿效果方向移出的距離
    readonly outwardDuration: number;
    readonly returnDuration: number;
    readonly outwardEasing?: ReelEffectEasing;
    readonly returnEasing?: ReelEffectEasing;
}
```

| 項目 | 原本 | 改成 |
|---|---|---|
| 型別 | `ReelStartEffectConfig` + `ReelBounceConfig` | **`ReelEffectConfig`**（與既有 `ReelEffectEasing` 同族） |
| `BaseReelConfig` 欄位 | `startEffect` / `bounce` | **`startEffect` / `stopEffect`** |
| 實作類別 | `class ReelBounce` | **`class ReelAxisEffect`**（它同時被啟動效果使用，叫 Bounce 本來就不對） |
| Callback | `onBounceStarted` / `onBounceCompleted` | **`onStopEffectStarted` / `onStopEffectCompleted`** |
| 查詢屬性 | `bounceActive` | **`stopEffectActive`** |

用 `stop` 而非 `end`，與框架既有詞彙一致（`ReelState.Stopped`、`onRollStopped`、`stopMode`、`targetStopTime`、`waitForStoppedAsync`、`ReelStopFlow`、`ReelStopPlan`）。

方向正負號仍由 `BaseReel` 決定，不寫進 config。

**影響範圍（實測）**：所有引用端都在 `ReelConfig.ts` 與 `BaseReel.ts`，兩者都屬階段 7。現在改只動 3 個檔案；階段 7 之後再改要同時處理 `BaseReel.ts` 內的 10 處引用。

**未來若出現第三個時機**（聽牌加速、ReSpin 進場…），共用型別已直接支援，只需在 `BaseReelConfig` 多一個具名欄位。時機多到需要動態指定時才考慮改成 `Map<時機, ReelEffectConfig>`，現階段不預先抽象。

---

## 4. 刪除清單

| 檔案 | 內容 | 約略行數 |
|---|---|---|
| `ReelIconManager.ts` | `ReelEntryProjectionSymbol` 介面（`:11`） | 7 |
| | `calculateResultEntryHalfCellCount()`（`:360`） | 70 |
| | `calculateQuickStopHalfCellCount()`（`:438`） | 57 |
| | `collapseProjectionResult()`（`:881`） | 27 |
| | `recycleProjectionSymbol()`（`:908`） | 26 |
| | `canProjectionHandoff()`（`:934`） | 16 |
| | `isProjectionAligned()`（`:950`） | 50 |
| `ReelDataFlow.ts` | `collapseResultCellData()`（`:328`） | 27 |
| | ~~`takeDataByCellBudget()`（`:355`）~~ ※ | 45 |
| | ~~`takeNextPerformanceDataThatFits()`（`:400`）~~ ※ | 27 |
| | ~~`takeNextSingleCellPerformanceData()`（`:427`）~~ ※ | 24 |
| `ReelStopFlow.ts` | 奇偶修正 + 兩個死碼函式 | ~50 |
| `BaseSlotMachine.ts` | 半格差 throw + 相關分支 | ~20 |

> ※ **本表與 §3.5 曾經矛盾，以 §3.5 為準。** 這三個裝箱函式**不刪**，
> §3.5「裝箱收尾（保留但降級）」才是定案：停輪時間仍需湊到精確 cell 數，
> 策略不變（塞到放不下為止，尾巴用 1×1 補滿），牌庫至少要有一張 1×1。
> 實作結果是 96 行縮到 54 行並改名；後續又把前兩者合併為單一的
> `takeNextPerformanceSymbol(accepts, …)`（見 [Core-Responsibility-Slimming.md](Core-Responsibility-Slimming.md) §3.1）。
> 差別只在：改完之後裝箱失敗只影響**表演牌的長相**，時間永遠精確。

小計約 **440 行**，且都是最難推理、最難驗證的部分（含兩個 1000 步模擬迴圈）。

改用計算式位置（§2.8）後再追加：

| 檔案 | 內容 | 約略行數 |
|---|---|---:|
| `ReelIconManager.ts` | `getPositionBefore()` / `getPositionAfter()` / `getEntryPosition()` | ~35 |
| | `sortByDisplayOrder()` | ~10 |
| | `recycleExitedIconKeepingData()`（沒資料時的特例，改成不換資料即可） | ~30 |
| | 21 處 `alignmentEpsilon` 的大部分 | — |

合計約 **515 行**。

---

## 5. 驗證計畫

### 5.0 執行方式

不必 `egret build`、不用開瀏覽器，直接編譯成 CommonJS 用 node 執行：

```bash
tsc --module commonjs --target es2017 --outDir temp/tests --skipLibCheck \
    tests/CoreGeometry.test.ts \
    libs/modules/egret/egret.d.ts \
    libs/modules/eui/eui.d.ts

node temp/tests/tests/CoreGeometry.test.js
```

**型別檢查用真正的 `.d.ts`，執行期用 stub。** 階段 6 之後 `BaseReelIcon extends eui.Component`，node 下沒有這個全域，因此 `tests/EgretStub.ts` 補上最小替身（位置、尺寸、錨點、子項管理）並且必須是測試檔的**第一個 import** —— `class X extends eui.Component` 在模組載入當下就求值。

由於型別仍以真正的 `.d.ts` 為準，stub 少實作的成員不會被誤用而無聲通過。

> Cocos 版當初的 Phase 4 verification 用的是同一套手法，只是 stub 的對象是 `cc`。

**執行結果**：175 項斷言全數通過。原有 56 項（階段 5 首次執行，階段 6 接上顯示層後重跑仍全過）涵蓋下列第 1～3 項與部分第 6 項；其餘為決議 30 新增 10 項（`7d`，§2.2.2）、預算切資料 6 項（`7e`，§3.5）、截斷兩端 5 項（`7f`，§2.3.1）、決議 34 與 `getGroupIcons()` 29 項（`8`～`8d`，§3.9）、`getVisibleIcons()` 在截斷盤面與滾動中 14 項（`9`／`9b`，§3.9）、四方向 18 項（`10`～`10c`，§2.5）、多軸協調、守門與 Turbo 同步兩個順序 37 項（`11`～`11j`，§3.6／§3.8）。



建議照 Port Map §10 的順序，在**還沒接 Egret 顯示**之前就用純 TS 斷言驗完幾何：

1. 初始 Layout：1×1／1×2／1×3 混合，三段長度驗證。
2. `groupOffset` 推導：`[7,7,1]`（截斷）、`[7,7,7,7]`（整除）、全 1×1。
3. 結果收尾補格：驗證補出的 head 落在進場 buffer、且 `resultSpinId` 正確。
4. 跨輪：上一輪停在截斷盤面，`startRoll()` 後 head 沒有被換掉（§3.6）。
5. 停輪時間：`剩餘 cell 數 × moveInterval` 與實際停止時間的誤差。
6. 四方向：垂直正／反、水平正／反，各跑一次 2～5。
7. Turbo 同步：多軸剩餘距離差必為整數格，不再有 throw。
8. 連續十輪混合尺寸。

---

## 6. 未定案

> **已結案（記錄在此避免重複追查）**：group 邊界原本有兩個破口，現在都堵上了。
> **① strip 上已經進場的殘組** —— 決議 30（§2.2.2）拆成 1×1。這就是第二棒交接文件
> `SESSION-2026-09-13-B-Slimming-Stage9.md` §2 記的「Bug 3」。
> **② 還在資料佇列裡、被預算切壞的殘組** —— `takePerformanceCellsByBudget()` 改成逐組取（§3.5 實作補記）。
> 這一項與 Bug 3 **不是同一件事**，差別在殘組所在的位置（§2.0）。
> **③ 退場端截斷推導不出來** —— 原本列為未定案（「要另外開 API」），實際上不需要：head 恆在進場側，方向是常數，從 per-cell 陣列就推得出來。已由決議 31（§2.3.1）實作，`createExitTruncationCells()` 與進場端的補格互為鏡像。

- **`isAligned()` 不檢查 group 完整性。** `ReelIconManager.isAligned()` 只比對可視格的 `data.id` 與 `resultSpinId`，所以像 `1, 2, 0` 這種錯位的盤面它會放行（決議 30 之前實測過）。要不要補一道「可視段必須自成完整的組」的檢查（判準見 §2.2.1 的對照表），未定。

- **`onHalfCellComplete` 這個對外 Callback 要不要保留？** 交接改成每整格固定執行（§3.4）之後，它與交接時機脫鉤。若沒有遊戲端在用第一個半格的時機，傾向保留 Callback 但退回單純的時間通知；待確認。
- **`reconfigureStoppedLayout()` 的展開行為**：1×1 展開成 1×N 時，多出來的格子從哪裡取、原本那些 runtime 的 `groupOffset` 怎麼重算，還沒設計。
- **大 Symbol 的中獎動畫／handoff**：形狀已定（決議 39：overlay 層 + 搬表演物件 + 單向跟隨），**尚未實作**；三個待補項與唯一會動到公開介面的那一項見 §3.9。
- **`cellSpan <= visibleCellCount` 要不要加驗證？** 決議 32 已定下這條限制，但 `registerSymbolCells()` 與 `init()` 目前都不擋。超過時 `createExitTruncationCells()` 會靜默退回「只補進場端」，盤面被單一 Symbol 填滿時會算錯。
- **Icon 數量對 Egret 的影響**：strip 從 `visible + 2` 變成 `visible + 2 × maxSpan`；Egret 沒有內建 Pool（見 Port Map §11），5 軸 × 11 格 = 55 個顯示物件要實測。
- **`ReelLayoutSource` 的排列順序約定**：目前沿用 Cocos 版的資料流方向（進場端 → 退場端），實務上沒出過問題。曾評估改成畫面閱讀順序（與 Server 結果一致、企劃不必考慮滾動方向，欄位須改名 `leadingBuffer` / `trailingBuffer`，並由 `BaseReel` 做三段對調＋各自反轉的轉換），**暫不採用**，需要時再調整。
- **掉落式（Drop）本身不在本次範圍**：位置模型已預留 `cellOffset[k]`（§2.10）。現況評估、v3 對照、連續牌帶出的五個問題與決議 33 已另文記錄 → [Drop-Module-Readiness.md](Drop-Module-Readiness.md)。
- **`tsconfig.json` 的 `lib` 與 `tslib`**：搬遷前必須先決定，否則純 TS 檔編不過。詳見 §7。
- **搬遷順序（階段 0～9）尚未寫入本文件**，等 §7 的兩個決定拍板後再補。

---

## 7. 搬遷前置：兩個編譯阻礙（實測結果）

曾把 10 個純 TS 檔實際搬進 Egret 專案跑過一次 `egret build`，已復原。結論：

**ES module 可用。** 沒有出現任何模組解析失敗，`import` / `export` 在 Egret 的 webpack bundler 下正常運作，且能與 `Main.ts` 那種全域 class 共存。這點原本不確定，現在確定了。

但有兩個阻礙：

### 7.1 `tsconfig.json` 的 `lib` 不足

全 Core 用到的 ES2015 API：

| API | 次數 | 出現位置 |
|---|---:|---|
| `Number.isFinite` | 12 | BaseMovement、ReelBounce、ReelIconManager、BaseReelIcon、BaseReel、ReelDataList |
| `Number.isInteger` | 6 | ReelSymbolRegistry、BaseReel、ReelDataList |
| `Map<>` | 2 | ReelSymbolRegistry |
| `Math.sign` | 1 | ReelBounce |

目前是 `"lib": ["es5", "dom", "es2015.promise"]`（Cocos 那邊 target 是 es2020 所以沒事）。

| 選項 | 說明 |
|---|---|
| A | 加 `"es2015"`，全開 |
| B | 只加 `"es2015.core"` + `"es2015.collection"`，剛好覆蓋上表 |
| C | 把這 21 處改寫成 ES5 寫法（污染「零改動」檔案） |

建議 **B**。這只是型別層面的開關，這些 API 瀏覽器自 2015 起全面支援；除非要吃很舊的 Android WebView 才需 polyfill。

### 7.2 `tslib` 解析不到

```js
// scripts/plugins/node_modules/@egret/egret-webpack-bundler/lib/index.js:190
importHelpers: true
```

bundler 強制開啟 `importHelpers`，所以 `push(...data)` 這類語法會去 require `tslib`。`tslib` **確實存在**，但位置在 `scripts/plugins/node_modules/tslib` —— 從 `src/` 往上找 `node_modules/` 找不到。

| 選項 | 說明 |
|---|---|
| A | tsconfig 加 `baseUrl` + `paths` 指向該位置 |
| B | 專案根目錄 `npm install tslib`（多一個 `node_modules/`） |
| C | 改掉觸發 helper 的語法（`push(...data)` → 迴圈） |

建議 **A**，不新增 `node_modules`、不動程式碼。

> 註：當時的錯誤輸出被 `Select-Object -Last 25` 截斷，實際錯誤可能更多（例如 `ReelSymbolRegistry` 的 `Map` 就不在可見範圍內）。前置處理完成後跑一次完整 build 才會知道全貌。
