# Workflow Checkpoint：Phase 3 Icon 與 `BaseDropReel` 主動讀值

## Current Workflow

- Mode：FAST
- State：IMPLEMENTATION
- Round topic：round-manager-followup
- Round folder：`run-workflow/round-manager-followup/`
- Runtime state：`run-workflow/workflow-state.json`
- Active phase：phase-3（plan Task 3）→ 狀態 **VERIFIED**，使用者同意後標 DONE（Phase 1、2 已 DONE）
- Archived：false
- Archive path：（無）
- Recovery source：runtime-state

## Artifacts

- Spec：[round-manager-followup-spec.md](round-manager-followup-spec.md)
- Plan：[round-manager-followup-plan.md](round-manager-followup-plan.md)（Task 3 六個步驟已勾選）
- Phase handoff：[round-manager-followup-phase-3-handoff.md](round-manager-followup-phase-3-handoff.md)
- Last checkpoint：本檔（前一份：[round-manager-followup-phase-2-checkpoint.md](round-manager-followup-phase-2-checkpoint.md)）
- Last review：無獨立 review
- Last verification：本檔 Verification Evidence（2026-10-01）
- Last reconciliation：本檔 Workspace

## Pause / Cancel

- isPaused：false
- isCancelled：false
- resumeAllowed：true

## Workspace

- Workspace reconciliation：**RECONCILED**
  - 修改：`Core/Reel/Config/ReelConfig.ts`、`Core/Reel/Internal/ReelIconManager.ts`、`Core/Reel/BaseReelIcon.ts`、`Core/Reel/BaseReel.ts`、`Drop/BaseDropReel.ts`、`test/TestReelIcon.ts`、`test/TestSlotMachine.ts`，全在 handoff 允許範圍
  - 換行：CRLF 檔（前 6 個中的 Core 與 test 檔）維持 CRLF；`BaseDropReel.ts` 維持 LF
  - `manifest.json`：未改動
  - Phase 1、2 修改仍未 commit
- Blocking issue：無

## Completed Tasks

- `ReelIconDisplayConfig`：`iconFactory` → 選填 `iconClass`、`iconSkinName`；刪除 `ReelIconFactory`（刪除前已確認只有本階段改到的檔案在用）
- `BaseReel`、`BaseDropReel`：新增 `public iconClass: string = ""`、`public iconSkinName: string = ""`
- `configureIconDisplay(config)`：config 有給的欄位優先，沒給的沿用欄位目前值；**建立成功才寫回欄位**
- `ReelIconManager.initializeIcons(container, iconClass, iconSkinName)`：
  - 用 `egret.getDefinitionByName()` 找類別；空字串 = `BaseReelIcon`；找不到或不是 `BaseReelIcon` 系列 → throw（訊息含名稱），**在清掉現有空殼之前**檢查
  - 有 `iconSkinName` 才設 `skinName`
  - 方向由本類別交給 `setupCell()`
- `BaseReelIcon.setupCell(cellPitch, exitTowardPositiveAxis, vertical)`，新增唯讀 getter `exitTowardPositiveAxis`、`vertical`
- `TestReelIcon`：拿掉建構子參數，改讀基底 getter；`TestSlotMachine`：改傳 `{ iconClass: "slot_test.TestReelIcon" }`，刪除 `createIcon()`
- `BaseDropReel`：不再掛 `BaseMovement.onValueChanged`；`update()` 每組推完移動後，把 `movement.value` 寫進該組每一格，全部推完再 `syncAllIcons()`。已確認 `moveTo()` 只排指令、不會當場寫值，行為和原本一樣

**和 plan 不同的兩處（都是往更簡單、更安全的方向）**

1. `initializeIcons()` 不另外收兩個方向參數：`ReelIconManager` 本身就是方向的唯一來源，由它直接交給 `setupCell()`
2. `configureIconDisplay()` 原訂先寫欄位再建立；實測發現類別錯誤時欄位會留下錯的值，改成建立成功才寫回

## Review Status

- 未另做獨立 code review；建議 Task 4 結束後對 Task 2～4 一起 review（同 Phase 2 checkpoint）

## Verification Evidence

- TypeScript compile：`TypeScript 2.4.2 - 8 error(s)`，與基準相同
- 搜尋：Drop／test 內 `iconFactory|ReelIconFactory|onValueChanged` 0 筆；`src` 內 `iconFactory|ReelIconFactory|createIcon` 0 筆
- 打包：成功、無錯誤
- 瀏覽器（JS 每幀推進，同 Phase 2；console 無錯誤）：
  - 四種方向（垂直正、垂直反、水平正、水平反）各轉一次：停輪、順序、聽牌正常；每軸 9 個 `TestReelIcon`，每個空殼的方向與所屬軸一致（不一致 0 個）
  - 大圖延伸：正向偏移 0；反向偏移 = 格長 − 大圖長（2 格 −128、3 格 −256）；垂直改 y、水平改 x —— 與 `TestReelIcon` 原本的算法一致
  - 錯的 `iconClass`：`"slot_test.NotExist"`、`"egret.Bitmap"` 都 throw，訊息含名稱；欄位仍是 `slot_test.TestReelIcon`，9 個空殼仍是原本那 9 個
  - 空字串 → 9 個 `BaseReelIcon`；改回 `slot_test.TestReelIcon` → 恢復，方向正確
  - 錯誤類別改用 JS 直接呼叫 `configureIconDisplay()` 測，沒有照 plan 改原始碼再打包（走的是同一段程式碼）
- 沒驗到：`iconSkinName`（專案沒有空殼用的 skin）；掉落模組（沒有場景在用，只有型別檢查）

## Remaining Risk

- 既有問題、這次沒有改：`BaseReel.init()` 在已有空殼時再以不同方向呼叫，空殼上記的方向不會更新。改寫前 `TestReelIcon` 在建構時記方向，也有同樣的問題。測試場景切換方向是整台重建，碰不到這個情況
- 空殼類別靠 `getDefinitionByName` 找全域名稱：類別所在檔案一定要被打包進去（目前打包工具會收全部未模組化的檔案，實測可用）
- 掉落單軸的主動讀值只有型別檢查，要等掉落有場景時才能在畫面上確認

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

1. Phase 3 標為 DONE
2. 寫 phase-4 handoff（plan Task 4：manager 改寫 —— 去 `abstract`／泛型／`unknown`／`hook.call`；`init(roll, drop)` 收介面、`cleanup()` 移除監聽；`startSpin()` 的 Promise 不再丟掉）
3. 執行 Task 4，型別檢查、搜尋檢查後寫 phase-4 checkpoint（manager 沒有場景在用，瀏覽器無從驗證），停下等同意

## Next Available Actions

1. 同意，進 Phase 4
2. 先 commit 再進 Phase 4
3. 修改本 checkpoint 或 Phase 4 做法／暫停／取消

## Recommended Next Step

- 進 Phase 4

## User Decision Needed

Please confirm one of:

1. Approve and continue.
2. Revise checkpoint, checklist, or proposed operation steps.
3. Pause workflow.
4. Cancel workflow.
