# 基本單位改回 1×1：設計決議與修改清單

> 對象：`D:\cocosTest\NewSlotMachine\SlotFrameWork\SlotMachine\assets\Script\SlotMachine\Core`（Cocos 完成版）
> 目的：移植到 Egret 的同時，把「Runtime = 1×N Symbol」改成「Runtime = 1×1 Cell」。
> 姊妹文件：[Cocos-To-Egret-Slot-Port-Map.md](Cocos-To-Egret-Slot-Port-Map.md)、[Egret-Slot-Exml-Editable-Surface.md](Egret-Slot-Exml-Editable-Surface.md)、[ReelTemplate-v3-Reference-Study.md](ReelTemplate-v3-Reference-Study.md)
> 後續：[Core-Responsibility-Slimming.md](Core-Responsibility-Slimming.md) —— 移植完成後的責任重劃與瘦身量測，決議 21 起編號於該文
> 執行期：[Core-Runtime-Flow.md](Core-Runtime-Flow.md) —— 從心跳到停輪的實際路徑流程圖
> 掉落式：[Drop-Module-Readiness.md](Drop-Module-Readiness.md) —— Drop 模組的現況評估與前置決議，決議 33 起編號於該文
> 交接：[SESSION-2026-09-17-Machine-Display-And-MultiReel.md](SESSION-2026-09-17-Machine-Display-And-MultiReel.md) —— 決議 34～40 的落地經過、四個 bug、以及還沒做的事
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
| 41 | **自動旋轉移出框架**：`autoSpin()` / `stopAutoSpin()` 及其狀態與接續鏈全部刪除，改由遊戲流程層持有（見 §3.8） |
| 42 | **聽牌時間在規劃時算定**（含 `speedMultiplier` 換算與切速邊界）；`fastMode` 或急停時**框架不排聽牌時間**，`onListenStart` / `onListenEnd` 照發由遊戲層決定（有設定聽牌的軸一律成對發出，已實作）；聽牌途中急停**依照當下速度**；`speedMultiplier` 限制 `>= 1`（見 §3.8）。已實作。**聽牌起點由決議 46 改為前一軸實際停輪** |
| 43 | **普通模式急停補「剛好足以依序停止」的表演格**：砍完表演格後依停輪順序逐軸推算，早於前一軸就補 `ceil(差 / mi)` 格；與 Turbo 同步同一套機制、補的數量不同（見 §3.8） |
| 44 | **啟動順序與停止順序分開設定**：`SlotMachineSpinConfig` 新增選填 `stopTimings`（`reelIndex` + `stopDelaySeconds`），停止順序照它的陣列；未填時與現在相同（見 §3.8） |
| 45 | **停輪量化誤差壓到 0**：每格邊界重算本格時間，只拉長不壓短，上限 ε = +25%；「不晚停」改以連續時間計（畫面最多晚一幀）；規劃以各軸**實際啟動那一幀**為原點（見 §3.7）。已實作 |
| 46 | **聽牌從前一軸實際停下起算**：聽牌軸目標 = 前一軸**實際**停輪 + `duration`（決議 42 用的是規劃停輪，伺服器晚到時聽牌被吃掉）；規則已實作；最初的「延後提交」做法已由決議 47 取代（見 §3.8） |
| 47 | **資料到達時沿停止順序直接推算每軸停輪**：普通軸 = max(規劃, 前一軸停輪 + 軸間距, 本軸最早能停)、聽牌軸 = max(前一軸停輪 + `duration`, 本軸最早能停)，立刻提交。伺服器晚到時軸間隔與順序照樣保留（本決議前 Cocos 版與 Egret 版都會亂）；連帶修正啟動效果播完那一幀時間被用兩次（見 §3.8）。已實作 |
| 48 | **Turbo（`fastMode`）停止間隔為 0**：`stopDelaySeconds` 一律當 0、只保留停止順序，與 Cocos 移植版相同；已寫進 `SlotMachineSpinConfig` 說明（見 §3.8）。已實作 |

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

> **（修正前的描述，2026-09-27 已改成兩條一起轉，見下一節）Egret 版只轉 `_symbols`，`_icons` 完全不動。** Cocos 版是兩條一起 `pop` / `unshift`；移植後改成「Icon 是固定的槽位，第 k 格的資料每次交接後重新綁到固定待在第 k 格的那個 Icon」（`ReelIconManager.recycleExitedCell()` 只碰 `_symbols`，配對由 `syncIcon(k)` 維持）。
>
> 兩個推論：① 滾動期間 `ReelIconLayout.index` 對同一個 Icon 是常數；② 一次交接會讓**多數槽位的內容換人**，不是只有被回收的那一格 —— 決議 34 的觸發頻率實測就是這個原因（§3.9）。
> 掉落式的分割重排要兩條陣列一起動，屆時 `index` 才會真的變，所以它仍然每幀重推而不由 Icon 自己記住。

#### 已修：牌沒有跟著空殼走（2026-09-27）

上面那段「Egret 版只轉 `_symbols`」是**修正前**的描述。現在牌掛在空殼上、跟著空殼走：空殼一路帶著自己的牌移動，
走出畫面後才搬回進場端換新牌，`_icons` 與 `_symbols` 一起轉（與 Cocos 版相同，`ReelIconManager.rotateExitedIconToEntry()`），
`ReelIconLayout.index` 每次交接都會變。經過、驗算與斷言見 [SESSION-2026-09-27-Rolling-Fixes.md](SESSION-2026-09-27-Rolling-Fixes.md) §2。

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

#### 決議 45：把量化誤差壓到 0（已實作）

> **2026-09-26 定案並實作。** 本節下方的「現況誤差界線」「提案」「驗算」是定案前的紀錄，保留作依據；
> 其中「決議方向：維持早停」已被本決議推翻，公式以本段為準。實作與驗算見本段末的「實作」。

##### 定案內容

**做法**：每個 Cell 邊界重算本格時間。

```text
本格時間 = clamp((目標 − 現在) / 剩餘格數, 原速, 原速 × (1 + ε))
```

- **只拉長、不壓短**（下限就是原速，與下方早期提案的 `base × (1−ε)` 不同）
- **「現在」用連續時間**：本軸逐格累加實際走過的時間，不用 `elapsedRollTime`（它每幀開頭就吃掉整幀，最多領先真實邊界一幀）
- **聽牌分段**：切速前以切速邊界為目標、切速後以真實聽牌結束為目標（接決議 42）
- **急停後停止修正**：依照當下速度走完（決議 43 推算剩餘秒數的前提）

**三個決定**：

| # | 問題 | 決定 | 理由 |
|---|---|---|---|
| 1 | 「不晚停」的定義改變 | **接受** | 連續時間準時；停輪落在幀中間，畫面上最多晚一幀（60 fps 0.017 秒、30 fps 0.033 秒），遠小於現況最多早一格（Normal 0.08 秒）。企劃若要嚴格的整輪上限，把設定時間提早一幀填，框架不為此改動 |
| 2 | 實際原點 | **一起做** | 規劃停輪時以各軸**實際啟動那一幀的開頭**為原點，不用規劃的啟動時刻。只做自我修正時決議 44 的停輪反轉仍有 20 組，加上後 **0 組** |
| 3 | ε | **+25%** | 每格拉長中位數約 1%、p99 7.1%、最大 20%（聽牌切速後剩餘格數少時）；+25% 從未觸發。早期寫的「可收緊到 ±15%」是聽牌分段前量的，已不適用 |

碰到 ε 上限時補不完的部分就放著，結果是稍微早停 —— 等於局部退回現況，不會出錯。

##### 實作（已完成）

`moveInterval` 拆成兩個欄位：`BaseReel._moveInterval` 維持**基準**（聽牌切速改它，`moveInterval` getter 讀它），
**本格時間**不另存欄位 —— 每格排入時由 `calculateNextCellDuration()` 現算，記在 `_cellDuration`。

| 位置 | 內容 |
|---|---|
| `BaseReel._cellStartTime` / `_cellDuration` | 本軸連續時間：第一格從 `beginFirstCellMovement(cellStartTime)` 起算（`startRoll()` 進來是 0；啟動效果播完才進來是**那一幀的開頭**，因為同一幀的 Movement 吃的是整幀），每個邊界 `+= _cellDuration` |
| `BaseReel.calculateNextCellDuration()` | 本格時間 = `clamp((目標 − 現在) / 剩餘格數, 原速, 原速 × (1 + MAX_CELL_STRETCH))`。有預定切速時目標是 `switchAtSeconds`、格數數到切速；已提交時目標是 `_correctionTarget`、格數 `_cellsUntilStop`；急停／即停之後回原速 |
| `BaseReel.MAX_CELL_STRETCH` | `0.25`（ε） |
| `BaseReel.countCellsBeforeTarget(now)` | 提交時到目標放得下幾格，取 floor（多一格就一定晚停）。有預定切速時分兩段：切速前的格數 + `floor((聽牌結束 − switchAtSeconds) / 聽牌速度)` |
| `BaseReel._cellsUntilStop` / `_correctionTarget` | 提交時寫入（`ReelStopFlow.tryCommitResultAtHandoff()` 回傳到停輪的格數），每個邊界遞減。聽牌軸的目標是**聽牌真實結束**（`_scheduledSpeedChange.stopSeconds`），不是原速等效時間 |
| `BaseReel.planListenSpeedUp()` | 下一個邊界改用連續時間（`_cellStartTime + _cellDuration`）；聽牌在第一個可切速的邊界之前就結束時不排切速 |
| `ReelStopFlow.tryCommitResultAtHandoff(…, now, availableCellCount)` | 「現在」改用邊界的連續時間；表演格預算 = `availableCellCount − 結果進場格數`。回傳到停輪的格數（原本回傳 boolean） |
| `ReelStopFlow.retimeStopPlan()` / `BaseReel.retimeStopPlanForCorrection()` | `lastStopPlan.actualStopTime` 改成修正預計達到的時刻 `min(目標, 格線 × (1 + ε))`（僅供除錯） |
| `BaseSlotMachine._originByReel` / `getReelOrigin()` | 實際原點：`startOneReel()` 記下本幀開頭的 `_spinElapsed`（`_frameStartElapsed`）。`createCurrentStopTimings()` 換成本軸時間時減它，停輪時刻本身仍照規劃的 startAt 排 |
| `BaseMovement.TIME_EPSILON` | `1e-9`：指令只差浮點雜訊就算本幀完成（見下方「多抓到的一個」） |

**多抓到的一個：同一刻停下被拆到兩幀。** 修正與實際原點做完之後，規劃同時停的軸在**連續時間**上已完全相同
（差 ~1e-15），但停輪時刻正好落在幀邊界時（例：2.8 = 168 × 1/60，設定值多是整數倍，很常見），
`BaseMovement` 的 deltaTime 與每段 duration 各自累加，差一點的那一方被推到下一幀 —— 看到的是分屬兩幀、
回調順序顛倒（驗算 192 組中 8 組，全是 `stopDelaySeconds = 0` 且停輪時刻為幀長整數倍）。
`BaseMovement.update()` 改成剩餘時間 ≤ `TIME_EPSILON` 就在本幀完成，時間最多超前 1e-9 秒。

**驗算**（框架實作本身，外部只量測連續時間：`_originByReel[i] + reel._cellStartTime`）：

| 情境 | 組數 | 結果 |
|---|---:|---|
| 普通模式不急停（`mi` 3 種 × 錯開 4 種 × 目標 3 種 × 平／截斷盤面 × 幀長 1/60、1/30、0.1） | 216 | 連續時間誤差 −4e-16 ～ 2e-15；盤面錯 0、回調順序錯 0、反轉 0 |
| `stopTimings` 右到左（含 `stopDelaySeconds = 0`） | 192 | 誤差 ≤ 3e-15；反轉 0、回調順序錯 0（`TIME_EPSILON` 之前 8 組） |
| 聽牌（`m` 1／1.5／2／3 × `duration` 4 種 × 聽牌軸 `[2]`／`[2,3]`／`[1,3]` …） | 1,728 | 聽牌結束誤差 0；反轉 0、盤面錯 0 |
| `fastMode`（不急停／先按／提交後 0.05） | 54 | 同步離散 0 |
| 普通模式急停依序（決議 43） | 360 | 反轉 0、盤面錯 0、回調順序錯 0 |
| 聽牌途中急停 | 54 | 反轉 0、盤面錯 0 |
| 啟動效果中規劃聽牌（本軸還在啟動效果裡） | 48 | 晚停 0、早停 0（不做切速前修正時最早 −6.67e-3） |

每格拉長（948,193 格，其中 338,042 格有拉長）：拉長的格中位數 0.35%、p99 3.95%、最大 17.5%；**碰到 ε 上限 0 格**。

**斷言**：§11d／§11e／§11m／§11p 改寫成新界線（看到的時刻「不早、最多晚一幀」；§11e 改成
`actual = max(requested, earliest)` —— earliest 改以連續時間計之後，第 2 軸的 0.5 不再早於 earliest，修正會對準它）；
§11d 加「停輪計畫就是要求的時間」、§11e 加「確實有軸被鉗制」各 1 項；
新增 §11q（11 項）：決議 44 的同時停（錯開 0.1，停在 2.8 幀邊界）、錯開 0.13（非幀長整數倍）、啟動效果中規劃聽牌、低幀率 10 fps。
共 **254 項**全過（241 + 13）。

**分別還原**：

| 還原 | 紅 |
|---|---:|
| 不修正（每格恆為原速） | 8 |
| 不用實際原點 | 3 |
| 拿掉 `TIME_EPSILON` | 2 |
| 聽牌切速前不修正 | 1 |

> **已知限制**：`lastStopPlan.actualStopTime` 是**預測**（`min(目標, 格線 × (1 + ε))`），急停在修正途中發生時，
> 已拉長的格子不會被扣回，計畫與實際會差那幾格的拉長量。計畫僅供除錯，停輪不讀它。

##### 已修：TIME_EPSILON 收尾仍會差一點點（2026-09-27）

判定走完時 `elapsed + (duration − elapsed)` 在浮點下可能比 duration 小，幀長不規則時丟掉剩餘時間、畫面倒退半格一幀。
上表的驗算用固定幀長，所以沒掃到。經過、驗算與斷言見 [SESSION-2026-09-27-Rolling-Fixes.md](SESSION-2026-09-27-Rolling-Fixes.md) §1。

##### 現況的誤差界線（1596 組實測）

> **實際停輪不晚於 `targetStopSeconds`，最壞早一個 `moveIntervalSeconds`。**

停輪只能落在完整 Cell 邊界（決議 15），而每格恆耗 `moveInterval`，所以可停時刻是一組間距 `moveInterval` 的離散點；兩個 `Math.floor` 一律往下取。

| 量測 | 界線 | 實測 |
|---|---|---|
| `realized − plan.actualStopTime` | 0 | ~1e-13（浮點噪音） |
| 單軸 `realized − requested`（未鉗制，823 組） | `(−mi, 0]` | −0.0917 ～ 0.0000 秒，零違反 |
| 多軸相鄰軸間隔 − `staggerStart`（未鉗制，96 組） | `(−mi, +mi)` | −0.0805 ～ +0.0805 秒 |
| Turbo 同步離散（48 組） | 0 | 0.000e+0 秒 |

多軸是兩軸各自量化的誤差相減，所以範圍加倍且雙向。換算成畫面（`frameRate = 30`）：Normal（0.08）最壞 **2.4 格**、Turbo（0.05）1.5 格、L2（0.016）0.5 格。

##### 決議方向：維持早停（已被決議 45 推翻）

> 下面是當時的判斷。決議 45 改以連續時間計「不晚停」，畫面上最多晚一幀，換取誤差歸零。

曾評估 `round`（誤差砍半成 ±0.5 格）與「允許晚停但不超過 1 frame」，**都否決**。理由不是 §3.7 原本寫的「順序可能反轉」（那條在「`staggerStart` 設成 `moveInterval` 整數倍」的填值規則下已不成立），而是：

> 企劃真正在意的是「整輪要在 N 秒內停完」這條**上界**（1016 的 `roll.totalRoll`，L0 0.8 秒／L1 0.5 秒）。只會早不會晚，整輪才不可能超支。

而且算過：允許晚停 T 秒時誤差界線是 `max(mi − T, T)`，要 ≤ 1 frame 得 `mi ≤ 2T = 0.0667` —— Normal 的 0.08 到不了。

##### 提案：每格邊界自我修正（已驗算，未實作）

「停在 Cell 邊界」是**位置**的約束，不是**時間**的約束。現在時間也被量化，只是因為每格恆耗 `moveInterval`。改成每次排下一格時重算：

```text
remainingCells  在結果提交時初始化 = round((actualStopTime − elapsed) / base)，
                之後每個邊界遞減；actualStopTime 變動（急停改寫）時重新初始化
target          = max(requestedStopTime, earliestStopTime)
duration        = clamp((target − elapsed) / remainingCells,
                        base × (1−ε), base × (1+ε))
```

三個性質：**自我修正**（急停砍格、Turbo 插格之後自動跟上，不需要重算通知）、**零新狀態**（除了剩餘格計數）、**改動點集中**（`_secondHalfCompleteHandler` 那行 `queueOneCellMovement(this._moveInterval)`）。

> **剩餘格數必須從 `actualStopTime` 推，不能從 `requested` 推。**
> `requested ≥ actual`，用它會高估格數、每格算得太短，結果**比現況更早停**。
> 第一版驗算就是栽在這裡（Normal 從 −0.0400 惡化到 −0.0755）。

##### 驗算結果（`setActiveMoveInterval()` 從框架外模擬，未改框架）

| | 現況 floor | 提案 |
|---|---|---|
| 單軸 Normal（mi 0.08） | −0.0400 ～ 0 | **−0.0000 ～ 0.0000** |
| 單軸 Turbo（mi 0.05） | −0.0500 ～ 0 | **−0.0000 ～ 0.0000** |
| 單軸 L2（mi 0.016） | −0.0080 ～ 0 | **−0.0000 ～ 0.0000** |
| 三軸軸間隔 | ±0.0803 | **±0.0003**（取樣步長，真值 ~0） |

速度變動幅度（n = 8278 格）：範圍 −0.8% ～ +14.3%，**中位數 0.0%**、90% 2.0%、99% 6.3%。ε 設 ±25% 從未觸發，可收緊到 ±15%。（聽牌分段後最大值為 20%，15% 不夠；決議 45 定為 +25%）

**對同步停輪零影響**（fastMode 三軸離散，含急停三種時機、平盤面與含截斷的大牌盤面）：

| 情況 | 現況 | 提案 |
|---|---|---|
| 幾何相同 / delay 0 / target 相同 | 0.00e+0 | **0.00e+0** |
| **幾何不同**（span 1/2/3、可視 3/4/5） | 0.00e+0 | **0.00e+0** |
| `startDelaySeconds = 0.1` | 0.00e+0 | **0.00e+0** |
| 各軸 target 不同（t / t+0.2 / t+0.4） | 4.00e-1 | 4.00e-1 |

最後一列兩邊相同 —— 那是設定要求三軸停在不同時刻，框架照辦，不是缺陷。同步關係由補牌在更早的階段決定（補的是**格數**），提案的修正量在各軸之間一致，兩者不衝突。

順帶：軸間隔誤差因此與「`staggerStart` 是否為 `moveInterval` 整數倍」脫鉤（`0.3 / 0.08 = 3.75` 也降到 0），那條填值建議變成非必要。

##### 實作前必須先處理的衝突

> **聽牌與本提案搶同一個欄位。** `BaseSlotMachine.runOneListenReel()` 呼叫
> `setActiveMoveInterval()` 改速度，而本提案每格也要改。實作時必須把
> **基準 `moveInterval`** 與 **本格時間** 拆成兩個欄位，聽牌改前者、
> 自我修正算後者 —— 否則兩者互相覆蓋。
>
> **所以這一項排在聽牌之後做。**
>
> （更新：聽牌已實作，但決議 42 **沒有**拆欄位，所以拆欄位由決議 45 實作時處理。）

另外兩條沒驗過的路徑，實作時要補斷言：**低幀率**（大 deltaTime、`drainPendingHandoffs()` 一次交接多格時剩餘格計數會不會失準）、**即停／停軸後重排**（本來就沒斷言）。

**連帶結清**：決議 44 底下「規劃間隔小於一格時，不急停也會反轉」選 ③ 等本項。實作時加一組斷言：錯開啟動 0.1、
`stopTimings` 右到左、`stopDelaySeconds = 0`，五軸實際停輪時刻差應趨近 0。

驗算腳本在 scratchpad（`timing-sweep.js` / `multi-sweep.js` / `opt4.js` / `opt4-sync.js` / `step-check.js`），**session 結束會消失**，需要時照本節的公式與參數重建。


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

#### 決議 41：自動旋轉移出框架

**刪除的東西**（全部集中在 `BaseSlotMachine`，其餘檔案零引用）：

```
_autoSpinEnabled / _autoSpinMode
autoSpin(mode) / stopAutoSpin()
startNextAutoSpinIfNeeded()
immediateStop() 內的 stopAutoSpin() 呼叫
cleanup() 內的兩行重置
completeStoppedSpin() 尾端的 await startNextAutoSpinIfNeeded()
```

連帶 `completeStoppedSpin()` 收回成同步方法，兩個呼叫端（`stopSpin()`、`waitForImmediateStop()`）去掉 `await`。

**理由一：參考譜系裡沒有任何一個對應物長在滾輪框架內。**

| | 位置 |
|---|---|
| v3 底層（`ReelTemplate/v3/Scripts`） | 搜 `auto` **零命中** |
| 1016／1024 的入口 | `GameRoot.onStartAuto()` → `AbstractBasicGameController.onStartAuto()` |
| 1016／1024 的「要不要下一輪」 | `AbstractBasicGameController.checkAutoNext()` |
| 1016／1024 的狀態 | `GenericUIManager._isAutoMode`、`BasicGameViewManager.isAutoSpinMode` |
| 1016／1024 的停止條件 | `GenericUI/Scripts/NewAutoSpin/`（`ConditionLine.isMeetsStopCondition()`） |

決策資料是 `checkAutoNextData = { isEnterFeatureGame, odd, balance }`，外加 `checkBalanceAndProcessBtn()`
的餘額檢查 —— **餘額、本局賠率、是否進 FG，滾輪框架一個都不該知道**。

**理由二：觸發點差一整層。** 框架接在 `completeStoppedSpin()`（滾輪全停）；1016／1024 接在
`onGameViewShowEndEventHandler`（**表演全部結束**），中間隔著 wild 位移、scatter 與算分。

**理由三：它從沒被驗過。** 來源是 Cocos 完成版的 `run-workflow/slot-machine-controller/`
（spec §5.2、plan §7 Phase 4）；`phase-4-checkpoint.md` 的驗證只有 `tsc --noEmit`，而
「AutoSpin 連續兩輪與停止下一輪」被列在**待 Cocos 場景驗證**清單裡，該資料夾沒有
`phase-4-verification.md`。checkpoint 列的測試按鈕 `startAutoSpinTest()` / `stopAutoSpinTest()`
在 Cocos 專案裡根本不存在。兩邊專案的 `autoSpin()` **呼叫者皆為 0**。

> **順帶修掉的一個真實症狀**：停止效果啟用時，autoSpin 的下一輪會踩到
> `BaseReel.startRoll()` 的 `if (this._stopEffect.active) throw` —— 因為 `completeStoppedSpin()`
> 接的是「滾動停」那一則信號，而該守衛要的是「停止效果播完」那一則。例外從上一輪的
> `stopSpin()` promise 冒出來，`_spinning` 沒人收，機台只剩 `cleanup()` 能復原。
> 這不是要修的 bug，是這個功能不該存在的病徵。

**要做 manager 的時候再動工。** 屆時該長在遊戲流程層（對應 1016／1024 的 controller），
框架這邊預期不需要任何新增 —— `startSpin(mode)` 已經是完整的單輪入口。

#### 未定案：機台層缺「完全停」的出口

**停止有兩則消息，這是設計，不是 bug。** Reel 層兩則都在，`BaseReel.onRollStopped` 的 JSDoc
自己寫著「只代表 Reel 停止移動；停止效果完成是另一個事件」：

| 消息 | 發出點 | 意義 |
|---|---|---|
| `onStopEffectStarted` | `BaseReel.completeStop()` | 停止效果開始 |
| `onRollStopped(mode)` | `BaseReel.completeStop()`，緊接前者 | **資料到定位、效果還沒推開** |
| `onStopEffectCompleted` | `BaseReel.updateMovement()` 內 | **完全停** |

第二則的語意在程式碼上是精確的：`ReelAxisEffect.start()` 先 `reset()`（值設 0）再排 `moveTo`，
當下還沒 `update()` 過，所以 `syncVisualEffectOffset()` 套上去的偏移就是 0 —— 畫面確實停在對齊位置。

進場側則是**時間上的鏡像**，不是兩則並行的消息：`onStartEffectCompleted` 與
`beginFirstCellMovement()`（內含 `onRollStarted`）是同一刻前後兩行。

```
進場：  啟動效果播完  →  才開始滾
離場：  滾動先停     →  才播停止效果
```

**缺口**：`BaseSlotMachine` 整個檔案零次提到 `stopEffect`。機台層的
`onReelStopped` / `onAllReelsStopped` / `stopSpin()` 的 promise 全部經
`waitOneReelStopped()` → `BaseReel.waitForStoppedAsync()`，也就是**只轉出第一則**。

**1016 證明了第二則非轉出來不可，而且它是手工轉了四層**：

```
UniReel1016.onStopRoll()            把 bounce 包成 _endBouncePromise（註解 //--20251022新增）
  → UniReel1016.getEndBouncePromise()
    → UniReelView1016.getEndBouncePromise(reelIndex)
      → UniSlotMachine1016.getEndBouncePromise(reelIndex)      ← 機台層
        → GameViewManager1016.oneReelRollEndCallBackFromSlot()  收進 _waitReelBounceTask
```

兩個消費端都在「不等 bounce 播完就不能開始」的位置：

- `GameViewManager1016.beforeAllReelRollEnd()` —— wild 位移表演前
  `await Promise.allSettled(this._waitReelBounceTask.values())`
- `UniReelView1016.checkShowReadyHandFromEnd()` —— 秀下一軸聽牌特效前 `await bouncePromise`

而**操作**（`setIconDataAfterRollEnd()` / `writeContinueWildData()` / `regiestMultipleReelData()`）
一律掛在第一則。**兩則都要，缺一不可。**

**未定的是形狀**，不是要不要做：新增一則機台層 callback（`onAllStopEffectsCompleted` 之類）、
還是給 `BaseReel` 一個對應 `waitForStoppedAsync()` 的 `waitForStopEffectAsync()`。
兩點已確認可以不用擔心：

1. **沒有 race。** `_stopEffect.start()` 在 `completeStop()` 裡是同步跑在 `onRollStopped` 之前的，
   所以機台收到第一則的當下，`stopEffectActive` 要嘛已是 `true`、要嘛這輪本來就不播
   （效果關閉、或 Immediate 模式 —— `completeStop()` 只在 `ResultAligned` 才起效果）。
2. **現有的 `onAllReelsStopped` 不可以挪去第二則。** 那是遊戲層實際拿來做操作的那一則
   （1016 逐行印證），搬走會靜默改掉所有遊戲層的時序。要的是**新增**，不是搬。

#### 決議 42：聽牌時間在規劃時算定；快速模式與急停不排聽牌時間，表演照發（已實作）

##### 現況：`speedMultiplier` 把 `duration` 一起除掉

聽牌分兩段：

| 階段 | 位置 | 做什麼 | 效果 |
|---|---|---|---|
| 規劃 | `stopSpin()` → `createCurrentStopTimings()` | 聽牌軸目標 = 前一軸**規劃**停輪 + `duration`，寫進 `setActiveTargetStopTime()`，再 `commitResult()` | **有效** |
| 執行 | `runListenSequence()` → `runOneListenReel()` | 等前一軸停下，再 `setActiveTargetStopTime(elapsed + duration)` 與 `setActiveMoveInterval(mi / m)` | 前者**失效**、後者**生效** |

`ReelStopFlow._targetStopTime` 只在 `tryCommitResultAtHandoff()` 被讀一次 —— 結果寫進佇列的那個
Cell 邊界就把時間換算成表演格，之後沒人再讀。前一軸停下時聽牌軸早已過了那個邊界，所以改目標
無效；改速度卻在下一格生效 —— **格數不變、每格變快，聽牌時長縮成 `duration / m`**。
`m < 1` 則反過來晚停。Cocos 完成版一模一樣。

> `setActiveTargetStopTime()` 在 `stopSpin()` 那個呼叫點是正確用法（`commitResult()` 之前）。
> 失效的只有 `runOneListenReel()` 裡那一個。聽牌參數在下達停止前就全部已知，**不需要執行中改目標**，
> 那一行直接刪除。

##### 1016 的做法

- **誰聽牌**：遊戲層由 server 資料 `getReadyToHandForThisRound()` 取得軸清單，
  `UniSlotMachine1016.multiSetReadyHand()` 逐軸標記。
- **時間**：`UniReelView1016.setReelData()` → `calculateRandomDataLength()`，在提交結果的當下把
  「軸間距 + 前面聽牌軸 × `forecast.eachReel` + 自身 `eachReel`」換算成假資料格數
  （`ceil(totalTime / moveInterval)`），`eachReel` 三個速度等級都是 2 秒。
- **速度從不改變**：`moveInterval` 只在 `UniReel1016.reset()` 與手動急停
  （`manualStopClickProcess()` → `superMoveInterval`）被改。1016 沒有聽牌加速的需求 ——
  **這不代表框架不需要**，`speedMultiplier` 保留。
- **表演**：`oneReelRollEnd()` → `checkShowReadyHandFromEnd()`，**等本軸 bounce 播完**
  （`getEndBouncePromise()`）才對下一軸 `showReadyHand`。

##### 1016：速度模式高於普通（Lv1／Lv2）時，聽牌的表演與時間都不啟動

逐段確認如下：

1. **Lv1／Lv2 都算快速模式。** `MainUI.isTurboOn()` = `isFlashOn || newFlashMode !== NewFlashModeEnum.None`；
   `GameViewManager1016` 每次開轉以它設 `_currentTurboSpeed` → `startRoll()` 的 `_isTurboMode`；
   v3 `UniSlotMachine.isFastMode()` = `_isStopClick || _isTurboMode`。
2. **表演三個入口全擋**：
   `UniReelView1016.checkShowReadyHandFromEnd()`（`isFastModeCallback()` 時關掉所有預報動畫後 return）、
   `UniReelView1016.onStartRollReadyHand()`（`TurboMode !== None` 就 return）、
   v3 `UniReelView.checkShowReadyHand()`（`!isFastModeCallback()` 才顯示；1016 另覆寫成空函式）。
3. **時間被砍掉**：`calculateRandomDataLength()` 本身**不看** Turbo，照樣塞 2 秒假資料；但
   `UniReelView1016.stopRoll()` 在快速模式下立刻呼叫 `fastStopRoll()`。`UniReel1016.setData()`
   把假資料排在佇列最前端（`resultData` 倒序 enqueue），`UniReel1016.fastStopRoll()` 從前端
   dequeue 到只剩 `_iconAmount + 1 + _endCardCount`（盤面 + 上方預備 + 補牌）—— 聽牌假資料全數砍除。
4. **普通模式下手動急停也一樣取消聽牌**：`stopRollCallBack()` → `manualStopClickProcess()` 砍假資料並改用
   `superMoveInterval`；`_isStopClick = true` 之後各軸停下時 `checkShowReadyHandFromEnd()` 走快速模式分支。

> 唯一沒擋的是 `beforeStopSpin()` 仍會呼叫 `multiSetReadyHand()`（只看 NORMAL 狀態），各軸的聽牌旗標
> 照樣設上 —— 但表演與時間都被上面幾條路擋掉，沒有實際作用。

##### 決議

1. **聽牌時間在規劃時算定。** `createCurrentStopTimings()` 已知前一軸的規劃停輪 `Ls`、`duration`
   與 `speedMultiplier`，寫給 Reel 的目標換算成「原速下需要的時間」：

   ```text
   kb     = floor(Ls / mi)                      切速的 Cell 邊界（不晚於 Ls 的最後一個）
   目標   = kb·mi + (Ls + duration − kb·mi) × m
   ```

   Reel 照原本流程在提交時換算格數，並在**第 kb 格邊界自己切換速度**（`mi → mi / m`）。
   切換點在規劃時定下，**不靠**前一軸停下的事件。
2. **`fastMode` 或急停時，框架不排聽牌時間**：不換算目標、不切速度，聽牌軸照普通軸處理。
3. **`onListenStart` / `onListenEnd` 照發**，要不要播聽牌表演由遊戲層決定（1016 也是在表演層自己擋）。
4. **`runOneListenReel()` 的 `setActiveTargetStopTime()` 刪除**；它只剩「等前一軸停下 → 發回調 →
   等本軸停下 → 發回調」。

> **框架看不到「速度等級」，靠 `fastMode` 對應（已確認）。** `SpinMode` 是遊戲自訂字串，框架只認得
> `SlotMachineSpinConfig.fastMode` 與 `quickStop()`。**Lv1／Lv2 對應的 SpinConfig 一律設成
> `fastMode: true`**，由遊戲層在每次開轉時以 `startSpin(mode)` 送入 —— 框架不需要新增入口。
>
> 1016 的對應物分兩段：
>
> - **切換按鈕時**：`GameController016.onNewFlashBtnSwitch(mode)` → `GameViewManager1016.setTwoLevelTurboMode()`
>   寫入全域 `TurboMode`，並經 `_flashToSpeedMap` 切換 `DelayTimeList.currentTimeMode`
>   （決定用 `regular` / `fast_L1` / `fast_L2` 哪一組時間）
> - **每次開轉前**：`GameViewManager1016.reSetDataForBeforeSpin()` 讀 `GenericUIManager.isTurboOn`
>   （Lv1／Lv2 皆為 true）存成 `_currentTurboSpeed`，`doStartSpin()` 再傳進 `startRoll()`
>
> 我們的 `startSpin(mode)` 等於把這兩段合成一個呼叫：`mode` 同時選定時間組與 `fastMode`。

##### 驗算（2,880 組／變體，框架未改，外部 monkeypatch）

參數：`m` 0.5／1／1.5／2／3 × `duration` 0.3／0.6／1／2 × `mi` 0.016／0.05／0.08 × 可視 3／5
（平盤面與含截斷的大 Symbol 盤面）× 聽牌軸 `[1]`／`[2]`／`[4]`／`[2,3]`／`[2,3,4]`／`[1,3]` ×
軸間距 `2·mi` 與 0.1（非整數倍，讓相位錯開）。比較三種：現況、`event`（前一軸實際停下才切速）、
`planned`（本決議）。

| | 現況 | event | **planned** |
|---|---|---|---|
| 聽牌誤差（秒） | −2.80 ～ **+1.98** | −0.18 ～ +0.067 | **−0.17 ～ +0.013** |
| 連續時間的真晚停 | 大量 | **148** | **0** |
| 停輪順序違反 | 328 | 44 | **0** |
| 盤面錯誤 | 0 | 0 | 0 |
| 切換點 − `Ls`（格） | — | −2.5 ～ **+2.75** | −0.75 ～ 0 |

- `event` 的切換點取決於前一軸**實際**停下的時刻，會落在 `Ls` 之後；連續聽牌時誤差逐軸疊加。
- `planned` 的 +0.013 秒只出在**觀測**：以連續時間計反而早 0.004 秒，只是停輪落在幀中間、
  下一幀才被看到（不到 1/60 秒）。最早的一端約為「一格聽牌速度 + 一幀」（`m = 0.5` 時一格 0.16 秒）。
- `m = 1` 時三者完全相同 —— 本決議對不加速的聽牌零影響。

> **量測基準要用 `elapsedRollTime`。** 它在每幀開頭就吃掉整幀 deltaTime，而 Cell 邊界多半落在幀中間，
> 所以提交時的 elapsed 最多領先真實邊界一幀。若改用「逐格累加」量停輪，會與框架基準差出整整一格，
> 看起來像每一軸都早停一格 —— 那是量錯，不是框架的問題。

驗算腳本在 scratchpad（`listen.js` / `sweep.js`），**session 結束會消失**，需要時照本節重建。

##### 聽牌回調：有設定聽牌的軸一律成對發出（已實作）

**缺陷**：`runOneListenReel()` 等前一軸（停止順序）停下後，若聽牌軸已不是 Rolling／Stopping 就直接 return，
`onListenStart` / `onListenEnd` **兩個都不發**。前一軸在第 N 幀的 `update()` 裡停下，但 `await` 之後的續行要等
同一幀所有軸都推進完才跑 —— 聽牌軸若同幀停下（或更早），續行時它已是 Stopped。

| 情境（每組 1,920 個聽牌軸，修正前） | 發出 |
|---|---|
| `fastMode` 急停（Turbo 同步，全軸同幀） | **0** |
| `fastMode` 不急停，決議 42 實作後（不排聽牌時間 → 全軸同幀） | **0** |
| 普通模式急停（先按／下達後 0.05 秒） | 840／856（約 44%） |
| 普通模式不急停 | 全部 |

這讓第 3 條「回調照發，由遊戲層決定」做不到 —— 1016 是表演層收到後自己擋（`isFastModeCallback()`），前提是**收得到**。

**修正**：有設定聽牌的軸一律依序發出 `onListenStart` → `onListenEnd`：

- 聽牌軸仍在轉：照原流程（切速、發開始、等本軸停、發結束）
- 聽牌軸已停：**不碰速度**（對已停的軸 `setActive*` 會丟例外），直接依序發開始與結束
- `cleanup()` 或 `immediateStop()` 中止整輪時維持不發（`!_inited || !_spinning` 守衛保留）

驗證：同一組情境修正後全部 1920／1920 成對發出、盤面零錯。斷言 §11o（12 項：普通不急停對照、普通先按急停、`fastMode` 兩個進入順序；
每組檢查「各發一次、開始在結束之前、照停止順序」）。**還原成「已停就 return」時紅 6 項**（三個急停情境各 2 項，對照組照常通過）。

##### 聽牌途中急停：依照當下速度（已實作）

**規則：按下急停那一刻的速度是多少，就用多少走完，之後不再改速度。**

| 按下時 | 行為 |
|---|---|
| 已切到聽牌速度 | 維持聽牌速度 |
| 尚未切速 | 維持原速，**取消**預定的第 kb 格切速 |

- 與既有急停的設計一致：`BaseReel.requestQuickStop()` 本來就「不修改速度、duration、easing 或 timeScale」，只砍表演格。
- 實作點只有一個：Reel 收到急停時，清掉尚未發生的預定切速；已切過的不必處理。
- **這也是決議 43 正確的前提**：依序補格以「當下的 `moveInterval`」推算剩餘秒數，急停後若還會切速，推算就錯、補格就錯。
- Turbo 不受影響：`fastMode` 不排聽牌時間，也就不會切速。

驗算數據（決議 43 之前量的，按下到停輪要走幾格，以原速格數計；對照普通軸最多 10.42 格）：

| 按下時 | 最多 |
|---|---|
| 尚未切速 | 10.42（與普通軸相同） |
| 已切速，`m = 1.5`／`2`／`3` | 7.29／5.21／4.17 |
| 已切速，`m = 0.5` | 19.79（約兩倍）→ 由下一條限制排除 |

> **現況違反本規則**：目前 `runOneListenReel()` 在前一軸停下時**一定**呼叫 `setActiveMoveInterval()` 加速，
> 急停之後照切。實作決議 42 時一併修正；屆時把「聽牌 + 急停 + 決議 43 依序補格」重新驗算並補斷言。

##### `speedMultiplier` 限制 `>= 1`（已實作）

**框架不支援聽牌減速。** `speedMultiplier < 1` 時，依上一條規則，聽牌已進入減速後玩家急停，那一軸仍以慢速走完，
比其他軸晚將近一倍 —— 規則本身正確，但這個設定值本身沒有用例（`ListenReelConfig` 的 JSDoc 只寫「1 維持原速，大於 1 加速」）。

- `setListenReels()` 驗證 `speedMultiplier` 為有限數且 `>= 1`，否則丟例外（現在完全不驗，填 0 要到轉輪途中才在 `setActiveMoveInterval()` 丟）
- `ListenReelConfig.speedMultiplier` 的 JSDoc 補上「必須 `>= 1`」

##### 實作（已完成）

| 位置 | 內容 |
|---|---|
| `BaseReel.planListenSpeedUp(listenStart, listenStop, m)` | 在「不晚於聽牌開始的最後一個 Cell 邊界」排切速；目標換成 `b + (listenStop − b) × m`。切速點用本軸自己的格邊界推算（當前這格剩餘時間，或啟動效果剩餘 + 一格），不假設從 0 起每格一個 `mi`。必須在 `commitResult()` 之前呼叫 |
| `BaseReel._completedCellCount` / `applyScheduledSpeedChange()` | 每個完整 Cell 邊界計數，走到預定格就換 `_moveInterval`（在 `onCellMovementComplete` 之後、排下一格之前） |
| `BaseReel.cancelScheduledSpeedChange()` | `requestQuickStop()` / `requestImmediateStop()` 取消**尚未發生**的切速（依照當下速度） |
| `ReelStopFlow.rescaleStopPlanAfter()` | 提交時把 `lastStopPlan.actualStopTime` 切速點之後那段縮回真實時間；取消切速時放回 |
| `ReelAxisEffect.remainingDuration` | 啟動效果剩餘秒數（推算第一格邊界用） |
| `BaseSlotMachine.stopSpin()` | `fastMode` 或急停已要求時不排聽牌時間；否則對聽牌軸呼叫 `planListenSpeedUp(target − duration, target, m)` |
| `BaseSlotMachine.createCurrentStopTimings(timings, planListen)` | `planListen` 為 false 時聽牌軸照普通軸規劃 |
| `BaseSlotMachine.runOneListenReel()` | 只剩通知；`setActiveTargetStopTime()` 與事件觸發的 `setActiveMoveInterval()` 刪除 |
| `BaseSlotMachine.setListenReels()` | `reelIndex` 範圍、`duration >= 0`、`speedMultiplier` 有限且 `>= 1` |

> **沒有**把 `moveInterval` 拆成「基準」與「本格時間」兩個欄位 —— 預定切速直接換掉 `_moveInterval`，
> 決議 42 只需要這樣。§3.7「量化誤差壓到 0」實作時仍要拆（它每格都要改本格時間）。

**驗算**（框架實作本身，外部只量測）：

| 情境 | 結果 |
|---|---|
| 普通模式不急停（2,304 組，`m` 1／1.5／2／3） | 與外部模擬的 `planned` 數字相同；連續時間晚停 0、停輪順序違反 0、盤面錯 0 |
| `fastMode` 不急停／急停（各 1,152 組） | 與不設聽牌逐軸相同，同步離散 0（修正前最多 7.85 秒） |
| 普通模式急停（先按／下達後 0.05） | 與不設聽牌逐軸相同，順序違反 0 |
| 普通模式聽牌途中急停（1.3／2.0 秒） | 順序違反 0（與決議 43 依序補牌相容） |
| 回調 | 全部 1920／1920 成對 |
| 聽牌途中急停，按下到停輪（格） | 未切速 ≤ 10.42（同普通軸）；已切速 `m` 1.5／2／3 ≤ 7.29／5.21／4.17 |

斷言 §11p（17 項）：`m` 1／2／3 的聽牌時長與順序、`lastStopPlan` 換算、`fastMode` 與不設聽牌逐軸相同、
切速前／後急停的速度、`setListenReels()` 四項守門。**分別還原**：目標不換算（舊 bug）紅 2、急停不取消切速紅 1、
`fastMode` 照排聽牌紅 1、拿掉 `speedMultiplier` 有限數檢查紅 1。

> 「切速前急停」那組必須按在切速邊界前一刻（2.05 秒，邊界 2.16）。第一版按在 1.0 秒，砍完表演格後
> 這一軸走不到切速格就停了，還原「取消切速」時不會紅 —— 等於沒測到，已改正。

**未驗過**：第一軸就聽牌（沒有「前一軸」；目前聽牌窗取「停輪前 duration 秒」）、即停。

#### 決議 43：普通模式急停補「剛好足以依序停止」的表演格（已實作）

##### 現象：錯開啟動 + 急停 → 停輪順序亂掉

普通模式急停只把各軸結果前的表演格砍光（`BaseReel.applyQuickStopDataSkip()`），之後每軸在
**自己的**第一個可停 Cell 邊界停下。錯開啟動（`startDelaySeconds > 0`）讓各軸相位不同，於是後面的軸
可能比前面的早停：

```text
mi 0.016／錯開 0.1 秒／急停
onReelStopped：0@0.85 → 4@0.85 → 1@0.867 → 2@0.867 → 3@0.867
```

機台層對此**完全沒有處理**：`onReelStopped` 照實際停輪順序發（同一幀內照 `update()` 走訪的軸號），
各軸 bounce 也亂序開始，`onAllReelsStopped` 在最後一軸停下時發。

- **Cocos 完成版一樣**（node 下以 `cc` 替身實跑同一組情境，錯開啟動時 68／96 組錯亂；Egret 42／96）。
  兩邊急停路徑一致，都沒有任何維持順序的邏輯，是範本繼承來的行為，不是移植造成的。
- **不錯開啟動就不會發生**：兩邊都 0／48，全部同幀停下。
- **1016 為什麼沒有**：三個速度等級的 `staggerRoll` 都是 0（停輪的先後是靠多塞假資料做出來的，
  急停把假資料砍掉之後大家就一起停）。

> **急停只會發生在資料到了之後。** 1016 的停止按鈕從開轉就啟用（`clickStartSpinProcess()`；
> `onStopBtnClickHandler()` 註解「現在stop按鈕都要常駐狀態」），但資料未到時按下只記
> `_interruptFlag`，等 `canStopRoll()` 確認資料到了才 `manualStopClickProcess()`。
> 對應到框架就是「急停不早於 `stopSpin()`」或「`quickStop()` 先記旗標、`stopSpin()` 時才生效」——
> 兩者都在下面的兩個呼叫點內。

##### 決議

原本的設計是「砍掉表演格、直接進場顯示結果」，**沒有**要求依設定間隔到達；這點不變。
只加一件事：**砍完之後，依停輪順序逐軸補上剛好足以「不早於前一軸」的表演格。**

與 Turbo 同步補牌（`prepareFastQuickStopPadding()`）是同一套機制，**補的數量不同**：

| | Turbo（`fastMode`） | 普通模式（本決議） |
|---|---|---|
| 目標 | 全軸**同時**停 | **盡快、依序**停 |
| 補到哪 | 每軸補到最長那軸 | 每軸只補到不早於**前一軸** |
| 比較單位 | half-Cell（相位相同） | 秒（錯開啟動相位不同） |

```text
依停輪順序逐軸：
  T_i = 當前這格剩下的時間（movement.remainingDuration）+（剩下的交接次數 − 1）× mi_i
  若 T_i < T_prev：補 n = ceil((T_prev − T_i) / mi_i) 格，T_i += n × mi_i
  T_prev = max(T_prev, T_i)
```

「剩下的交接次數」依狀態有三種算法：

| 狀態 | 剩下的交接次數 |
|---|---|
| 結果未提交 | 與 Turbo 相同（`calculateQuickStopHalfCellCount()` 的行程） |
| 已提交、結果尚無格子進場 | 結果本體結尾索引 + `firstVisibleIndex` − `readIndex` |
| 結果已有格子進場 | `(firstVisibleIndex + visibleCellCount − 1) − p`，`p` = strip 上最深的本輪結果格 − 退場端墊格數 |

- **只對結果第一格還沒進場的軸補格。** 已進場再插格會把結果切成兩段、永遠對不齊（第一版驗算 9 組逾時就是這個）。
  這些軸本來就沒有表演格可砍，照原計畫依序停。
- **呼叫點與 Turbo 相同的兩個**：`quickStop()`（結果先到、玩家後按）與 `stopSpin()`（玩家先按、結果後到）。
  依 `fastMode` 二選一，Turbo 不受影響。
- **「依序」定義為不早於前一軸**；同一幀停下算合格，回調照軸號發。

##### 推算為什麼不能用 `lastStopPlan`

1. **`lastStopPlan.actualStopTime` 只精準到一幀。** 它以 `elapsedRollTime` 計，而提交發生在幀中間的
   Cell 邊界、elapsed 卻已吃掉整幀 —— 各軸領先真實邊界的量不同（0～1 幀）。兩軸真實只差不到一幀時分不出先後，
   驗算中 23 組因此差一幀反轉。改成直接數交接次數（連續時間）後歸零。
2. **資料列表讀完之後 `readIndex` 不再前進**：`ReelDataFlow.consumeNextData()` 在結果已提交且列表為空時
   直接回傳 `undefined`。所以結果進場後改看 strip 位置。退場端墊格在停輪前都還在退場 buffer 裡
   （buffer = `maxSpan` ≥ 墊格數），找得到。

##### 驗算（288 組，框架未改，外部 monkeypatch）

參數：`mi` 0.016／0.05／0.08 × 可視 3／5（完整與含截斷盤面）× 錯開啟動 0／`2·mi`／0.1／0.25 ×
急停時機「先按、結果後到」與下達停止後 0.05／0.3／0.6／1.0／1.3 秒。

| | 現況 | 本決議 |
|---|---|---|
| 停輪順序違反 | **145** | **0** |
| 盤面錯誤 | 0 | 0 |
| 推算 vs 觀測（觀測 − 推算） | — | 0.0007 ～ 0.0167 秒（< 1 幀，無一早於推算） |
| 每軸補格 | — | 1～3 格，中位數 1 |
| 補格軸與前一軸間距 | — | 0 ～ 1 格（盡快） |
| 最後一軸比現況晚停 | — | 0 ～ 0.167 秒，中位數 0 |

「現況」一欄即拿掉補格的對照組，還原修正會紅。驗算腳本在 scratchpad（`order3.js`；Cocos 對照為
`order.js` / `order2.js` 與 `cocos/` 替身），**session 結束會消失**，需要時照本節重建。

##### 實作

| 位置 | 內容 |
|---|---|
| `BaseSlotMachine.prepareQuickStopPadding()` | 兩個呼叫點（`stopSpin()`、`quickStop()`）的共用入口，依 `fastMode` 二選一 |
| `BaseSlotMachine.prepareOrderedQuickStopPadding()` | 本決議的逐軸推算與補格；與 `prepareFastQuickStopPadding()` 並列 |
| `BaseReel.calculateQuickStopRemainingSeconds()` | 急停後剩餘秒數（連續時間） |
| `BaseReel.countHandoffsUntilStop()`（private） | 三種狀態的交接次數；結果未進場時直接沿用 `calculateQuickStopHalfCellCount()` 的行程 |
| `BaseReel.canApplyQuickStopPadding` | 結果第一格已進場就回 `false` |
| `ReelDataFlow.resultExitPadCellCount` / `canInsertBeforeResult` | 上面兩者所需的唯讀查詢 |

斷言 `tests/CoreGeometry.test.ts` §11k（11 項，兩個進入順序各一組）。**還原修正時兩個順序都紅**：
停輪時刻反轉，`onReelStopped` 變成 `[2,3,4,0,1]`（玩家先按）與 `[0,2,3,4,1]`（結果先到）。

> 「至少一軸被補了格」在「結果先到」那組還原後仍通過 —— 有一軸本來就留著沒被砍的表演格。
> 真正守住行為的是「停輪時刻不遞減」與「`onReelStopped` 依軸序」兩項。

**假設**：剩下的格子都用目前的 `moveInterval`。聽牌切速（決議 42）實作時要把切速納入剩餘秒數的推算。

##### 自訂停止順序下又抓到的兩個缺陷（已修）

**停止順序 = `SlotMachineSpinConfig.reelTimings` 的陣列順序**，與 `reelIndex` 無關（右到左、由中往外都行）。
上面的驗算與 §11k 全用左到右，軸號順序剛好等於設定順序，兩個缺陷都藏住了：

| 缺陷 | 成因 | 修法 |
|---|---|---|
| 同一幀停下的軸，`onReelStopped` 照**軸號**發（`[4,3,2,1,0]` 發成 `[4,2,3,0,1]`） | `update()` 照 `_runtimeReels` 走訪；同幀內 `completeStop()` 與停止 promise resolve 的先後就是走訪順序 | 新增 `_updateOrder`：`startSpin()` 時由 `createUpdateOrder()` 建立，本輪作用軸照停止順序在前、其餘照軸號接後 |
| 急停在 `stopSpin()` 等待後面的軸啟動期間時，停輪時刻反轉 | `quickStop()` 與 `stopSpin()` 各補一次；第二次判定「不用補」的軸沒被寫，**留著第一次的預算**，實際多走一格跑到下一軸後面 | 能補的軸一律 `applyQuickStopPadding()`，**0 也寫**（未提交時是覆寫預算；Turbo 版本來就每軸都寫） |

> 第二條原本以為是「還沒啟動的軸被略過」—— 讀程式碼推論是對的方向，但掛紀錄實測後發現
> `stopSpin()` 等所有軸啟動完會再補一次，那時第 0 軸已在轉；真正的原因是第 1 軸的舊預算。

驗算：三種順序（`[0..4]` / `[4..0]` / `[2,1,3,0,4]`）× 原 288 組參數，各 276 組有效：
停輪時刻反轉 0、`onReelStopped` 未照設定 0、盤面錯 0。

斷言 §11l（10 項）：右到左的不急停對照、同幀停下（前提檢查：五軸真的同幀）、急停在等待啟動期間
（前提檢查：最後一軸還沒啟動）。**兩個修正分別還原時各自紅 2 項**。

> 仍然成立的限制：**啟動順序與停止順序是同一個陣列**，不能分開設定（`createCurrentStopTimings()`
> 讓停輪時刻沿陣列順序只增不減）→ 由決議 44 解除。

#### 決議 44：啟動順序與停止順序分開設定（已實作）

**需求**：同時啟動、依序停止（例如同時啟動、右到左停）。原本 `reelTimings` 一個陣列同時決定啟動與停止順序，
`createCurrentStopTimings()` 又讓停輪時刻沿陣列順序只增不減，所以兩者綁死。

**形狀**：`SlotMachineSpinConfig` 新增選填的 `stopTimings`，與 `startDelaySeconds` 對稱的逐軸間隔（類似 1016 的 `staggerStop`）：

```ts
registerSpinConfig("normal", {
    fastMode: false,
    reelTimings: [                 // 啟動：同時
        { reelIndex: 0, startDelaySeconds: 0, targetStopSeconds: 1.4, moveIntervalSeconds: 0.08 },
        { reelIndex: 1, startDelaySeconds: 0, targetStopSeconds: 1.4, moveIntervalSeconds: 0.08 },
        { reelIndex: 2, startDelaySeconds: 0, targetStopSeconds: 1.4, moveIntervalSeconds: 0.08 },
    ],
    stopTimings: [                 // 停止：右到左，每軸間隔 0.2
        { reelIndex: 2, stopDelaySeconds: 0 },
        { reelIndex: 1, stopDelaySeconds: 0.2 },
        { reelIndex: 0, stopDelaySeconds: 0.2 },
    ],
});
```

**語意**：

| | 未填 `stopTimings` | 有填 |
|---|---|---|
| 停止順序 | `reelTimings` 的陣列順序（與現在相同） | `stopTimings` 的陣列順序 |
| 停輪時刻 | 各軸 `實際啟動時刻 + targetStopSeconds`，沿順序只增不減 | 第一軸 = `實際啟動時刻 + targetStopSeconds`；之後 = 前一軸 + `stopDelaySeconds` |
| 不使用的欄位 | — | 第一軸以外的 `targetStopSeconds`；第一軸的 `stopDelaySeconds` |

- **實際啟動時刻**與 `createPendingStarts()` 同一套：`fastMode` 全為 0，否則累加 `startDelaySeconds`。
- **鎖軸**：未作用的軸從兩個序列都移除，它的間隔一起消失（與 `startDelaySeconds` 相同）；停止序列的第一個作用軸用自己的 `targetStopSeconds`。
- **驗證**：`stopTimings` 的 `reelIndex` 必須與 `reelTimings` 一對一（不多、不少、不重複），`stopDelaySeconds` 為非負有限數。
- **物理下限**：要求早於下限時從最早能停起算，之後的軸照間隔接上（決議 47 之後；以前是各軸各自被鉗到 earliest）。
- **`fastMode`**：`stopDelaySeconds` 一律當 0，只保留順序（決議 48）。

**改用停止順序的地方**：`createCurrentStopTimings()`（含聽牌的「前一軸」）、`prepareOrderedQuickStopPadding()`（決議 43）、
`createUpdateOrder()`（同幀回調順序）。Turbo 同步（全軸同時停）、`quickStop()` / `immediateStop()` 的逐軸轉發與順序無關，不動。

##### 實作（已完成）

| 位置 | 內容 |
|---|---|
| `SlotMachineReelStopTiming` / `SlotMachineSpinConfig.stopTimings` | 新型別與選填欄位 |
| `BaseSlotMachine.getStopOrder()` | 本輪作用軸的停止順序；未設 `stopTimings` 時回傳啟動順序 |
| `BaseSlotMachine.createStartAtByReel()` | 實際啟動時刻，規則與 `createPendingStarts()` 相同 |
| `BaseSlotMachine.createBaseStopTimes()` | 基準停輪時刻（兩種語意） |
| `BaseSlotMachine.createCurrentStopTimings()` | 改沿停止順序走；回傳陣列依停止順序 |
| `BaseSlotMachine.validateStopTimings()` | 一對一、不重複、`stopDelaySeconds` 非負有限 |
| `prepareOrderedQuickStopPadding()` / `createUpdateOrder()` | 改走 `getStopOrder()` |

> `createCurrentStopTimings()` 的啟動時刻原本一律累加 `startDelaySeconds`，`fastMode` 也不例外；現在改用實際啟動時刻
> （`fastMode` 全為 0）。未設 `stopTimings` 且不聽牌時兩者算出的相對目標相同（原 196 項與三種順序各 276 組驗算零差異）。

**驗算**：啟動左到右（同時、`2·mi`、0.1 秒）× 停止順序 右到左／由中往外／左到右 × `stopDelaySeconds` 0／`2·mi`／0.2／0.25
× 急停 不按／先按／0.05／0.6 × `mi` 3 種 × 平盤面與截斷盤面，每種順序 288 組：

| | 結果 |
|---|---|
| 盤面錯 | 0 |
| 第一軸 − `targetStopSeconds` | −0.83 ～ 0 格（不晚、最多早一格） |
| 軸間隔 − `stopDelaySeconds` | 中位數 0；`mi ≥ 0.05` 時在一格以內（`mi = 0.016` 時一幀就超過一格，是幀量化） |
| 急停的組 | 停輪反轉 0、回調未照停止順序 0 |
| 不急停的組 | **`stopDelaySeconds = 0` 且錯開啟動時反轉**（每種順序 6～8 組），其餘 0 |

斷言 §11m（12 項：同時啟動、不急停的順序／第一軸／間隔／盤面、急停、鎖軸）與 §11n（4 項守門）。
**還原**：只讓 `getStopOrder()` 回傳啟動順序時紅 5 項；快照丟掉 `stopTimings` 時紅 9 項。

##### 已定案（選 ③）：規劃間隔小於一格時，不急停也會反轉

上表最後一列的成因與 `stopTimings` 無關，是既有的量化行為：各軸停輪時刻各自量化到自己的 Cell 邊界（`(−1 格, 0]`），
錯開啟動讓相位不同，所以**規劃間隔小於 `moveIntervalSeconds` 的相鄰兩軸**先後會在一格內隨機。未設 `stopTimings`、
把目標設成同時停也一樣。回調順序也跟著反。

實例（`mi` 0.08、錯開啟動 0.1、`stopTimings` 右到左、`stopDelaySeconds = 0`，規劃五軸同時停在 2.400）：

```text
停止順序   4       3       2       1       0
實際     2.333   2.383   2.367   2.350   2.333    ← 第 2 軸比第 3 軸早停；onReelStopped 發成 4,0,1,2,3
```

可能的處理：① 維持現狀，文件寫明「間隔小於一格時不保證順序」；② 結果提交時也套用決議 43 的「不早於前一軸」補格
（代價：要求同時停的軸會被拉成一格一格依序停）；③ 等 §3.7「量化誤差壓到 0」（軸間隔誤差 ±0.0003 秒），自然消失。

**決議：選 ③。** 現階段不處理；§3.7 的量化誤差歸零實作後，規劃同時停的軸會真的同時停，此現象隨之消失。
§3.7 排在聽牌（決議 42）之後，所以順序是 **決議 42 → §3.7 → 本項自動結清**；§3.7 實作時要把這個情境加進斷言。

> 補記：只做自我修正時這個反轉仍有 20 組，要加上「實際原點」才歸零 —— 決議 45 已定案兩者一起做。
>
> **已結清**（決議 45 實作）：此情境五軸同一幀停下、回調照 `stopTimings`，斷言 §11q。
> 實作時另抓到停輪時刻落在幀邊界時被浮點雜訊拆到兩幀，由 `BaseMovement.TIME_EPSILON` 處理（§3.7）。

#### 決議 46：聽牌從前一軸**實際**停下起算（已實作）

##### 現象：伺服器晚到時聽牌消失

決議 42 把聽牌目標定成「前一軸的**規劃**停輪 + `duration`」。前一軸沒被鉗制時規劃 = 實際，看不出差別；
一旦前一軸被鉗到 earliest（伺服器結果晚於停輪時間到），聽牌就被吃掉：

```text
每格 0.08、targetStopSeconds 0.15、錯開 0.1、伺服器 3 秒送達、第 2 軸（R1）聽牌 1.5 秒
第 1 軸規劃停 0.15 → 聽牌軸目標 0.25 + 1.5 = 1.75，但結果 3 秒才到，1.75 早已過去

          R0      R1      R2      聽牌長度
不聽牌   3.450   3.467   3.483     —
聽牌     3.450   3.467   3.483    0.017 秒     ← 設定 1.5 秒，實際幾乎為 0
```

##### 原版的意圖

Cocos 完成版 `BaseSlotMachine.runOneListenReel()` 的註解：

> duration 從 Callback 發生的這一刻起算，不是直接加在原始 targetStopTime 上；前一軸的實際停止誤差不會吃掉聽牌時間。

意圖就是「前一軸實際停下 + duration」。原版在前一軸停下時才 `setActiveTargetStopTime()`，但那時結果早已提交、改了無效
（決議 42 修的那個缺陷）；決議 42 改成規劃時算定，順手把起點換成規劃停輪 —— **這一步偏離了原意**，本決議改回來。

##### 決議

| 軸（停止順序） | 目標停輪 |
|---|---|
| 聽牌軸 | 前一軸**實際**停輪 + `duration` |
| 聽牌軸之後的普通軸 | 前一軸**實際**停輪 + 原本的軸間距（與現在「保留原本軸間距」同一條規則，只換起點） |
| 第一個聽牌軸之前的軸 | 不變 |
| 第一軸就聽牌 | 不變（沒有前一軸） |

前一軸沒被鉗制時，實際 = 規劃（決議 45 之後連續時間誤差 0），**結果與現在完全相同** —— §11p 不受影響。

##### 做法：已由決議 47 取代

最初的實作是**延後提交**：從第一個聽牌軸起，每軸等前一軸提交、停輪確定後才提交自己。行為正確，但每軸最多多等一格，
5 軸一路累積 —— config 要求同時停（間隔 0）、資料又剛好在停輪時間前不久到時，最後一軸會被拖晚最多 0.32 秒
（6,912 組中 1,558 組比決議 47 晚結束）。

決議 47 改成**資料到達時直接推算**每軸停輪，延後提交的程式（`DeferredCommit`、`commitDeferredResults()` 等）已整段移除。
本決議的**規則**（聽牌 = 前一軸實際停下 + `duration`）不變，§11r 的 13 項斷言照舊通過。

#### 決議 47：資料到達時，沿停止順序直接推算每軸停輪（已實作）

##### 現象：伺服器晚到時，軸間隔消失、停輪順序亂

以前每軸的停輪時刻在**開轉時**就定了（`啟動時刻 + targetStopSeconds`），軸與軸的間隔藏在這幾個秒數裡。
資料到了，每軸各自算「離該停還差幾格」補表演牌。伺服器晚於停輪時間到時，每軸都算出「差 0 格」，
各自在自己最早能停的邊界停下 —— 間隔消失，錯開啟動讓相位不同，先後在一格內隨機。

| 伺服器晚於停輪時間（48 組，5 軸） | 順序亂 |
|---|---:|
| Cocos 完成版（node 下以 `cc` 替身實跑） | 45 |
| Egret（本決議前） | 36 |

**根源**：Cocos 完成版把「最少轉多久」與「每軸間隔」合成同一個絕對秒數，並假設資料一定比停輪時間早到。

##### 1016 怎麼做

`UniReelView1016.calculateRandomDataLength()` 在資料到達時，對每軸塞 `ceil((第幾個停 × staggerStop + 聽牌時間) ÷ moveInterval)`
格假資料 —— **相對**格數，不看現在幾秒；`canStopRoll()` 的最短滾動時間整段註解掉，只等資料；`staggerRoll` 三個等級都是 0。
所以伺服器再晚，停輪都是「資料到 → 每軸間隔 `staggerStop` 依序停」（regular 0.2 秒，Lv1／Lv2 為 0）。

##### 決議

資料到達時（`stopSpin()`），沿**停止順序**逐軸推算，每軸取最晚的那個，立刻提交：

```text
普通軸 = max(config 規劃停輪, 前一軸停輪 + 原本軸間距, 本軸最早能停)
聽牌軸 = max(前一軸停輪 + duration,                      本軸最早能停)
```

- **本軸最早能停**：`BaseReel.projectEarliestStopTime(result)` —— 下一個邊界 +（結果進場交接次數 − 1 + 退場端墊格）× `moveInterval`，
  與提交時算 `directResultStopTime` 同一條式子
- **前一軸停輪**是上一輪迴圈的推算值；每格修正（決議 45）讓各軸準時停在推算值上，所以它就是前一軸**實際**停下的時刻 ——
  不必等前一軸提交（取代決議 46 的延後提交）
- 資料早到、沒有軸被鉗制時，三者取出來就是 config 規劃值，**行為與以前完全相同**

##### 連帶修正：啟動效果播完那一幀，時間被用了兩次

啟動效果在某幀中途播完時，第一格被當成「從這一幀開頭起走」、吃整幀 deltaTime —— 效果用過的那段又被 Movement 用一次，
第一格起點比效果結束早，早多少取決於幀長，事先推算不出來（資料在啟動效果中途送到時，推算最多差一幀）。

改成：啟動效果本幀播完時，第一格只吃「效果結束之後」剩下的時間，起點就是效果結束的精確時刻（`BaseReel.updateMovement()`）。
`updateMovement()` 開頭的註解本來就寫著「避免同一份 deltaTime 被用兩次」，停止效果有處理、啟動效果沒有。

##### 實作

| 位置 | 內容 |
|---|---|
| `BaseSlotMachine.createCurrentStopTimings()` | 改成上面的推算；聽牌軸同樣從推算的前一軸停輪起算 |
| `BaseSlotMachine.projectEarliestStopTime(reelIndex)` | 取本輪結果交給 `BaseReel.projectEarliestStopTime()`；軸不在轉時不限制 |
| `BaseReel.projectEarliestStopTime(result)` | 新增公開查詢；還在啟動效果中時，下一個邊界 = 現在 + 效果剩餘 + 一格 |
| `BaseReel.updateMovement()` | 啟動效果本幀播完時，Movement 只吃 `deltaTime − 效果剩餘`，第一格起點 = 效果結束時刻 |
| 決議 46 的延後提交 | 整段移除（`DeferredCommit`、`_deferredCommits`、`findDeferStart()`、`createDeferredCommits()`、`commitDeferredResults()`、`commitAllDeferredResults()`） |

##### 驗算（框架實作本身，外部量測連續時間）

| 情境 | 組數 | 結果 |
|---|---:|---|
| 混合（`mi` 3 種 × 錯開 4 種 × 停輪 3 種 × 伺服器延遲 0.05／0.5／1.5／3 × 平／截斷盤面 × 幀長 2 種 × 停止順序 預設／右到左 0／右到左 0.2 × 啟動效果 有／無 × 第 2 軸聽牌 有／無） | 6,912 | 反轉 0、回調順序錯 0、盤面錯 0；停得到的目標誤差 ±2e-14；停不到的一律停在最早時刻 |
| 同上，本決議前 | 6,912 | 反轉 3,342、回調順序錯 1,807；最多早 0.47 秒 |
| 本決議前沒有軸被鉗制的組 | 2,935 | 與本決議前**逐軸相同** |
| 「等前一軸提交」（決議 46 做法）比本決議晚結束 | — | 1,558 組，最多 0.32 秒 |
| 不做啟動效果修正 | — | 資料在啟動效果中送到的組，推算最多差一幀（368 軸次沒停在最早時刻） |
| 伺服器 3 秒到、無聽牌（停輪 0.15、錯開 0.1） | 1 | 3.44 → 3.54 → 3.64（本決議前 3.44 → 3.46 → 3.48） |
| 決議 45／46 的聽牌、急停、fastMode 驗算重跑 | 3,540 | 全部維持 0 |

**斷言**：§11e 改寫（config 停輪早於物理下限時，從最早能停起算、間隔與順序保留）；新增 §11s（8 項）：伺服器晚到錯開 0.1、
`stopTimings` 右到左 0.2、資料在啟動效果中送到。**分別還原**：不把最早能停算進目標 紅 10；啟動效果交接照舊 紅 1。

> 啟動效果那條斷言要**五軸同時啟動**（排停輪時都還在效果中）且效果時長**不是幀長整數倍**（0.2 + 0.13）——
> 效果剛好在幀邊界結束時修不修都一樣，第一版就因此還原不會紅。

#### 決議 48：Turbo（`fastMode`）停止間隔為 0（已實作）

`fastMode` 時 `stopTimings` 的 `stopDelaySeconds` 一律當 0，只保留停止**順序**（同一幀停下時回調照它發）——
與 `startDelaySeconds` 在 `fastMode` 被略過同一個道理。

**依據**：Cocos 移植版沒有 `stopTimings`，停輪 = 各軸 `targetStopSeconds`，`fastMode` 全軸 0 秒啟動 → 各軸填相同值就是同時停。
1016 的 Lv1／Lv2 `staggerStop` 也是 0。

**不這樣做會怎樣**：各軸目標不同 → 每格修正（決議 45）拉長的量不同 → 格邊界錯開半格 → Turbo 急停同步補的是整格，
對不齊，會有軸晚半格停（牌庫含大圖 4,608 組中 48 次警告，本決議後 0）。

說明已寫進 `SlotMachineSpinConfig`（`fastMode`、`stopDelaySeconds`、`stopTimings`），並提醒 Turbo 各軸的
`targetStopSeconds` 也要填相同的值。斷言 §11v（2 項），還原時紅 1。

#### 已修：急停的兩個既有缺陷（牌庫含大圖時才會出現）

兩個都**不是今天的改動造成的**，是驗算牌庫加入 1×2／1×3 之後才掃出來 —— 之前的驗算牌庫多半只有 1×1，而且盤面只比對 id
（見下方「驗算的教訓」）。

**① 結果先到後急停：砍表演格時留下半組大 Symbol，結果被接進去**（瀏覽器截圖：第 4 軸只剩一格、兩格空白）

- 成因：`BaseReel.applyQuickStopDataSkip()` 砍掉結果前還沒進場的表演格時，若有一組大 Symbol 只進場一半，前半留在進場 buffer；
  接著進場的結果若是同一張牌（例如退場端截斷的墊格），`resolveGroupOffset()` 把它接進那半組，groupOffset 錯位
- 決議 30（§2.2.2）處理的是同一件事，但只在**提交結果**時拆；急停砍格時漏了
- 修法：急停真的砍到格子時，也呼叫 `dissolveIncompleteEntryGroup()`
- 實測：測試場景設定（啟動效果、牌庫含 62／73、第 2 軸聽牌）掃急停時刻 × 幀長 4,464 組，**上一個 commit（`ad47b91`）就壞 152 組**，
  今天的推算改動讓它更常出現（389 組），修正後 0 組
- 斷言 §11t（3 項），還原時紅 1

**② Turbo 急停同步補牌插進結果中間，那一軸永遠停不下來**

- 成因：`ReelDataFlow.insertPerformanceCellsBeforeResult()` 一律插在「目前讀到的位置」前面，假設結果還沒開始進場；
  `prepareFastQuickStopPadding()` 沒有像決議 43 的依序補格那樣先檢查 `canApplyQuickStopPadding`。結果已進場時，補的牌落在
  結果中間，盤面永遠對不齊（實例：要 `[1,6,6]`，可視 `[4,6,6]`、資料已用完）
- 以前 Turbo 各軸停輪時間相同不易碰到；決議 44 讓 Turbo 各軸可以不同時間後才出現（決議 48 之後又回到同時停）
- 修法：補牌函式本身擋住（結果第一格已進場就回 0）；Turbo 同步只對還能補的軸計算與補牌
- 實測：牌庫含大圖 4,608 組中 88 組 5 軸只停 4 軸，修正後 0 組
- 斷言 §11u（2 項），還原兩處檢查時紅 2

##### 驗算的教訓

- **盤面要檢查 group 完整性，不能只比 id**：①的錯位盤面 id 仍是 `[1,73,73]`，只比 id 會判定正確。驗算腳本改成「可視段每一格都找得到
  自己的 head」才算對
- **牌庫要含大 Symbol**：①②都要有表演牌是大 Symbol 才會出現

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

**執行結果**：281 項斷言全數通過。原有 56 項（階段 5 首次執行，階段 6 接上顯示層後重跑仍全過）涵蓋下列第 1～3 項與部分第 6 項；其餘為決議 30 新增 10 項（`7d`，§2.2.2）、預算切資料 6 項（`7e`，§3.5）、截斷兩端 5 項（`7f`，§2.3.1）、決議 34 與 `getGroupIcons()` 29 項（`8`～`8d`，§3.9）、`getVisibleIcons()` 在截斷盤面與滾動中 14 項（`9`／`9b`，§3.9）、四方向 18 項（`10`～`10c`，§2.5）、多軸協調、守門與 Turbo 同步兩個順序 37 項（`11`～`11j`，§3.6／§3.8）、普通模式急停依序停 11 項（`11k`，§3.8 決議 43）、自訂停止順序 10 項（`11l`，同節）、`stopTimings` 16 項（`11m`／`11n`，§3.8 決議 44）、聽牌回調成對發出 12 項（`11o`，§3.8 決議 42）、聽牌時間 17 項（`11p`，同節）、量化誤差壓到 0 新增 13 項（`11q` 11 項與 §11d／§11e 各 1 項，§3.7 決議 45）、聽牌從前一軸實際停下起算 13 項（`11r`，§3.8 決議 46）、資料到達時推算停輪 8 項（`11s`，§3.8 決議 47；另改寫 §11e）、急停砍格拆殘組 3 項（`11t`）、Turbo 補牌不插進已進場的結果 2 項（`11u`）、Turbo 停止間隔為 0 2 項（`11v`，決議 48）。



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
- ~~**停輪時間的量化誤差要不要壓到 0**~~ → **決議 45 已實作**（§3.7）：含實際原點，ε = +25%，畫面上最多晚一幀。

- ~~**伺服器晚到時，被鉗制的各軸停輪順序不保證**~~ → **決議 47 已解決**（§3.8）：資料到達時沿停止順序推算，軸間隔與順序照樣保留。

- **聽牌（決議 42）待實作**：`speedMultiplier` 目前把 `duration` 一起除掉。修法已定案並驗算（`planned`：規劃時算目標與切速邊界，2,880 組零晚停、零順序違反）。「高於普通就不排聽牌時間」靠 Lv1／Lv2 的 SpinConfig 設 `fastMode: true` 達成，由遊戲層每次開轉以 `startSpin(mode)` 送入（已確認，1016 對應物見 §3.8）。完整依據見 §3.8。

- **機台層缺「完全停」的出口**：Reel 層有 `onStopEffectCompleted`，`BaseSlotMachine` 卻整檔零次提到 `stopEffect` —— 機台只轉出「資料到定位」那一則。1016 為此手工轉了四層（`UniReel1016._endBouncePromise` → View → SlotMachine → `GameViewManager1016._waitReelBounceTask`），用來卡 wild 表演與聽牌特效的時序。**要不要做沒有疑問，未定的是形狀**（新增機台 callback 還是給 `BaseReel` 一個 `waitForStopEffectAsync()`）。完整依據見 §3.8。

- **`reconfigureStoppedLayout()` 的展開行為**：1×1 展開成 1×N 時，多出來的格子從哪裡取、原本那些 runtime 的 `groupOffset` 怎麼重算，還沒設計。目前只能手寫整條對齊的三段盤面，且大 Symbol 不得跨越 buffer／可視區邊界（§3.1 的約束），所以「某一格就地展開」這個使用情境實際上要由遊戲層重算整條 strip 才寫得出來。

- **`reconfigureStoppedLayout()` 在停止效果播放中沒有守衛**：它只檢查 `state === ReelState.Stopped`，而停止效果正是在 `completeStop()` 切到 Stopped **之後**才播。實測會靜默成功，畫面在剩餘效果期間跳一下。對照 `BaseReel.startRoll()` 第一行就是 `if (this._stopEffect.active) throw`，兩邊不一致。要補守衛還是改成「重排時先 `_stopEffect.reset()`」，未定 —— 後者要處理「上一輪的 `onStopEffectCompleted` 不會發出」這個副作用。

- **`immediateStop()` 的兩個行為沒討論過**（都不是 bug，但沒被決定過）：
  ① **停軸順序不保證** —— 各軸相位不同，誰先到完整 Cell 邊界誰先停。實測兩軸（第二軸 `startDelay` 0.2）得到 `reel1` 早於 `reel0`。
  ② **未啟動的軸留在 `idle`** —— `immediateStop()` 只收 Rolling／Stopping 的軸，沒啟動的軸狀態停在 `ReelState.Idle` 而非 `Stopped`，且不發 `onReelStopped`。遊戲層若逐軸等停止回調會漏掉那幾軸。
- **有急停時的停止順序反轉**（2026-09-26 發現）：Turbo + 結果後急停是框架問題（不能補格的軸被排除在共同目標外），修法待定；
  普通模式是「第一個要停的軸還沒開始滾」的極端設定，要不要處理待定。見 [SESSION-2026-09-27-Rolling-Fixes.md](SESSION-2026-09-27-Rolling-Fixes.md) §3。
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
