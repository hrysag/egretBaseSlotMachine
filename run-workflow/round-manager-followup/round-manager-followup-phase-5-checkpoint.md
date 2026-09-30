# Workflow Checkpoint：Phase 5 其他規範修正（Core、Drop）

## Current Workflow

- Mode：FAST
- State：IMPLEMENTATION
- Round topic：round-manager-followup
- Round folder：`run-workflow/round-manager-followup/`
- Runtime state：`run-workflow/workflow-state.json`
- Active phase：phase-5（plan Task 5）→ 狀態 **VERIFIED**，使用者同意後標 DONE（Phase 1～4 已 DONE）
- Archived：false
- Archive path：（無）
- Recovery source：runtime-state

## Artifacts

- Spec：[round-manager-followup-spec.md](round-manager-followup-spec.md)
- Plan：[round-manager-followup-plan.md](round-manager-followup-plan.md)（Task 5 八個步驟已勾選）
- Phase handoff：[round-manager-followup-phase-5-handoff.md](round-manager-followup-phase-5-handoff.md)
- Last checkpoint：本檔（前一份：[round-manager-followup-phase-4-checkpoint.md](round-manager-followup-phase-4-checkpoint.md)）
- Last review：無獨立 review
- Last verification：本檔 Verification Evidence（2026-10-01）
- Last reconciliation：本檔 Workspace

## Pause / Cancel

- isPaused：false
- isCancelled：false
- resumeAllowed：true

## Workspace

- Workspace reconciliation：**RECONCILED**
  - 修改：`Core/Reel/Internal/BaseMovement.ts`、`ReelStopFlow.ts`、`ReelAxisEffect.ts`、`ReelDataFlow.ts`、`ReelIconManager.ts`、`Core/Reel/Data/ReelSymbolRegistry.ts`、`Core/Reel/BaseReel.ts`、`Core/BaseSlotMachine.ts`、`Core/SlotMachine/Config/SlotMachineSpinConfig.ts`（一行註解）、`Drop/BaseDropReel.ts`、`Drop/BaseDropSlotMachine.ts`，都在 handoff 允許範圍內
  - 換行：改檔工具先轉 LF、取代、再轉回原本的換行；CRLF 檔維持 CRLF，Drop 兩檔維持 LF
  - `manifest.json` 未改動；Phase 1～4 修改仍未 commit
- Blocking issue：無

## Completed Tasks

- **建構子 → `init()`**
  - `BaseMovement`：無建構子；`init(initialValue = 0)`（已 init 直接 return）；新增 `cleanup()`（清指令、三個回呼、值歸 0、`_inited = false`）。`BaseReel.cleanup()`、`ReelAxisEffect.cleanup()` 改呼叫它；`BaseReel.wireMovementAndReset()`、`ReelAxisEffect.configure()` 呼叫 `init(0)`；`BaseDropReel` 在 `new` 後 `init(from)`
  - `ReelStopFlow`：無建構子；四個相依改 `T | null`，由 `init(…)` 傳入（已 init 直接 return），經 private getter 取用（未 init 時 throw）；`BaseReel` 在 `wireMovementAndReset()` 呼叫
- **緩動表**：12 個緩動改成 `ReelAxisEffect` 的 `private static` 具名方法，`resolveEasing()` 改 `switch`（TS7017 解除）
- **`unknown`**：`BaseDropSlotMachine.assertOnePerReel(values: any[], …)`
- **匿名函式全部改掉**：
  - `new Promise((resolve) => …)` 5 處 → 具名 executor 欄位
  - 陣列 `map`／`filter`／`find`／`every`／`some`／`forEach` → 一般 `for` 迴圈（走訪順序與結果順序不變）
  - `sort` 比較：`ReelIconManager` → 具名欄位 `_iconLayerComparator`；`BaseDropSlotMachine` → `private static compareStartAt()`
  - `Map.forEach`（`ReelSymbolRegistry.getMaxCellSpan()`）→ 具名 visitor 欄位（lib 只允許 `forEach` 走訪 Map）
  - `Set.forEach`（`BaseDropReel.resolveRemovedIndexes()`）→ 另存一份同順序的陣列用一般迴圈走
  - `BaseSlotMachine.waitForSettledAsync()` 的 `.then(() => undefined)` → 抽出 `waitAllSettled()`（async）；轉動中的 throw 維持同步丟出
  - `ReelDataFlow.takeNextPerformanceSymbol()` 的判斷式參數 → `maxCellSpan: number`（`cellSpan` 恆為正整數，`=== 1` ⇔ `<= 1`）
  - `BaseDropSlotMachine` 批次：`PendingDropStart` 改存資料（`kind: DropBatchKind`、盤面／消除資料），由 `startReelDrop()` 依種類呼叫單軸；逐軸到位改由具名 handler `_reelDropSettledHandler` 依軸號轉發（時機同原本：單軸 Promise resolve 後第一個 microtask）
- 註解：`SlotMachineSpinConfig.ts` 一處舊回呼名稱改成事件名稱

**和 plan 不同的地方**：`BaseMovement` 沒有在各方法加 `assertInitialized()`（理由見 handoff：未設定前就可能被 `reset()`／`cleanup()`，加了會把原本可行的順序變成 throw）；`ReelDataFlow`、`Set.forEach`、`waitForSettledAsync()`、掉落到位轉發這幾處 plan 沒有逐一列出，做法見上。

## Review Status

- 未另做獨立 code review；建議 Phase 6 結束時對全部改動做一次

## Verification Evidence

- TypeScript compile：**`TypeScript 2.4.2 - 0 error(s)`**（基準 8 個全部解除）
- 搜尋（Core、Drop）：`=>` 只剩具名欄位與型別宣告；`unknown`、`constructor(`（事件類別除外）0 筆；陣列 callback 只剩 `Map.forEach(this._maxCellSpanVisitor)`；舊回呼名稱 0 筆
- 打包：成功、無錯誤
- **改寫前後逐行比對**（瀏覽器，JS 直接呼叫場景方法、每幀 `update(1/60)`；改寫前先錄基準存進 localStorage）：一般、Turbo、L2、一般 + 0.5 秒急停、切換停輪時間、切換軸數、切換聽牌，各軸起轉／停輪時刻、停輪順序、聽牌區間、停下盤面、表演牌用量，加上 12 種緩動 × 7 個取樣點 —— **85 行完全相同**
- **掉落**（JS 臨時組一台 3 軸掉落機台 + `DropRoundManager`）：
  - 掉出 → 掉入 → 消除一次，逐軸事件開始／到位齊全；消除時沒消的軸不發事件
  - 最後盤面 `[9,4,6]`、`[4,5,6]`、`[7,8,5]`，與手算預期相同
  - `cellOffset` 每幀前進（每幀讀值有效）；單軸自己的 `DROP_COMPLETED` 照常發出
  - 掉入途中急停：等待中的軸立刻開始、直接到位；三軸的到位通知都在整批 Promise resolve 之前
- console 無錯誤
- Tests：本輪略過 `tests/`

## Remaining Risk

- 掉落到位轉發的寫法改了（逐軸 closure → 一個 handler 掃全部軸）；上面驗證了順序與「整批結束前」，但只驗了 3 軸、單一情境
- `void dropped.then(…)`：與原本相同，機台被 `cleanup()` 時單軸 Promise 可能懸著（既有行為）
- 還剩 Task 6：測試場景的生命週期（建構子 → `init()`、按鈕監聽成對）與場景內其餘匿名函式

## User Approval Required

- Required: true
- Blocking: true
- Reason: Every checkpoint requires explicit user approval before the workflow may continue.

## Approval Basis

- [x] Current workflow state is understood.
- [x] Current phase status is documented in this checkpoint or the relevant phase artifact.
- [x] Review status is documented or explicitly not required for this scope.
- [x] Verification evidence is documented or the remaining verification gap is listed.
- [x] Workspace reconciliation is acceptable or the drift is listed as a blocker.
- [x] No unresolved blocking issue remains, or the blocker is listed below.
- [x] Runtime state has been synced to `run-workflow/workflow-state.json`.

## Confirmation Checklist

- [ ] The checkpoint summary is accurate.
- [ ] The listed completed tasks match the actual work.
- [ ] The verification evidence is acceptable.
- [ ] The remaining risks are acceptable or need revision.
- [ ] The proposed next operation is acceptable.

## Proposed Operation Steps

1. Phase 5 標為 DONE
2. 寫 phase-6 handoff（plan Task 6：`TestSlotMachine` 建構子 → `initTest()`；`SlotMachineScene` 建構子 → 第一次 `ADDED_TO_STAGE` 時 `init()`、新增 `cleanup()`；按鈕 handler 具名、監聽成對；`TestSymbolTable` 與場景其餘匿名函式）
3. 執行 Task 6，全範圍搜尋檢查（spec §11）、型別檢查 0、打包、瀏覽器完整操作後寫 final checkpoint，停下等同意

## Next Available Actions

1. 同意，進 Phase 6
2. 先 commit 再進 Phase 6
3. 修改本 checkpoint 或 Phase 6 做法／暫停／取消

## Recommended Next Step

- 進 Phase 6

## User Decision Needed

Please confirm one of:

1. Approve and continue.
2. Revise checkpoint, checklist, or proposed operation steps.
3. Pause workflow.
4. Cancel workflow.
