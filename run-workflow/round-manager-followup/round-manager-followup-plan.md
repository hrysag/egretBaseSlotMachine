# 核心程式改寫成符合 Egret 規範 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `src/SlotMachine/**`、`src/test/**` 改寫成符合 Egret 規範（namespace、自訂事件、介面注入、`init`／`cleanup`、無匿名函式、TS 2.4.2 語法），行為不變。

**Architecture:** 四個 namespace（`slot_core`、`slot_drop`、`slot_manager`、`slot_test`）取代 ES module；跨模組通知改成 `egret.Event` 子類別，同模組回呼保留；manager 以介面收機台；icon 以 `iconClass`／`iconSkinName` 字串建立。

**Tech Stack:** Egret 5.4.1、TypeScript 2.4.2（型別檢查）、webpack `legacy` 模式打包（`scripts/config.ts`，不動）

**Spec:** [round-manager-followup-spec.md](round-manager-followup-spec.md)

## Global Constraints

- 規範：`~/.claude/skills/game-implementation-boundary/engines/egret/` 全部照做，不以專案現況例外
- 範圍：只改 `src/SlotMachine/**`、`src/test/**`、`Main.ts` 的 `import` 那一行；**不動** `AssetAdapter.ts`、`LoadingUI.ts`、`Platform.ts`、`ThemeAdapter.ts`、`EgretToolchainShim.d.ts`、`Main.ts` 其他內容、`tests/**`、`scripts/**`
- 不寫任何 `import`／`export` 陳述式（namespace 內的 `export` 成員宣告除外）；跨 namespace 寫完整名稱，不用 `import X = …` 別名
- TS 2.4.2 語法：無 `unknown`、`?.`、`??`、`field!:`、`as const`、`readonly T[]`
- Map／Set：只用建構、`get`／`set`／`has`／`delete`／`clear`／`size`／`forEach`；不用 `keys()`／`values()`／`entries()`／`Array.from(map/set)`／`for...of` 走訪 Map／Set
- `strict`：參數標型別；`null`／`undefined` 寫進型別；欄位給初始值或型別寫 `T | null`
- 不直接寫匿名函式：一律具名方法或具名欄位（型別宣告裡的 `=>` 不算）
- 不隨手 `as` 轉型；一個參數一行；`throw new Error(` 換行再寫訊息
- 換行：沿用各檔原本的換行（`Core` 內 `BaseSlotMachine.ts`、`BaseReel.ts` 是 CRLF；`Drop/`、`Manager/` 是 LF）
- `egret build` 會改寫根目錄 `manifest.json` 的換行，build 後若 `git status` 顯示它被改，`git checkout -- manifest.json` 還原
- **不 commit**：每個階段結束寫 checkpoint，等使用者同意才進下一階段；commit 只在使用者要求時做

## 驗證工具

| 用途 | 指令 | 通過 |
|---|---|---|
| TS 2.4.2 型別檢查 | `node run-workflow/round-manager-followup/check-ts242.js` | 最後一行 `TypeScript 2.4.2 - 0 error(s)`，exit 0 |
| 打包 | `EGRET_PATH=D:/Egret_test/egret-core-master/egret-core-master node D:/Egret_test/egret-core-master/egret-core-master/tools/bin/egret build`（Git Bash；不設 `EGRET_PATH` 會報 `can't find Egret`） | 無錯誤；產出 `bin-debug/` |
| 瀏覽器 | `preview_start { name: "slot-debug" }`（`scripts/static-server.js` 端 `bin-debug/`，port 5321） | 測試場景顯示、console 無錯誤 |

**基準（改寫前，2026-09-30 實測）**：`check-ts242.js` 8 個錯誤 —— 7 個 `Cannot find name 'unknown'`（`BaseDropSlotMachine`、`Manager/` 各檔），1 個 `ReelAxisEffect.ts` TS7017（緩動表以 enum 當索引）。

**斷言**：`tests/` 本輪略過，無法執行；本計畫沒有自動化單元測試，每個 Task 以型別檢查 + 搜尋檢查 + （指定的 Task）瀏覽器確認驗證。

## Review Focus

1. **namespace 載入順序**：webpack `legacy` 模式靠 `sortUnmodules()` 排序；子類別（例 `TestSlotMachine extends slot_core.BaseSlotMachine`）若先於父類別執行會在瀏覽器報 `Cannot read property 'prototype' of undefined`。Task 1 結束必須在瀏覽器確認場景能開
2. **事件時機**：回呼改事件後，發送順序必須與原本相同 —— `DropEvent.DROP_COMPLETED` 在 resolve 掉落 Promise 之前；`RoundEvent.GAME_END` 在 `startGame()` resolve 之前；`SlotMachineEvent.REEL_STOPPED` 在同一幀原位置。Task 2 逐一對照原呼叫點，只換呼叫、不移位置
3. **重複 `init()`**：`BaseReel.init()` 可在非滾動時再次呼叫；新加 `_inited` 的內部類別（`BaseMovement`、`ReelStopFlow`）第二次 `init()` 必須不壞流程。Task 5 規定行為
4. **`cleanup()` 後再 `init()`**：manager、測試場景 `cleanup()` 必須移除全部監聽；再 `init()` 不得重複註冊（引擎同一組 listener+thisObject 本就不重複，但 `removeEventListener` 參數必須與 add 相同）
5. **`iconClass` 填錯**：找不到類別、或類別不是 `BaseReelIcon` 系列 → `configureIconDisplay()`／建立空殼時 throw，訊息含類別名稱，不可默默建成 `BaseReelIcon`

---

## Task 1：namespace 化

**Files:**
- Modify: `src/SlotMachine/Core/**/*.ts`（21 檔）→ `namespace slot_core`
- Modify: `src/SlotMachine/Drop/**/*.ts`（4 檔）→ `namespace slot_drop`
- Modify: `src/SlotMachine/Manager/**/*.ts`（4 檔）→ `namespace slot_manager`
- Modify: `src/test/*.ts`（4 檔）→ `namespace slot_test`
- Modify: `src/Main.ts`：刪除 `import { SlotMachineScene } from "./test/SlotMachineScene";`，`new SlotMachineScene()` → `new slot_test.SlotMachineScene()`

**Interfaces:**
- Produces：所有既有匯出名稱改成 namespace 成員，名稱不變。例：`slot_core.BaseSlotMachine`、`slot_core.BaseReel`、`slot_core.SymbolData`、`slot_core.SpinMode`、`slot_drop.BaseDropSlotMachine`、`slot_manager.BaseRoundManager`、`slot_test.SlotMachineScene`

- [x] **Step 1：每檔改寫**
  - 刪除全部 `import …` 行
  - 整檔內容包進 `namespace slot_<模組> { … }`（縮排加一層）
  - 原本 `export` 的宣告保留 `export`（成為 namespace 成員）；原本未匯出的常數／函式維持不匯出
  - 同模組名稱直接用；跨模組改完整名稱（`slot_drop`、`slot_manager`、`slot_test` 內引用 core 的名稱寫 `slot_core.Xxx`）
  - `slot_core` 內不得出現 `slot_drop.`、`slot_manager.`、`slot_test.`；`slot_drop` 內不得出現 `slot_manager.`、`slot_test.`
- [x] **Step 2：`BaseReel.ts` 轉匯出**：刪除開頭 `export { … } from "…";` 共 6 組（`ReelIconDirection`、`SymbolData`、`SymbolVisualSize`、`ReelSymbolCellDefinition`、`ReelExpediteReason`、`ReelStopPlan`、`ReelStopPlanInput` 等）；原本從 `BaseReel` 匯入這些名稱的檔案，同模組直接寫名稱、跨模組寫 `slot_core.Xxx`
- [x] **Step 3：`Main.ts`**：只改 spec §4 那兩處，其他不動（Main.ts 註解提到 `import` 的那段不改）
- [x] **Step 4：搜尋檢查**
  - `rg -n "^\s*(import|export)\s" src/SlotMachine src/test src/Main.ts` → 只剩 namespace 內縮排的 `export class|interface|enum|type|const|function`，沒有頂層 `import`／`export`（用 `rg -n "^(import|export)\s"` 確認 0 筆）
  - `rg -n "slot_(drop|manager|test)." src/SlotMachine/Core` → 0 筆
  - `rg -n "slot_(manager|test)." src/SlotMachine/Drop` → 0 筆
- [x] **Step 5：型別檢查** `node run-workflow/round-manager-followup/check-ts242.js` → 錯誤數 ≤ 8，且只剩基準那 8 個（`unknown` ×7、`ReelAxisEffect` TS7017，行號可變）
- [x] **Step 6：打包** `egret build`（見驗證工具）→ 成功；`manifest.json` 若被改就還原
- [x] **Step 7：瀏覽器** `preview_start slot-debug` → 測試場景出現、按「一般」開轉並停輪一次、console 無錯誤（特別看 Review Focus 1）
- [x] **Step 8：寫 phase-1 checkpoint，停下等使用者同意**

---

## Task 2：自訂事件與機台介面

**Files:**
- Create: `src/SlotMachine/Core/Event/SlotMachineEvent.ts`、`src/SlotMachine/Core/Event/ReelEvent.ts`、`src/SlotMachine/Core/ISlotMachine.ts`
- Create: `src/SlotMachine/Drop/Event/DropEvent.ts`、`src/SlotMachine/Drop/IDropSlotMachine.ts`
- Create: `src/SlotMachine/Manager/Event/RoundEvent.ts`
- Modify: `Core/BaseSlotMachine.ts`、`Core/Reel/BaseReel.ts`、`Drop/BaseDropSlotMachine.ts`、`Drop/BaseDropReel.ts`、`Manager/BaseRoundManager.ts`、`test/SlotMachineScene.ts`

**Interfaces:**
- Produces（事件類別一律照 spec §5.1 寫法；`static readonly` 字串常數；欄位給預設值；`constructor(type: string, bubbles: boolean = false, cancelable: boolean = false)` 只呼叫 `super`）：

| 類別 | 常數（值） | 欄位（預設） |
|---|---|---|
| `slot_core.SlotMachineEvent` | `REEL_STARTED`（`"reelStarted"`）、`ALL_REELS_STARTED`（`"allReelsStarted"`）、`REEL_STOPPED`（`"reelStopped"`）、`ALL_REELS_STOPPED`（`"allReelsStopped"`）、`LISTEN_START`（`"listenStart"`）、`LISTEN_END`（`"listenEnd"`） | `reelIndex: number = -1`、`reel: BaseReel \| null = null`、`stopMode: ReelStopMode = ReelStopMode.ResultAligned` |
| `slot_core.ReelEvent` | `HALF_CELL_COMPLETE`、`CELL_MOVEMENT_COMPLETE`、`ROLL_STARTED`、`ROLL_STOPPED`、`STOP_EFFECT_STARTED`、`STOP_EFFECT_COMPLETED`、`START_EFFECT_COMPLETED`、`REEL_DATA_CHANGED`（值為 camelCase 同名字串） | `completedHalf: number = 0`、`stopMode: ReelStopMode = ReelStopMode.ResultAligned`、`runtime: ReelSymbolRuntime \| null = null`、`previousData: SymbolData \| null = null` |
| `slot_drop.DropEvent` | `REEL_DROP_STARTED`、`REEL_DROP_COMPLETED`（機台）；`DROP_STARTED`、`DROP_COMPLETED`（單軸） | `reelIndex: number = -1`、`reel: BaseDropReel \| null = null` |
| `slot_manager.RoundEvent` | `STAGE_ENTER`、`GAME_END` | `stage: RoundStage = RoundStage.RoundStart`（取 `RoundStage` 第一個成員）、`context: RoundStepContext \| null = null` |

- Produces（介面）：
  - `slot_core.ISlotMachine extends egret.IEventDispatcher`：`readonly spinning: boolean`；`startSpin(mode: SpinMode, reelIndexes?: number[]): Promise<void>`；`stopSpin(resultByReel: SymbolData[][]): Promise<void>`；`quickStop(): void`；`waitForSettledAsync(): Promise<void>`
  - `slot_drop.IDropSlotMachine extends egret.IEventDispatcher`：`readonly dropping: boolean`；`readonly allReelsDroppedOut: boolean`；`dropOut(fastMode?: boolean): Promise<void>`；`dropIn(boards: slot_core.SymbolData[][], fastMode?: boolean): Promise<void>`；`dropRefill(removePositions: number[][], refillCells: slot_core.SymbolData[][]): Promise<void>`；`quickStop(): void`
  - `BaseSlotMachine implements ISlotMachine`；`BaseDropSlotMachine implements IDropSlotMachine`，新增 getter `allReelsDroppedOut`（逐軸檢查 `droppedOut`，用一般 `for` 迴圈，不用 `every` + 匿名函式）
  - `BaseRoundManager extends egret.EventDispatcher`

- [x] **Step 1：建立 6 個新檔**（上表內容）
- [x] **Step 2：發送端**：每個發送類別加一個私有發送方法，先 `if (!this.hasEventListener(type)) { return; }` 再 `new` → 填欄位 → `this.dispatchEvent(evt)`；把原本每個 `if (this.onXxx !== undefined) { this.onXxx(…); }` 換成呼叫該方法，**位置不動**（Review Focus 2）
- [x] **Step 3：移除回呼屬性**：spec §5.2 表中全部 `public onXxx?` 屬性及 `cleanup()` 內清它們的行（`BaseSlotMachine.cleanup()`、`BaseReel.cleanup()`、`BaseDropReel.cleanup()`、`BaseDropSlotMachine.cleanup()`）
- [x] **Step 4：接收端（暫時版）**
  - `BaseRoundManager`：`bindMachineEvents()` 改成對機台 `addEventListener(SlotMachineEvent.REEL_STARTED, this.onReelStartedEvent, this)` 等 6 個；handler 改成具名 private 方法，收事件後照舊呼叫可覆寫方法並收 Promise。`onStageEnter`／`onGameEnd` 改成發 `RoundEvent`（`hasEventListener` 檢查同 Step 2）。完整改寫在 Task 4
  - `SlotMachineScene`：`machine.onReelStarted = …` 等 5 個、`reel.onCellMovementComplete = …` 改成 `addEventListener(…, this.onXxxEvent, this)` 具名方法；移除監聽放在場景重建機台前（原本清掉舊機台的位置）
  - `DropRoundManager`：`machine.reelList.every(…)` 改成 `machine.allReelsDroppedOut`
- [x] **Step 5：搜尋檢查** `rg -n "\.on[A-Z]\w*\s*=[^=]" src/SlotMachine/Drop src/SlotMachine/Manager src/test` → 只剩 `slot_test` 內 `onUpdate`（同模組）；`rg -n "public on\w+\?:" src/SlotMachine` → 只剩 `BaseMovement` 三個
- [x] **Step 6：型別檢查** → 只剩基準的 8 個
- [x] **Step 7：打包 + 瀏覽器**：一般／Turbo 開轉、急停、切換聽牌各一次；場景上的起轉／停輪／聽牌標記照常出現
- [x] **Step 8：寫 phase-2 checkpoint，停下等使用者同意**

---

## Task 3：Icon 與 `BaseDropReel` 主動讀值

**Files:**
- Modify: `Core/Reel/Config/ReelConfig.ts`（`ReelIconDisplayConfig`、移除 `ReelIconFactory`）
- Modify: `Core/Reel/BaseReel.ts`、`Drop/BaseDropReel.ts`（兩個欄位、`configureIconDisplay()`）
- Modify: `Core/Reel/Internal/ReelIconManager.ts`（`initializeIcons()`）
- Modify: `Core/Reel/BaseReelIcon.ts`（`setupCell()`、`onCellSetup()`）
- Modify: `test/TestReelIcon.ts`、`test/TestSlotMachine.ts`

**Interfaces:**
- Produces：
  - `ReelIconDisplayConfig { readonly iconClass?: string; readonly iconSkinName?: string; }`
  - `BaseReel`、`BaseDropReel`：`public iconClass: string = ""`、`public iconSkinName: string = ""`（exml 可填）；`configureIconDisplay(config)` 寫入兩欄位後建立空殼（其餘既有行為不變）
  - `ReelIconManager.initializeIcons(container: egret.DisplayObjectContainer, iconClass: string, iconSkinName: string, exitTowardPositiveAxis: boolean, vertical: boolean): void`
    - `iconClass === ""` → 用 `slot_core.BaseReelIcon`；否則 `egret.getDefinitionByName(iconClass)`，結果為 `null`、或不是 `BaseReelIcon` 本身／子類別（`cls === BaseReelIcon || cls.prototype instanceof BaseReelIcon`）→ `throw new Error(` 含 `iconClass` 的訊息
    - 每個空殼 `new`，`iconSkinName !== ""` 時設 `skinName`，再 `setupCell(cellPitch, exitTowardPositiveAxis, vertical)`
  - `BaseReelIcon.setupCell(cellPitch: number, exitTowardPositiveAxis: boolean, vertical: boolean): void`；新增唯讀 getter `exitTowardPositiveAxis`、`vertical`；`onCellSetup(cellPitch: number): void` 簽章不變，子類別在其中讀 getter
  - `TestReelIcon`：無建構子參數；方向改讀 `this.exitTowardPositiveAxis`、`this.vertical`
  - `TestSlotMachine.applyInitialLayout()`：`reel.configureIconDisplay({ iconClass: "slot_test.TestReelIcon" })`；刪除 `createIcon()`

- [x] **Step 1：Icon 相關檔案照上表改**
- [x] **Step 2：`BaseDropReel`**（spec §6）：`createGroupDrop()` 不設 `onValueChanged`；`update()` 內每組 `drop.movement.update(deltaTime)` 後把 `drop.movement.value` 寫進 `drop.runtimes` 每一格的 `cellOffset`；刪除 `completeDrop()`、`cleanup()` 內 `movement.onValueChanged = undefined`
- [x] **Step 3：搜尋檢查** `rg -n "iconFactory|ReelIconFactory|onValueChanged" src/SlotMachine/Drop src/test` → 0 筆；`rg -n "iconFactory|ReelIconFactory" src` → 0 筆
- [x] **Step 4：型別檢查** → 只剩基準的 8 個
- [x] **Step 5：打包 + 瀏覽器**：切換方向（垂直正／反、水平）各轉一次，牌面方向與改寫前相同；故意把 `iconClass` 改成 `"slot_test.NotExist"` 重新 build，確認 throw 訊息含該名稱，再改回（Review Focus 5）
- [x] **Step 6：寫 phase-3 checkpoint，停下等使用者同意**

---

## Task 4：Manager 改寫

**Files:**
- Modify: `Manager/BaseRoundManager.ts`、`Manager/RollRoundManager.ts`、`Manager/DropRoundManager.ts`、`Manager/Data/RoundData.ts`

**Interfaces:**
- Consumes：Task 2 的 `ISlotMachine`、`IDropSlotMachine`、事件類別、`RoundEvent`
- Produces：
  - `class BaseRoundManager extends egret.EventDispatcher`（非 abstract、無泛型）
    - `public init(roll: slot_core.ISlotMachine | null, drop: slot_drop.IDropSlotMachine | null): void`：`_inited` 已為 true 時 throw；存參照；對非 null 的機台加事件監聽
    - `public cleanup(): void`：移除全部監聽（參數與 add 相同）、清空逐軸 Promise 陣列、機台參照設 `null`、`_playing = false`、`_inited = false`
    - `private assertInitialized(): void`；`startGame()`、`requestStop()` 開頭呼叫
    - `protected async nextRound(): Promise<RoundData | null>` → 預設 `return null;`，註解「留給繼承類別」
    - `protected async presentBoard(context: RoundStepContext): Promise<void>` → 預設 `throw new Error(`
    - 五個環節、逐軸事件方法、`onSkipRequested()`：`protected async`，預設只放註解「留給繼承類別。」
    - 環節流程：`playStep()`／`playRound()` 內直接依序 `await this.onRoundStart(context)` 等，刪除 `runStage()`／`hook.call`
  - `RollRoundManager.init()`：`roll === null` → throw，再 `super.init(…)`；`protected getSpinMode(round: RoundData | null): slot_core.SpinMode` 預設 throw
  - `DropRoundManager.init()`：`drop === null` → throw
  - `RoundData { readonly state: any; … }`、`RoundStepContext`、`RoundReelEventContext` 去泛型；`ROUND_DATA_PENDING` → `RoundData` 所在檔新增 `class RoundDataConst { public static readonly PENDING_STEP_INDEX: number = -1; }`（名稱暫定），原常數引用處改用它

- [x] **Step 1：`RoundData.ts` 去泛型、去 `unknown`、常數搬到類別**
- [x] **Step 2：`BaseRoundManager` 照上表改**，並處理 spec §8.2 清單：getter `reelEventContext` 改成 `private createReelEventContext(): RoundReelEventContext`（一般方法）；`cascades as RoundCascade[]` 改成先檢查 `cascades !== undefined`；壓 Uncaught 的空 catch 改成具名 private 方法；一個參數一行；`throw new Error(` 換行
- [x] **Step 3：`RollRoundManager`**：`startSpinning()` 收下 `startSpin()` 的 Promise 存在欄位，`presentBoard()` 在 `stopSpin()` 前 `await` 它（錯誤往外丟，不再 `void`）；`cleanup()` 覆寫清掉該欄位再 `super.cleanup()`
- [x] **Step 4：`DropRoundManager`**：`presentBoard()` 用 `allReelsDroppedOut`（Task 2 已改），確認無匿名函式
- [x] **Step 5：搜尋檢查** `rg -n "abstract|unknown|\.call\(|<TState" src/SlotMachine/Manager` → 0 筆；`rg -n "constructor\(" src/SlotMachine/Manager` → 0 筆
- [x] **Step 6：型別檢查** → 只剩 `BaseDropSlotMachine` 的 `unknown` 與 `ReelAxisEffect` TS7017 兩個
- [x] **Step 7：寫 phase-4 checkpoint，停下等使用者同意**（manager 目前沒有場景在用，瀏覽器無從驗證，checkpoint 註明）

---

## Task 5：其他規範修正（Core、Drop）

**Files:**
- Modify: `Core/Reel/Internal/BaseMovement.ts`、`Core/Reel/Internal/ReelStopFlow.ts`、`Core/Reel/BaseReel.ts`、`Core/Reel/Internal/ReelAxisEffect.ts`、`Drop/BaseDropReel.ts`、`Drop/BaseDropSlotMachine.ts`，以及 §9.1 搜到匿名函式的其他 Core 檔（`BaseSlotMachine.ts`、`ReelDataFlow.ts`、`ReelIconManager.ts`、`ReelSymbolRegistry.ts`、`ReelConfig.ts`）

**Interfaces:**
- Produces：
  - `BaseMovement`：無建構子；`private _inited = false`；`public init(initialValue: number = 0): void` —— **已 init 時直接 return**（Review Focus 3）；`cleanup()` 把 `_inited` 設回 false 並清指令與回呼
    - 呼叫端：`BaseReel.wireMovementAndReset()` 開頭 `this._movement.init(0)`；`ReelAxisEffect.configure()` 開頭 `this._movement.init(0)`；`BaseDropReel.createGroupDrop()`：`new BaseMovement()` 後 `movement.init(from)`
  - `ReelStopFlow`：無建構子；`public init(dataFlow: ReelDataFlow, cellSpanResolver: ReelCellSpanResolver, performanceDataProvider: ReelPerformanceDataProvider, dataValidator: ReelDataValidator): void` —— 已 init 時直接 return；四個欄位型別 `T | null = null`，內部經由 `private get dataFlow(): ReelDataFlow`（null 時 throw）等 getter 取用
    - 呼叫端：`BaseReel` 欄位改 `private readonly _stopFlow = new ReelStopFlow();`，`wireMovementAndReset()` 內 `this._stopFlow.init(this._dataFlow, this._cellSpanResolver, this._performanceDataProvider, this._flowDataValidator)`
  - `ReelAxisEffect` 緩動表：每個緩動改成 `ReelAxisEffect` 上的 `private static` 具名方法；查表改成 `switch (easing)` 回傳對應方法（同時解掉 TS7017）
  - `BaseDropSlotMachine.assertOnePerReel(values: any[], label: string)`
  - `BaseDropSlotMachine` 批次的 `start: () => reel.startDropXxx()`：批次項目改存 `{ reelIndex, reel, kind, board, … }` 資料，由具名方法依 `kind` 呼叫 `reel.startDropOut()`／`startDropIn()`／`startDropRefill()`（`kind` 用 enum，名稱暫定 `DropBatchKind`）

- [x] **Step 1：`BaseMovement`、`ReelStopFlow` 與呼叫端**
- [x] **Step 2：`ReelAxisEffect` 緩動表**
- [x] **Step 3：`BaseDropSlotMachine`**：`unknown`、批次 `start`
- [x] **Step 4：其餘匿名函式**：`rg -n "=>" src/SlotMachine` 逐筆處理 —— 陣列 callback 改一般 `for` 迴圈或具名方法；`new Promise((resolve) => …)` 改具名 executor 欄位（例：`private readonly _stopPromiseExecutor = (resolve: () => void): void => { this._resolveStopPromise = resolve; };`）；`.then(() => …)` 改 `async` 寫法；`[...a, ...b]` 不是函式，不動
- [x] **Step 5：搜尋檢查** `rg -n "=>" src/SlotMachine` → 每一筆都是具名欄位（`private readonly _xxx = (…): T => {`）或型別宣告；`rg -n "unknown|constructor\(" src/SlotMachine` → 0 筆
- [x] **Step 6：型別檢查** → `TypeScript 2.4.2 - 0 error(s)`
- [x] **Step 7：打包 + 瀏覽器**：一般／Turbo／L2 開轉、急停、切換停輪時間、切換軸數各一次，行為與改寫前相同
- [x] **Step 8：寫 phase-5 checkpoint，停下等使用者同意**

---

## Task 6：測試場景生命週期與最終驗證

**Files:**
- Modify: `test/SlotMachineScene.ts`、`test/TestSlotMachine.ts`、`test/TestSymbolTable.ts`

**Interfaces:**
- Produces：
  - `TestSlotMachine`：無建構子參數；`public initTest(reels: slot_core.BaseReel[], layoutType: slot_core.ReelIconDirection, inverseDirection: boolean, targetStopTime: number): void` 存三個值後呼叫 `this.init(reels)`；三個欄位給預設值（`Vertical`、`false`、`0.15`）
  - `SlotMachineScene`：無建構子內容；第一次 `egret.Event.ADDED_TO_STAGE` 時呼叫 `public init(): void`（`_inited` 防重複；handler 具名，觸發後移除監聽）；`public cleanup(): void` 移除全部按鈕 `TOUCH_TAP`、機台與單軸事件監聽、`machine.cleanup()`
  - `addButton(label: string, x: number, y: number, handler: (event: egret.TouchEvent) => void)`：呼叫端傳具名方法（`this.onNormalButtonTap` 等），`addEventListener(egret.TouchEvent.TOUCH_TAP, handler, this)`；按鈕與 handler 成對記錄，`cleanup()` 逐一移除
- [x] **Step 1：`TestSlotMachine`、`SlotMachineScene` 照上表改**；場景內其餘匿名函式（`.catch((error) => …)`、`map((mark) => …)` 等）同 Task 5 Step 4 處理；`TestSymbolTable` 的 `TEST_SYMBOLS.map(item => …)` 同
- [x] **Step 2：全範圍搜尋檢查（spec §11）**
  - `rg -n "^(import|export)\s" src/SlotMachine src/test src/Main.ts` → 0 筆
  - `rg -n "\.(keys|values|entries)\(\)|Array\.from|\?\.|\?\?|\bunknown\b|\babstract\b" src/SlotMachine src/test` → 0 筆
  - `rg -n "=>" src/SlotMachine src/test` → 只剩具名欄位與型別宣告
  - `rg -n "addEventListener" src/SlotMachine src/test` 與 `rg -n "removeEventListener" …` 逐一配對，參數相同
  - `rg -n "constructor\(" src/SlotMachine src/test` → 只剩事件類別的建構子（只呼叫 `super`）
- [x] **Step 3：型別檢查** → 0 error(s)
- [x] **Step 4：打包 + 瀏覽器（完整）**：開轉（一般／Turbo／L2）、急停、切換 Server 延遲／盤面／方向／軸數／停輪時間／聽牌，各至少一次；console 無錯誤；截圖附在 checkpoint
- [x] **Step 5：寫 final checkpoint，停下等使用者同意**

---

## Task 7：重寫斷言（`tests/`）—— 2026-10-01 code review 後追加，待使用者確認做法

**起因**：`tests/CoreGeometry.test.ts`（4855 行、357 項斷言）以 `import` 載入核心、用舊 API，本輪改寫後編譯不過。使用者確認重要，要重寫。

**Files:**
- Modify: `tests/EgretStub.ts`、`tests/CoreGeometry.test.ts`
- Create: `tests/build-tests.js`（編譯＋執行腳本）

**做法（草案）**

1. **載入方式**：不再用 `import`。以腳本收集 `src/SlotMachine/**/*.ts`，依 `extends` 關係排出父類別在前的順序（與打包工具 `sortUnmodules()` 同一件事），連同 `tests/EgretStub.ts`、測試檔用 `tsc --outFile` 編成一個 js，在 Node 執行
2. **Egret 替身補齊**：`egret.EventDispatcher`（add／remove／has／dispatch，同一組 listener + thisObject 不重複）、`egret.Event`、`egret.getDefinitionByName`（依點號路徑從全域找）、`egret.startTick`／`stopTick`、`eui.Component` 繼承 EventDispatcher
3. **測試檔改寫**：import → `slot_core.X` 等完整名稱；回呼屬性（14 處）→ `addEventListener`；manager 建構子 → `init()`；去泛型；`iconFactory` → `iconClass`（測試用空殼放進測試的 namespace）；`BaseMovement(x)` → `init(x)`；`ROUND_DATA_PENDING` → `RoundDataConst.PENDING_STEP_INDEX`
4. **補新行為的斷言**：事件（沒人聽不建事件物件、發送順序）、`init()`／`cleanup()` 監聽成對、`iconClass` 找不到會 throw、`requestStop()` 未 init 不 throw、掉落「上一批還在跑時下指令不蓋資料」
5. **還原確認**：挑幾項新斷言故意改壞，確認會變紅

**待使用者決定**：測試檔裡的匿名函式（約 357 行有 `=>`，多為斷言用的小函式）是否也要照「禁止匿名函式」改寫。`tests/` 不進遊戲打包、不在 Egret 執行；照改的話改動量大很多

**Verification**：`node tests/build-tests.js` → 全部斷言通過；專案型別檢查仍 0 error(s)
