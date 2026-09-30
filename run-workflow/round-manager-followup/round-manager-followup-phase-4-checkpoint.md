# Workflow Checkpoint：Phase 4 Manager 改寫

## Current Workflow

- Mode：FAST
- State：IMPLEMENTATION
- Round topic：round-manager-followup
- Round folder：`run-workflow/round-manager-followup/`
- Runtime state：`run-workflow/workflow-state.json`
- Active phase：phase-4（plan Task 4）→ 狀態 **VERIFIED**，使用者同意後標 DONE（Phase 1～3 已 DONE）
- Archived：false
- Archive path：（無）
- Recovery source：runtime-state

## Artifacts

- Spec：[round-manager-followup-spec.md](round-manager-followup-spec.md)
- Plan：[round-manager-followup-plan.md](round-manager-followup-plan.md)（Task 4 七個步驟已勾選）
- Phase handoff：[round-manager-followup-phase-4-handoff.md](round-manager-followup-phase-4-handoff.md)
- Last checkpoint：本檔（前一份：[round-manager-followup-phase-3-checkpoint.md](round-manager-followup-phase-3-checkpoint.md)）
- Last review：無獨立 review（見 Review Status）
- Last verification：本檔 Verification Evidence（2026-10-01）
- Last reconciliation：本檔 Workspace

## Pause / Cancel

- isPaused：false
- isCancelled：false
- resumeAllowed：true

## Workspace

- Workspace reconciliation：**RECONCILED**
  - 修改：`Manager/BaseRoundManager.ts`、`Manager/RollRoundManager.ts`、`Manager/DropRoundManager.ts`、`Manager/Data/RoundData.ts`（皆 LF）；其他檔未動
  - `manifest.json` 未改動；Phase 1～3 修改仍未 commit
- Blocking issue：無

## Completed Tasks

- 三個 manager 類別去 `abstract`、去泛型；`RoundData.state` 改 `any`；`unknown` 全部移除
- 生命週期：建構子收機台 → `init(roll, drop)`（介面注入，各自可 null；重複呼叫 throw）＋ `_inited` ＋ `assertInitialized()`（`startGame()`、`requestStop()` 開頭）＋ `cleanup()`（移除 6 個監聽、清逐軸 Promise、機台參照設 null、可再 `init()`）
  - `RollRoundManager.init()` 滾輪機台 null → throw；`DropRoundManager.init()` 掉落機台 null → throw
  - 刪除 `RoundManagerMachines`（只有舊建構子在用，已查無其他引用）
- 去掉 `runStage()` 與 `hook.call(this, context)`：每個環節在呼叫處直接寫「進入 → await 對應方法 → 離開」
- 要遊戲實作的方法給預設實作並註明「留給繼承類別」：`nextRound()` 回 `null`；`presentBoard()`、`getSpinMode()` throw；其餘環節與逐軸方法寫成 `async`，內容只有註解
- 其他：
  - getter `reelEventContext` → 一般方法 `currentReelEventContext()`；資料未到時回固定的一份 pending context（欄位），不每次新建
  - `cascades as RoundCascade[]` → 先判斷
  - `throw new Error(` 一律換行；多參數一律一行一個
  - `ROUND_DATA_PENDING` → `RoundDataConst.PENDING_STEP_INDEX`
  - `RollRoundManager`：`startSpin()` 的 Promise 存進欄位，`presentBoard()` 與 `stopSpin()` 用 `Promise.all` 一起等；`stopSpin()` 照原時機呼叫（它會先登記結果、再自己等起轉，先等起轉會改變時機）；`cleanup()` 清掉該欄位
  - `_ignoreRejectionHandler` 已是具名欄位，保留

## Review Status

- 未另做獨立 code review。Phase 2～4 改的都是公開寫法（事件、介面、manager 生命週期），建議在 Phase 5 之前做一次 review（見 Next Available Actions）

## Verification Evidence

- TypeScript compile：`TypeScript 2.4.2 - 2 error(s)`，只剩 `BaseDropSlotMachine` 的 `unknown`、`ReelAxisEffect` TS7017（Task 5 處理）
- 搜尋（`Manager/`）：`abstract|unknown|.call(|TState` 0 筆；`constructor(` 只剩 `RoundEvent`；`ROUND_DATA_PENDING|RoundManagerMachines` 在 `src/` 0 筆；`addEventListener` 6 ＝ `removeEventListener` 6；`=>` 只剩具名 handler 欄位
- 打包：成功、無錯誤
- **瀏覽器執行期驗證**（manager 沒有場景在用，改用 JS 在頁面上臨時繼承 `RollRoundManager`，接上測試場景的機台；每幀手動 `update(1/60)`）：
  - 一局兩個 round（NG、FG）：`mode(null)` 起轉 → 第 0 軸起轉事件 context =（資料未到, -1）→ 拿到 NG → 環節 1→2→3 → 其餘軸起轉、5 軸停下 → 環節 4（機台已不在轉）→ 5 → 拿到 FG → 1→2 → 環節 3 才起轉 `mode(FG)` → … → 5 → `next→null` → 整局結束；`RoundEvent`：`1 2 3 4 5 1 2 3 4 5 END`
  - 監聽數（機台各事件）：`init()` 前 1、`init()` 後 2、`cleanup()` 後 1
  - 遊戲的 `onReelStopped` 在第 2 軸 reject → `startGame()` reject（訊息正確），機台照常停完、`playing = false`
  - 轉動中 `requestStop()` → 轉急停，約 1.2 秒停完
  - 守門：未 `init()` 就 `startGame()`、重複 `init()`、`RollRoundManager.init(null, …)`、`DropRoundManager.init(…, null)` 都 throw
  - 預設實作：`getSpinMode()` 未覆寫 → reject；基底 `nextRound()` → 直接結束；基底 `presentBoard()` → reject
  - 全部 `cleanup()` 後機台只剩場景自己的監聽；之後場景按鈕開轉一次正常，console 無錯誤
- 沒驗到：`DropRoundManager` 的流程（沒有掉落機台的場景）

## Remaining Risk

- 一局進行中呼叫 `cleanup()`：流程下一次用到機台時 throw、`startGame()` reject；機台與畫面怎麼收拾仍是原本的待辦（主文件 §10.4「出錯後的收拾」）
- 既有行為沒改：滾輪 `beginGame()` 已起轉，但 `nextRound()` 第一次就回 `null` 時，一局結束了滾輪還在轉
- 本輪略過的 `tests/CoreGeometry.test.ts` 用的是舊 API（建構子收機台、回呼屬性、泛型），之後要恢復斷言時需要改寫

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

1. Phase 4 標為 DONE
2. 寫 phase-5 handoff（plan Task 5：`BaseMovement`／`ReelStopFlow` 建構子 → `init()`；`ReelAxisEffect` 緩動表改具名方法 + `switch`；`BaseDropSlotMachine` 的 `unknown` 與批次 `start` 匿名函式；Core／Drop 其餘匿名函式）
3. 執行 Task 5，型別檢查要到 0 錯誤；打包、瀏覽器（一般／Turbo／L2、急停、切換停輪時間、切換軸數）後寫 phase-5 checkpoint，停下等同意

## Next Available Actions

1. 同意，進 Phase 5
2. 先對 Phase 2～4 做一次 code review，再進 Phase 5
3. 先 commit 再進 Phase 5
4. 修改本 checkpoint 或 Phase 5 做法／暫停／取消

## Recommended Next Step

- 進 Phase 5；review 可留到 Phase 6 結束時對全部改動一起做

## User Decision Needed

Please confirm one of:

1. Approve and continue.
2. Revise checkpoint, checklist, or proposed operation steps.
3. Pause workflow.
4. Cancel workflow.
