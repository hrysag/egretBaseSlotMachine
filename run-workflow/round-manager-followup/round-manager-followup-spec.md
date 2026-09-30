# Spec：核心程式改寫成符合 Egret 規範

> 日期：2026-09-30
> 模式：FAST
> 規範來源：`~/.claude/skills/game-implementation-boundary/engines/egret/`（`engine.md`、`boundary.md`、`typescript.md`、`project-rules.md`），**全部照做，不以專案現況例外**
> 引擎原始碼：`D:\engine\egret\egret-core-master\src`
> 本文以「類別.成員」指路，不寫行號。

---

## 1. 目標

把核心程式中不符合 Egret 規範的地方，依 Egret 規範的格式改寫。行為（滾動、停輪、急停、聽牌、掉落、round 流程）不變。

---

## 2. 範圍

| 處理 | 不處理 |
|---|---|
| `src/SlotMachine/Core/**` | Egret 範本自帶檔案：`AssetAdapter.ts`、`LoadingUI.ts`、`Platform.ts`、`ThemeAdapter.ts`、`EgretToolchainShim.d.ts` |
| `src/SlotMachine/Drop/**` | `Main.ts` 除了 `import` 那一行以外的內容 |
| `src/SlotMachine/Manager/**` | `tests/**`（`CoreGeometry.test.ts`、`EgretStub.ts`） |
| `src/test/**`（`SlotMachineScene.ts`、`TestSlotMachine.ts`、`TestReelIcon.ts`、`TestSymbolTable.ts`） | 物件池（空殼內表演物件的來源，另外談） |
| `Main.ts` 的 `import { SlotMachineScene } …` 那一行 | 打包設定（`scripts/config*.ts`） |

**已知後果**：`tests/CoreGeometry.test.ts` 以 `import` 引用核心，改寫後無法編譯，本輪不執行那 357 項斷言。

---

## 3. 規範對照與現況

| 規範 | 現況 | 處理 |
|---|---|---|
| 只用 `namespace`，不寫 `import`／`export`；跨 namespace 寫完整名稱，不用別名 | 範圍內全部檔案都是 ES module | §4 |
| TS 2.4.2 語法（無 `unknown`、`?.`、`??`、`field!:` 等） | `unknown` 8 處（範圍內 7 處） | 改 `any` 並在使用前檢查型別 |
| 依 `tsconfig.json` 偵測 Map／Set：`lib` 有 `es2015.collection`、無 `es2015.iterable`、無 `downlevelIteration` | 只用建構、`get`／`set`／`has`、`forEach` | 符合，維持；不得新增 `keys()`／`values()`／`entries()`／`Array.from`／`for...of` 走訪 Map／Set |
| `strict: true`：參數標型別、`null` 寫進型別、`map.get()` 先判斷 | — | 改寫時照做 |
| 禁止匿名函式，指定給有名字的變數 | 陣列方法 callback、Promise executor、`.then`、緩動表、測試場景按鈕等 | §9 |
| 建構子不做初始化；`init()` + `_inited`；外部可呼叫的 `cleanup()` | 7 個類別在建構子收參數或初始化 | §9 |
| 禁止跨類別 callback 設計（使用者裁定：**同模組可以，跨模組禁止**；跨模組通知用自訂事件） | 跨模組的回呼屬性與 `iconFactory` | §5～§7 |
| 使用 DI 時須用介面注入 | manager 直接收機台類別實例 | §8 |
| 禁止原生計時器 | 範圍內只有註解提到 `setTimeout` | 無需處理 |

---

## 4. 模組寫法：namespace

| 資料夾 | namespace |
|---|---|
| `src/SlotMachine/Core/**` | `slot_core` |
| `src/SlotMachine/Drop/**` | `slot_drop` |
| `src/SlotMachine/Manager/**` | `slot_manager` |
| `src/test/**` | `slot_test` |

- **名稱用單層、底線分隔（`slot_core`，不用 `slot.core`）**（2026-09-30 phase-1 除錯後使用者定案）：打包工具 `@egret/egret-webpack-bundler` 的 `loaders/ts-loader/ts-transformer.js`（`legacy` 模式）把每個 namespace 換成三個節點（`var x = window['x'];`、namespace、`window["x"] = x;`），但帶點的 `namespace a.b { }` 外層的 body 只收一個節點 → `Debug Failure. False expression: Too many nodes written to output.`。實測：`namespace slot.core {}` 失敗；巢狀 `namespace slot { export namespace core {} }` 可以但會把 `core`、`drop`、`test` 等短名稱掛上 `window`；單層 `slot_core` 可以且只掛 `slot_core`
- 每個檔案以 `namespace slot_xxx { … }` 包住；原本 `export` 的宣告改成 namespace 內 `export`（namespace 成員匯出，不是 ES module 匯出）；原本檔案內私有的常數與函式保留為 namespace 內非匯出成員
- 同一 namespace 內直接寫名稱；跨 namespace 一律完整名稱，例：`slot_drop` 內寫 `slot_core.BaseReel`
- 相依方向不變：`slot_manager` → `slot_core`、`slot_drop`；`slot_drop` → `slot_core`；`slot_core` 不得出現 `slot_drop.`、`slot_manager.`
- `BaseReel.ts` 開頭的轉匯出（`export { SymbolData, SymbolVisualSize } from …` 等 6 行）刪除：同一個 `slot_core` 內不需要轉匯出，原本經由 `BaseReel.ts` 取用這些名稱的地方直接寫 `slot_core.Xxx`
  - 更正（2026-09-30 寫 plan 時）：前版寫「`TestSymbolTable.ts` 轉匯出 `SymbolData` 而重名」不正確 —— 盤點時 PowerShell 的分組不分大小寫，把 `TestSymbolTable.symbolData()`（函式）與 `SymbolData`（介面）算成同名。實際沒有重名
- `Main.ts`：刪除 `import` 那一行，`new SlotMachineScene()` 改成 `new slot_test.SlotMachineScene()`
- **打包設定不動**：`scripts/config.ts` 使用 `WebpackBundlePlugin`（`typescript: { mode: 'legacy' }`）。已讀 `@egret/egret-webpack-bundler` 原始碼確認：
  - `loaders/src-loader/index.js`：入口檔自動依相依順序 `require` 全部未模組化的檔案（`factory.sortUnmodules()`）
  - `loaders/ts-loader/ts-transformer.js`：`ModuleDeclaration`（namespace）前插入 `var x = window['x'];`、後插入 `window["x"] = x;`，跨檔同名 namespace 可合併
- EXML 目前沒有引用範圍內的類別；日後在 exml 使用時命名空間要寫成 `xmlns:ns="slot_core.*"` 之類

---

## 5. 跨模組通知：自訂事件

### 5.1 寫法（使用者指定）

```ts
namespace slot_core {
    export class SlotMachineEvent extends egret.Event {
        public static readonly REEL_STOPPED: string = "reelStopped";

        public reelIndex: number = -1;
        public reel: BaseReel | null = null;

        public constructor(type: string, bubbles: boolean = false, cancelable: boolean = false) {
            super(type, bubbles, cancelable);
        }
    }
}
```

- 發送：`new XxxEvent(XxxEvent.TYPE)` → 填欄位 → `this.dispatchEvent(evt)`
- **發送前先檢查 `this.hasEventListener(type)`，沒人聽就不 `new`**：避免每格、每幀的事件在沒人聽時也配置物件（規範「避免 gameplay loop 中頻繁 allocation」；引擎 `EventDispatcher.dispatchEventWith()` 也是這樣做）
- 接收：有名字的方法；`init()` 內 `addEventListener(type, this.onXxxHandler, this)`，`cleanup()` 內以相同 `listener`、`thisObject`、`useCapture` `removeEventListener`
- 欄位一律給預設值（TS 2.4.2 不檢查欄位初始化）
- 引擎事實（`src/egret/events/EventDispatcher.ts`）：`dispatchEvent` 同步逐一 `listener.call(thisObject, event)`，呼叫時機與原本回呼相同；同一組 `listener` + `thisObject` 不會重複註冊

### 5.2 事件類別（名稱皆暫定）

> **2026-10-01 修改**：單軸（`BaseReel`、`BaseDropReel`）不再對外發事件，`ReelEvent` 整個移除，見 §13。下表單軸兩列已不適用。

事件類別放在發送方所屬模組。

| namespace | 發送方 | 事件類別 | 事件種類 → 取代的回呼屬性 | 欄位 |
|---|---|---|---|---|
| `slot_core` | `BaseSlotMachine` | `SlotMachineEvent` | `REEL_STARTED` ← `onReelStarted`；`ALL_REELS_STARTED` ← `onAllReelsStarted`；`REEL_STOPPED` ← `onReelStopped`；`ALL_REELS_STOPPED` ← `onAllReelsStopped`；`LISTEN_START` ← `onListenStart`；`LISTEN_END` ← `onListenEnd` | `reelIndex`、`reel`、`stopMode` |
| `slot_core` | `BaseReel` | `ReelEvent` | `HALF_CELL_COMPLETE` ← `onHalfCellComplete`；`CELL_MOVEMENT_COMPLETE` ← `onCellMovementComplete`；`ROLL_STARTED` ← `onRollStarted`；`ROLL_STOPPED` ← `onRollStopped`；`STOP_EFFECT_STARTED` ← `onStopEffectStarted`；`STOP_EFFECT_COMPLETED` ← `onStopEffectCompleted`；`START_EFFECT_COMPLETED` ← `onStartEffectCompleted`；`REEL_DATA_CHANGED` ← `onReelDataChanged` | `completedHalf`、`stopMode`、`runtime`、`previousData` |
| `slot_drop` | `BaseDropSlotMachine` | `DropEvent` | `REEL_DROP_STARTED` ← `onReelDropStarted`；`REEL_DROP_COMPLETED` ← `onReelDropCompleted` | `reelIndex`、`reel` |
| `slot_drop` | `BaseDropReel` | `DropEvent` | `DROP_STARTED` ← `onDropStarted`；`DROP_COMPLETED` ← `onDropCompleted` | — |
| `slot_manager` | `BaseRoundManager` | `RoundEvent` | `STAGE_ENTER` ← `onStageEnter`；`GAME_END` ← `onGameEnd` | `stage`、`context` |

- 上表的回呼屬性全部移除；各類別 `cleanup()` 內原本清回呼屬性的那幾行跟著改掉
- 發送順序、發送時機與原本回呼完全相同（例：`BaseDropReel` 到位事件仍在 resolve 掉落 Promise 之前；`GAME_END` 仍在 `startGame()` resolve 之前）
- `BaseRoundManager` 改成繼承 `egret.EventDispatcher`（一般類別，非顯示物件）；機台與單軸本來就是 `eui.Component`，已具備 `dispatchEvent`

### 5.3 保留的同模組回呼

| 回呼 | 使用者 | 原因 |
|---|---|---|
| `BaseMovement.onValueChanged`、`onCommandComplete`、`onQueueComplete`、`addCallback()` | `BaseReel`、`ReelAxisEffect`（同 `slot_core`） | 同模組 |
| `TestSlotMachine.onUpdate` | `SlotMachineScene`（同 `slot_test`） | 同模組 |
| `ReelStopFlow` 建構參數中的 `ReelCellSpanResolver`、`ReelPerformanceDataProvider`、`ReelDataValidator` | `BaseReel`（同 `slot_core`） | 同模組；改由 `init()` 傳入（§9） |

保留的回呼仍須：以有名字的 handler 指派、`cleanup()` 內解除。

---

## 6. `BaseDropReel` 不再掛 `BaseMovement` 的回呼

- `BaseDropReel.createGroupDrop()` 不再設定 `movement.onValueChanged`
- `BaseDropReel.update()`：每組 `drop.movement.update(deltaTime)` 之後，直接把 `drop.movement.value` 寫進該組每一格的 `cellOffset`，全部組推完再 `syncAllIcons()`（順序不變）
- 移除 `completeDrop()`、`cleanup()` 內解除 `onValueChanged` 的程式
- 畫面結果不變：`syncAllIcons()` 讀到的是本幀最終值；`quickStop()` 本來就直接把 `cellOffset` 設到終點

---

## 7. Icon：`iconClass` + `iconSkinName` 取代 `iconFactory`

對應 Cocos 原版：`BaseReel` 的 `@property(Prefab) iconPrefab` 是一個欄位參照，`ReelIconManager.initializeIcons()` 以它 `instantiate` N 個並從根節點取 `BaseReelIcon`（可為子類別）。Egret 把「類別」與「外觀」分開，故開兩個欄位。

| 欄位（`BaseReel`、`BaseDropReel`） | 型別 | 對應 Cocos | 沒填時 |
|---|---|---|---|
| `iconClass` | `string`：空殼類別完整名稱，例 `"slot_test.TestReelIcon"` | Prefab 根節點掛的元件 | 用 `slot_core.BaseReelIcon` |
| `iconSkinName` | `string`：空殼外觀 skin，例 `"skins.ReelIconSkin"` | Prefab 的外觀 | 不設定 skin |

- 兩個欄位都是字串，可在 UI Editor 填（exml 屬性）
- 程式設定入口：`configureIconDisplay({ iconClass, iconSkinName })`（`ReelIconDisplayConfig` 的 `iconFactory` 換成這兩個選填欄位）
- 建立：`ReelIconManager.initializeIcons()` 以 `egret.getDefinitionByName(iconClass)` 取得類別（引擎 `src/egret/utils/getDefinitionByName.ts`，支援帶點的 namespace 名稱；`eui.Component` 解析 `skinName` 也用它）
  - 找不到類別、或不是 `BaseReelIcon` 本身或子類別 → throw
  - `new` 出 N 個，有 `iconSkinName` 就設 `skinName`，其餘流程（`setupCell()`、`addChild`、`syncAllIcons()`）不變
- 移除 `ReelIconFactory` 型別
- `TestReelIcon`：建構子不再收參數。原本建構子收的方向資訊（退場是否在正向、是否垂直）改由框架在 `BaseReelIcon.setupCell()` 一併傳入並記在空殼上，`onCellSetup()` 內可讀（`setupCell()` 與 `onCellSetup()` 的參數隨之增加；方向由框架給，不在遊戲層自行推導）
- `TestSlotMachine.applyInitialLayout()`：改傳 `{ iconClass: "slot_test.TestReelIcon" }`，移除 `createIcon()`
- 空殼內的表演物件（物件池）不在本輪

---

## 8. Manager

### 8.1 介面注入

| 介面（名稱暫定） | 所屬 | 內容 | 實作者 |
|---|---|---|---|
| `slot_core.ISlotMachine` | `slot_core` | 繼承 `egret.IEventDispatcher`；`startSpin`、`stopSpin`、`quickStop`、`waitForSettledAsync`、`isSpinning`（manager 實際用到的） | `BaseSlotMachine` |
| `slot_drop.IDropSlotMachine` | `slot_drop` | 繼承 `egret.IEventDispatcher`；`dropOut`、`dropIn`、`dropRefill`、`quickStop`，以及 manager 判斷「盤面還在」所需的查詢 | `BaseDropSlotMachine` |

- 實際清單以 manager 現有呼叫為準，實作時逐一對照，不多開
- manager 以 `init()` 收兩個介面（各自可不給），不在建構子收

### 8.2 改寫內容

- 去掉 `abstract`（`BaseRoundManager`、`RollRoundManager`、`DropRoundManager` 及其方法）
- 去掉泛型 `<TState>`；`RoundData.state` 等改成 `any`
- 去掉 `unknown`
- 去掉 `runStage(…, this.onRoundStart)` 與 `hook.call(this, context)`：每個環節直接依序呼叫對應方法
- 要遊戲實作的方法給預設實作並註明「留給繼承類別」：
  - `nextRound()` 預設回傳 `null`（= 整局結束）
  - `RollRoundManager.getSpinMode()` 預設實作 throw（框架不知道遊戲註冊了哪些模式，沒有合理的預設值）
  - `presentBoard()` 由 `RollRoundManager`、`DropRoundManager` 各自實作；`BaseRoundManager` 的預設實作 throw（基底不知道怎麼出盤面）
- 生命週期：`init(roll, drop)` + `_inited` + `assertInitialized()` + `cleanup()`
  - `cleanup()`：移除對機台的全部事件監聽、清除收集中的逐軸 Promise（不再等它們）、清掉機台參照、`_inited = false`
- 監聽機台：`init()` 內對 `ISlotMachine` 加 `SlotMachineEvent.REEL_STARTED`／`REEL_STOPPED`／`LISTEN_START`／`LISTEN_END`，對 `IDropSlotMachine` 加 `DropEvent.REEL_DROP_STARTED`／`REEL_DROP_COMPLETED`；handler 為有名字的方法，內部照舊轉給可覆寫的同名方法並收集回傳的 Promise
- 上次逐行清單中的其他項目一併處理：
  - getter `reelEventContext` 每次臨時組物件 → 改成欄位或一般方法
  - `(context.round.cascades as RoundCascade[])` 強制轉型 → 改成先判斷
  - `throw new Error("…")` 寫在同一行 → 換行寫訊息（照 Core）
  - 預設實作不寫 `return Promise.resolve();`，寫成 `async` 方法，內容只放註解
  - 一個參數一行
  - `ROUND_DATA_PENDING` 模組層常數 → 類別上的 `static readonly`
  - `RollRoundManager` 內 `void this.requireRollMachine().startSpin(…)` 丟掉 Promise → 收下並在適當處等待／處理錯誤，不吞錯
  - `_ignoreRejectionHandler` 等為壓警告的寫法 → 以有名字的方法處理，必要性照舊（先掛 catch 避免 Uncaught）

---

## 9. 其他照規範的修正

### 9.1 匿名函式 → 有名字

範圍內所有直接寫在呼叫處的匿名函式改成有名字的方法或具名欄位，包括：

- 陣列方法 callback（`map`、`filter`、`every`、`some`、`sort`、`forEach`）
- `new Promise((resolve) => …)` 的 executor、`.then(() => …)`、`.catch((error) => …)`
- `ReelAxisEffect` 的緩動表（每個緩動改成具名函式）
- `BaseDropSlotMachine` 批次中的 `start: () => reel.startDropXxx()`
- `SlotMachineScene` 的按鈕 handler、機台回呼、`addButton()` 收的 `handler`

已是具名欄位的箭頭函式（例：`BaseSlotMachine._tickHandler`、`BaseReel._firstHalfCompleteHandler`）不動。型別宣告中的 `=>` 不是函式，不動。

### 9.2 建構子 → `init()`

| 類別 | 現況 | 改成 |
|---|---|---|
| `BaseMovement` | 建構子收 `initialValue` 並檢查 | `init(initialValue)` + `_inited`；呼叫端（`BaseReel`、`ReelAxisEffect`、`BaseDropReel`）隨之改 |
| `ReelStopFlow` | 建構子收 4 個相依 | `init(…)` + `_inited`；`BaseReel` 隨之改 |
| `BaseRoundManager`、`RollRoundManager`、`DropRoundManager` | 建構子收機台並 throw | §8 |
| `TestSlotMachine` | 建構子收參數 | `init(…)`，由 `SlotMachineScene` 呼叫 |
| `TestReelIcon` | 建構子收方向 | §7 |
| `SlotMachineScene` | 建構子內初始化 | 非 eui 物件：第一次 `ADDED_TO_STAGE` 時呼叫 `init()`；另提供 `cleanup()` |

- 已有 `init()`／`cleanup()` 的類別照舊，只檢查 `cleanup()` 是否漏清新增的監聽與 Promise
- 新增 Promise 必須同時有取消路徑並在 `cleanup()` 處理（規範「禁止 unresolved promise」）

### 9.3 `unknown` → `any`

`BaseDropSlotMachine.assertOnePerReel(values: unknown[], …)` 與 `Manager/` 各處改 `any`，使用前做型別檢查。

---

## 10. 輕量骨架

### 10.1 會新增的檔案（路徑暫定）

| 檔案 | 內容 |
|---|---|
| `src/SlotMachine/Core/Event/SlotMachineEvent.ts` | `slot_core.SlotMachineEvent` |
| `src/SlotMachine/Core/Event/ReelEvent.ts` | `slot_core.ReelEvent` |
| `src/SlotMachine/Core/ISlotMachine.ts` | `slot_core.ISlotMachine` |
| `src/SlotMachine/Drop/Event/DropEvent.ts` | `slot_drop.DropEvent` |
| `src/SlotMachine/Drop/IDropSlotMachine.ts` | `slot_drop.IDropSlotMachine` |
| `src/SlotMachine/Manager/Event/RoundEvent.ts` | `slot_manager.RoundEvent` |

### 10.2 會修改的檔案

範圍內全部 `.ts`（`src/SlotMachine/**` 29 個、`src/test/**` 4 個），以及 `Main.ts` 的一行。

### 10.3 生命週期與清理責任

| 誰 | init 做什麼 | cleanup 做什麼 |
|---|---|---|
| `BaseRoundManager` | 收機台介面、加機台事件監聽 | 移除監聽、放掉逐軸 Promise、清參照 |
| `SlotMachineScene` | 建機台、加機台／單軸事件監聽、建按鈕並加 `TOUCH_TAP` 監聽 | 移除全部監聽、`machine.cleanup()` |
| `BaseReel` | 建 `BaseMovement`、`ReelStopFlow` 並 `init()` | 照舊；確認同模組回呼解除 |
| `BaseDropReel` | 照舊 | 照舊，移除 `onValueChanged` 相關 |

### 10.4 分階段（細節在 plan）

1. namespace 化（全部範圍檔案 + `Main.ts` 一行），編譯通過
2. 自訂事件與介面（§5、§8.1），移除跨模組回呼屬性
3. Icon（§7）與 `BaseDropReel`（§6）
4. Manager 改寫（§8.2）
5. 其他規範修正（§9）
6. 測試場景接上新介面、瀏覽器確認

---

## 11. 驗證

| 項目 | 方法 | 通過條件 |
|---|---|---|
| TS 2.4.2 編譯 | `node D:\engine\egret\egret-core-master\tools\lib\typescript-plus\bin\tsc --noEmit -p tsconfig.json`（引擎內建 2.4.2，照專案 tsconfig） | 0 錯誤 |
| 無 `import`／`export` | 範圍內搜尋 `^\s*(import|export)\s` | 0 筆（`Main.ts` 亦無） |
| Map／Set 用法在 lib 範圍內 | 搜尋 `keys()`／`values()`／`entries()`／`Array.from`／`for...of` 走訪 Map／Set | 0 筆 |
| 無匿名函式 | 逐檔檢查呼叫處的 `=>` 與 `function(` | 只剩具名欄位與型別宣告 |
| 跨模組不用回呼 | `slot_drop`、`slot_manager`、`slot_test` 內搜尋對其他模組物件指派 `.onXxx =` | 0 筆 |
| 監聽成對 | 每個 `addEventListener` 在對應 `cleanup()` 有相同參數的 `removeEventListener` | 全部成對 |
| 瀏覽器 | 預覽測試場景：開轉（一般／Turbo／L2）、急停、切換盤面／方向／軸數／停輪時間／聽牌 | 行為與改寫前相同，console 無錯誤 |

`tests/` 不在驗證範圍（已知無法編譯）。

---

## 12. 風險

| 風險 | 處理 |
|---|---|
| 改動面大（約 33 個檔），行為回歸 | 分階段，每階段編譯通過才進下一階段；最後瀏覽器確認 |
| 斷言無法執行，少了自動化回歸保護 | 使用者已決定本輪略過 `tests/`；靠編譯與瀏覽器確認，並在 checkpoint 記錄 |
| webpack `legacy` 模式下 namespace 載入順序 | 已讀 bundler 原始碼確認會排序；第 1 階段結束即在瀏覽器確認能跑 |
| 事件每格／每幀配置物件 | 發送前檢查 `hasEventListener` |
| 對外 API 改變（回呼屬性 → 事件、建構子 → `init()`、`iconFactory` → `iconClass`） | 規範要求的改寫，使用者已同意；範圍內呼叫端全部同步改 |

---

## 13. 單軸事件調整（2026-10-01 定案，code review 第 5 項延伸）

### 13.1 原則（使用者定）

- **單軸發的東西只給自己的軸用**；跨系統取用資訊一律透過機台／manager
- 軸內部的通知用**回呼**（比事件快）；同模組回呼本來就允許（§3）

起因：review 指出單軸每格發的事件每次新建事件物件。追下去發現 `ReelEvent` 是公開事件，目前唯一在聽的是機台系統外的測試場景（`CELL_MOVEMENT_COMPLETE`），跳過了機台；其餘 9 種沒有人聽。機台自己要知道單軸狀態，用的是單軸的 Promise（`waitForStoppedAsync()`、`waitForSettledAsync()`、掉落 `startDropXxx()` 的回傳值），不用這些事件。

### 13.2 單軸事件的處理

| 單軸事件 | 處理 | 理由 |
|---|---|---|
| `ROLL_STARTED`、`ROLL_STOPPED` | 移除 | 外部用機台的 `REEL_STARTED`、`REEL_STOPPED` |
| `HALF_CELL_COMPLETE`、`CELL_MOVEMENT_COMPLETE` | 移除 | 滾動機制內部的節拍，機台、manager、遊戲都用不到 |
| `REEL_DATA_CHANGED` | 移除 | icon 換資料時本來就會收到 `onDataChanged()`（組成改變另有 `onCellChanged()`） |
| `START_EFFECT_COMPLETED`、`STOP_EFFECT_STARTED`、`STOP_EFFECT_COMPLETED` | 留在 `BaseReel`，改回呼 | 原本在軸收發的留在軸 |
| 掉落單軸 `DROP_STARTED`、`DROP_COMPLETED` | 留在 `BaseDropReel`，改回呼 | 同上 |

- `ReelEvent` 類別移除；`DropEvent` 只剩掉落機台發的 `REEL_DROP_STARTED`、`REEL_DROP_COMPLETED`
- 保留的回呼：以有名字的 handler 指派、`cleanup()` 內解除（§5.3 同規則）；只給同模組使用
- 測試場景不再監聽單軸；狀態文字改用場景本來就有的每幀心跳（`TestSlotMachine.onUpdate`）刷新
- 單軸因此不再對外發任何事件，review 第 5 項（每格新建事件物件）隨之消失

### 13.3 icon 新增兩個時間點

`BaseReelIcon` 開兩個可覆寫的方法（預設不做事，留給繼承類別），由單軸在對應時間點直接呼叫（單軸持有自己的 icon，同模組往下呼叫，與現有 `onDataChanged()` 同一種寫法）。名稱暫定。

| 方法 | 呼叫時機 | 用途（使用者舉例） |
|---|---|---|
| `onFullyEntered()` | 這張牌**完整進入**可視區時 | 特殊 symbol 整個進入盤面時啟動效果 |
| `onReachedFinalPosition()` | 停輪、**對齊結果**那一刻，**回彈開始之前** | 把模糊圖換成結果圖 |

呼叫點細節（依用途推得，實作時照此做）：

- `onFullyEntered()`
  - 大圖的 head 在進場側，一組牌最後進來的是 head；「完整進入」= head 走進可視區第一格的那個格子邊界（框架本來就在格子邊界交接，時間點明確）
  - 呼叫 head（負責畫整張圖的那個 icon）；每經過一次呼叫一次，表演牌也會呼叫，是不是特殊牌由 icon 看自己的資料決定
  - 一開始就擺在盤面上的牌不算進入；比可視區還長的牌不會完整進入
- `onReachedFinalPosition()`
  - 在 `BaseReel.completeStop()`、停止效果開始**之前**呼叫，回彈時看到的已是結果圖
  - 呼叫 strip 上**每一個** icon（含進場／退場緩衝區）：回彈會往外衝一段距離，緩衝區的牌可能露出來
  - 結果對齊與即停（`Immediate`）都呼叫，帶停止方式參數，由 icon 自己判斷
  - 掉落不需要（掉落的牌沒有模糊圖的問題）

### 13.4 狀態

- 已寫入本文；**尚未實作**，等使用者指示
