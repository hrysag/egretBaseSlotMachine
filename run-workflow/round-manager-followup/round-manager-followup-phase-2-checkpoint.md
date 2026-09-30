# Workflow Checkpoint：Phase 2 自訂事件與機台介面

## Current Workflow

- Mode：FAST
- State：IMPLEMENTATION
- Round topic：round-manager-followup
- Round folder：`run-workflow/round-manager-followup/`
- Runtime state：`run-workflow/workflow-state.json`
- Active phase：phase-2（plan Task 2）→ 狀態 **VERIFIED**，使用者同意後標 DONE（Phase 1 已 DONE）
- Archived：false
- Archive path：（無）
- Recovery source：runtime-state

## Artifacts

- Spec：[round-manager-followup-spec.md](round-manager-followup-spec.md)
- Plan：[round-manager-followup-plan.md](round-manager-followup-plan.md)（Task 2 八個步驟已勾選）
- Phase handoff：[round-manager-followup-phase-2-handoff.md](round-manager-followup-phase-2-handoff.md)
- Last checkpoint：本檔（前一份：[round-manager-followup-phase-1-checkpoint.md](round-manager-followup-phase-1-checkpoint.md)）
- Last review：無獨立 review（見 Review Status）
- Last verification：本檔 Verification Evidence（2026-10-01）
- Last reconciliation：本檔 Workspace

## Pause / Cancel

- isPaused：false
- isCancelled：false
- resumeAllowed：true

## Workspace

- Workspace reconciliation：**RECONCILED**
  - 新增 6 檔：`Core/Event/SlotMachineEvent.ts`、`Core/Event/ReelEvent.ts`、`Core/ISlotMachine.ts`、`Drop/Event/DropEvent.ts`、`Drop/IDropSlotMachine.ts`、`Manager/Event/RoundEvent.ts`（LF）
  - 修改：`Core/BaseSlotMachine.ts`、`Core/Reel/BaseReel.ts`、`Drop/BaseDropSlotMachine.ts`、`Drop/BaseDropReel.ts`、`Manager/BaseRoundManager.ts`、`Manager/DropRoundManager.ts`、`test/SlotMachineScene.ts`，以及 `test/TestSlotMachine.ts` 一行註解（提到舊回呼名稱）
  - 換行：`BaseSlotMachine.ts` 一度被 `sed -i` 轉成 LF，已用 node 轉回 CRLF 並以 `file` 確認；其餘 CRLF 檔皆用 Edit 修改，確認仍為 CRLF
  - `manifest.json`：本次 build 未改動
  - Phase 1 的修改仍未 commit；開工前就有的 `doc/`、`tests/CoreGeometry.test.ts` 修改與未追蹤檔不變
- Blocking issue：無

## Completed Tasks

- 事件類別：`slot_core.SlotMachineEvent`（6 種）、`slot_core.ReelEvent`（8 種）、`slot_drop.DropEvent`（機台 2 種＋單軸 2 種）、`slot_manager.RoundEvent`（2 種）；欄位皆有預設值，建構子只呼叫 `super`
- 介面：`slot_core.ISlotMachine`、`slot_drop.IDropSlotMachine`（皆繼承 `egret.IEventDispatcher`）；`BaseSlotMachine`、`BaseDropSlotMachine` 各自 `implements`
- `BaseDropSlotMachine.allReelsDroppedOut`（一般 `for` 迴圈）；`DropRoundManager` 改用它，去掉 `every` + 匿名函式
- 發送端：每個類別的私有發送方法先 `hasEventListener`，沒人聽不 `new`；原本的呼叫位置與外圍 `try/finally` 不動
  - `BaseReel` 分三個：不帶資料、半格（`completedHalf`）、換資料（`runtime`、`previousData`）
  - `BaseRoundManager` 分兩個：`dispatchStageEnter()`、`dispatchGameEnd()`（`GAME_END` 仍在 `finishGame()` 之後、`startGame()` resolve 之前）
- 移除 spec §5.2 全部 18 個回呼屬性，以及各 `cleanup()` 內清它們的行；`cleanup()` 註解補上「外部監聽由監聽者自己移除」
- 接收端：
  - `BaseRoundManager` 改繼承 `egret.EventDispatcher`；對機台 `addEventListener` 6 個逐軸事件，handler 沿用既有具名欄位，參數改成事件物件；新增 `eventReelOf()`／`dropEventReelOf()`（事件缺軸時 throw）
  - `SlotMachineScene`：5 個機台事件、每軸 `CELL_MOVEMENT_COMPLETE` 改成具名方法；新增 `unwireMachineEvents()`，在重建機台（`unmountMachine()`）時、`machine.cleanup()` 之前以相同參數移除
- 註解中提到舊回呼名稱的地方改成事件名稱

## Review Status

- 未另做獨立 code review。自我對照：每個發送點只換呼叫、不移位置；監聽成對（場景 6 組 add／remove 參數相同）
- 建議：Task 4（manager 改寫）結束後，對 Task 2～4 一起做一次 review

## Verification Evidence

- TypeScript compile（`check-ts242.js`）：`TypeScript 2.4.2 - 8 error(s)`，與基準相同（`unknown` ×7、`ReelAxisEffect` TS7017 ×1）
- 搜尋：
  - Drop／Manager／test 內 `.onXxx =`：只剩 `BaseDropReel` 的 `movement.onValueChanged` 3 處（Task 3 處理）與 `SlotMachineScene` 的 `onUpdate`（同模組保留）
  - `public on…?:`：只剩 `BaseMovement` 3 個
  - `src/` 內已無任何被移除回呼的名稱
  - 相依方向、頂層 `import`／`export`：0 筆
- 打包：`egret build` 成功、無錯誤（需設 `EGRET_PATH=D:/Egret_test/egret-core-master/egret-core-master`；plan 的驗證工具列漏了這一項）
- 瀏覽器（`slot-debug`，console 無錯誤）：
  - 面板隱藏時畫面不推進，改用 JS 每幀呼叫機台 `update(1/60)`（每幀之間讓 await 續行跑完）推進；按鈕照常用滑鼠點擊
  - 一般（5 軸）：起轉 0／0.1／0.2／0.3／0.4 秒、停輪順序 0→1→2→3→4、聽牌 R1 0.884→2.382（長 1.498 秒）、全部停下
  - Turbo：全軸 0 秒起轉、0.650 秒同時停
  - 急停（一般模式 0.5 秒時按）：記錄到急停、全部停下
  - 切換軸數 → 1 軸、3 軸（重建機台）：事件照常，停輪順序沒有重複 → 舊機台監聽已移除、新機台只掛一次
  - 切換聽牌 → 無：沒有聽牌標記，停輪照常
- manager：目前沒有場景在用，執行期無從驗證，只有型別檢查
- Tests：本輪略過 `tests/`

## Remaining Risk

- manager 在建構子監聽機台、目前沒有 `cleanup()` 可以移除監聽 —— Task 4 補（`init()`／`cleanup()`）
- 遊戲端原本若直接掛 `BaseReel.onXxx` 等回呼，要改成監聽事件（範圍外的使用者只有 `tests/`，本輪不處理）
- 瀏覽器是用 JS 手動推進驗證的，沒有看真實的 rAF 心跳；如果要看真實心跳，需要打開瀏覽器面板，或由你在瀏覽器確認

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

1. Phase 2 標為 DONE
2. 寫 phase-3 handoff（plan Task 3：Icon 改用 `iconClass`／`iconSkinName` 建立；`BaseDropReel` 不再掛 `BaseMovement` 的回呼，每幀主動讀值）
3. 執行 Task 3，型別檢查、打包、瀏覽器（切換方向各轉一次；故意填錯 `iconClass` 確認 throw）後寫 phase-3 checkpoint，停下等同意

## Next Available Actions

1. 同意，進 Phase 3
2. 先 commit 再進 Phase 3
3. 你先在瀏覽器用真實心跳確認一次
4. 修改本 checkpoint 或 Phase 3 做法／暫停／取消

## Recommended Next Step

- 進 Phase 3

## User Decision Needed

Please confirm one of:

1. Approve and continue.
2. Revise checkpoint, checklist, or proposed operation steps.
3. Pause workflow.
4. Cancel workflow.
