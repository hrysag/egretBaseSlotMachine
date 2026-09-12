# 基本單位改回 1×1：設計決議與修改清單

> 對象：`D:\cocosTest\NewSlotMachine\SlotFrameWork\SlotMachine\assets\Script\SlotMachine\Core`（Cocos 完成版）
> 目的：移植到 Egret 的同時，把「Runtime = 1×N Symbol」改成「Runtime = 1×1 Cell」。
> 姊妹文件：[Cocos-To-Egret-Slot-Port-Map.md](Cocos-To-Egret-Slot-Port-Map.md)、[Egret-Slot-Exml-Editable-Surface.md](Egret-Slot-Exml-Editable-Surface.md)、[ReelTemplate-v3-Reference-Study.md](ReelTemplate-v3-Reference-Study.md)
> 本文行號以 Cocos 完成版為準。

---

## 0. 決議摘要

| # | 決議 |
|---|---|
| 1 | **Runtime／Icon 一律 1×1**；大 Symbol 由 N 個連續 cell 組成一個 group |
| 2 | group 的 **head 在進場側**，圖從 head 往**退場方向**延伸 `cellSpan` 格 |
| 3 | 由 server per-cell 結果推導 group 時，**從退場端往進場端掃**，貪婪開組 |
| 4 | 被顯示區截斷的 group **只會截在進場端** |
| 5 | 進場／退場 buffer **對稱，各 = maxSpan** |
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

### 2.4 Strip 長度

```text
strip = maxSpan + visibleCellCount + maxSpan
```

範例：`maxSpan = 4`、`visibleCellCount = 3` → 11 個 runtime／Icon。

多軸請務必讓所有軸的 strip 長度一致（`maxSpan` 統一），Turbo 同步停輪才不會因幾何不同而出現相位差。

### 2.5 方向

一律用**進場端／退場端**描述，不得出現「上／下」「左／右」。四個滾動方向共用同一套規則，方向轉換由既有的 `resultEntryAtDisplayStart` 負責。

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

另外澄清一點：環形游標並沒有多給「icon↔cell 配對固定」這個好處 —— 現有寫法兩個陣列是**一起轉**的，`_symbols[i]` ↔ `_icons[i]` 本來就一直配對著：

```ts
const icon = this._icons.pop();
this._symbols.pop();
this._symbols.unshift(runtime);
this._icons.unshift(icon);
```

### 2.10 掉落式（Drop）對位置模型的影響

v3 內建的 `DropReel`（`v3/Scripts/DropReel/`）目前不在移植範圍，但位置模型必須先為它留路，否則之後要加會動到核心。

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
    axisPosition: number;
}
```

C 裡每個 runtime 恆為一格，原欄位值恆等於 1，直接改用同一個位置記 group 內位置。
**不存 group 總長** —— `reconfigureStoppedLayout()` 允許中途重新註冊 `cellSpan`，存了就會變髒資料。

**改 `ReelLayoutSource`（`:8-20`）**

```ts
// before
export interface ReelLayoutSource {
    readonly topBuffer: SymbolData;       // 一張
    readonly visible: SymbolData[];
    readonly bottomBuffer: SymbolData;    // 一張
}

// after
export interface ReelLayoutSource {
    readonly entryBuffer: SymbolData[];   // 展開後 === maxSpan
    readonly visible: SymbolData[];       // 展開後 === visibleCellCount
    readonly exitBuffer: SymbolData[];    // 展開後 === maxSpan
}
```

順便改掉 `topBuffer`／`bottomBuffer` 這兩個在水平或反向滾動時會誤導人的名字。

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

回收改綁會讓任何存下來的引用立刻變髒，一律即時計算。

### 3.5 `Reel/Internal/ReelDataFlow.ts`

**`commitResult()`（`:158-205`）重寫**

- 刪掉 `collapseResultCellData()` 呼叫，改成 §2.3 的三步驟。
- `performanceCellBudget` 的意義不變，但因為每格都是一格，預算計算變精確。

**表演資料展開（新增）**

`getNextPerformanceData()` 簽章不動，仍回傳一張 `SymbolData`；框架在入列時查 `cellSpan` 展開成 N 格並配好 `groupOffset`。遊戲端的 `setPerformanceDataBank()`、`appendPerformanceData()` 完全不受影響。

**裝箱收尾（保留但降級）**

停輪時間 = 剩餘 cell 數 × `moveInterval`，仍需湊到精確 cell 數。策略不變：**塞到放不下為止，尾巴用 1×1 補滿**。牌庫至少要有一張 1×1 的約束維持。

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

### 3.7 `Reel/Internal/ReelStopFlow.ts`

- `tryCommitResultAtHandoff()` 的 `requiredRemainingParity` 奇偶修正（`:154-163`）可刪 —— 每格等寬，相位恆定。
- 已經是死碼的 `getResultTravelCellCount()`（`:339`）與 `getExitMissingCellCount()`（`:358`）一併刪除。

### 3.8 `Core/BaseSlotMachine.ts`

**`prepareFastQuickStopPadding()`**

```ts
if (difference % 2 !== 0) {
    throw new Error("Turbo QuickStop cannot synchronize Reels whose ...");
}
```

**這個 throw 刪掉。** 每格等寬之後不可能出現半格差，各軸剩餘距離必為整數格。同步計算簡化成「取各軸剩餘 cell 數最大值，差額補 1×1」。

### 3.9 `Reel/BaseReelIcon.ts`

**Icon node 恆為 1×1，`anchorOffset` 恆為 `cellPitch / 2`。** span 的差異全部推到子物件的偏移上（§2.7）：

```text
icon node       尺寸 cellPitch × cellPitch，anchor 固定在自己的中心
  └─ 美術子物件  head：尺寸 span × cellPitch，往退場方向偏移 (span - 1) * cellPitch / 2
                follower：不顯示
```

`applyLayout()` 需要知道自己是 head 還是 follower，所以 `ReelIconLayout` 要帶上 `groupOffset`；尺寸則由遊戲繼承類別自己查 Registry 決定，`ReelIconManager` 不再碰。

**View 的判斷就兩行：**

```ts
if (runtime.groupOffset === 0) {
    // head：畫圖，尺寸 = registry.getCellSpan(id) * cellPitch
} else {
    // follower：不畫
}
```

**附帶好處**：head 綁定的那一刻就是「這組到齊了」的信號（head 一定最後進場），不需要另外發 group-complete 事件。

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
| | `takeDataByCellBudget()`（`:355`） | 45 |
| | `takeNextPerformanceDataThatFits()`（`:400`） | 27 |
| | `takeNextSingleCellPerformanceData()`（`:427`）→ 併入通用收尾 | 24 |
| `ReelStopFlow.ts` | 奇偶修正 + 兩個死碼函式 | ~50 |
| `BaseSlotMachine.ts` | 半格差 throw + 相關分支 | ~20 |

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

- **`onHalfCellComplete` 這個對外 Callback 要不要保留？** 交接改成每整格固定執行（§3.4）之後，它與交接時機脫鉤。若沒有遊戲端在用第一個半格的時機，傾向保留 Callback 但退回單純的時間通知；待確認。
- **`reconfigureStoppedLayout()` 的展開行為**：1×1 展開成 1×N 時，多出來的格子從哪裡取、原本那些 runtime 的 `groupOffset` 怎麼重算，還沒設計。
- **大 Symbol 的中獎動畫／handoff**：目前只確定 `getGroupIcons()` 這個 on-demand 入口，實際動畫要掛在 head 還是另開 overlay 層沒討論。
- **退場端截斷**：`groupOffset` 表達得出來（X 側最外格 offset > 0），但從 server per-cell 陣列推導不出來。若企劃的 `setInitialLayout()` 或 `reconfigureStoppedLayout()` 需要直接指定這種盤面，要另外開 API。
- **Icon 數量對 Egret 的影響**：strip 從 `visible + 2` 變成 `visible + 2 × maxSpan`；Egret 沒有內建 Pool（見 Port Map §11），5 軸 × 11 格 = 55 個顯示物件要實測。
- **掉落式（Drop）本身不在本次範圍**：位置模型已預留 `cellOffset[k]`（§2.10），但 `reorderDropIcon()` 的分組重排、`DropType` 狀態機、每格各自的 `BaseMovement[]` 全部尚未設計。
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
