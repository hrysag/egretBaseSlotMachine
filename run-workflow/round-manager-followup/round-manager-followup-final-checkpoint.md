# Workflow Checkpoint：Final（Phase 6 測試場景生命週期與最終驗證）

## Current Workflow

- Mode：FAST
- State：VERIFICATION
- Round topic：round-manager-followup
- Round folder：`run-workflow/round-manager-followup/`
- Runtime state：`run-workflow/workflow-state.json`
- Active phase：phase-6（plan Task 6）→ 狀態 **VERIFIED**；Phase 1～5 已 DONE
- Archived：false
- Archive path：（無）
- Recovery source：runtime-state

## Artifacts

- Spec：[round-manager-followup-spec.md](round-manager-followup-spec.md)
- Plan：[round-manager-followup-plan.md](round-manager-followup-plan.md)（Task 1～6 全部步驟已勾選）
- Phase handoff：Phase 1～5 各一份（Phase 6 範圍小，沿用 plan Task 6，未另寫 handoff）
- Last checkpoint：本檔（前一份：[round-manager-followup-phase-5-checkpoint.md](round-manager-followup-phase-5-checkpoint.md)）
- Last review：[round-manager-followup-final-review.md](round-manager-followup-final-review.md)（2026-10-01，8 項：修 5、不需修 1、延後 2）
- Last verification：本檔 Verification Evidence（2026-10-01）
- Last reconciliation：本檔 Workspace
- 截圖：[round-manager-followup-final-screenshot.jpg](round-manager-followup-final-screenshot.jpg)（cleanup → init 之後，1 軸、垂直反向）

## Pause / Cancel

- isPaused：false
- isCancelled：false
- resumeAllowed：true

## Workspace

- Workspace reconciliation：**RECONCILED**
  - Phase 6 修改：`test/SlotMachineScene.ts`、`test/TestSlotMachine.ts`、`test/TestSymbolTable.ts`（換行維持原樣：前兩個 CRLF、最後一個 LF）
  - 整輪修改：`src/SlotMachine/**`（29 檔改 + 6 檔新增）、`src/test/**`（4 檔）、`src/Main.ts`（只有 import 那兩處）；全部未 commit
  - 開工前就有、非本輪：`doc/GameViewManager-Reference-Study.md`、`tests/CoreGeometry.test.ts` 的修改，`doc/SESSION-2026-09-28-RoundManager.md` 與兩個 session 匯出 zip
  - `manifest.json` 未改動
- Blocking issue：無

## Completed Tasks（Phase 6）

- `TestSlotMachine`：建構子 → `initTest(reels, layoutType, inverseDirection, targetStopTime)`（已 init 過直接略過，比照 `BaseSlotMachine.init()`）；三個欄位改成有預設值的一般欄位
- `SlotMachineScene`：
  - 初始化搬到 `public init()`（`_inited` 防重複）；第一次 `ADDED_TO_STAGE` 時由具名方法呼叫並移除該監聽
  - 新增 `public cleanup()`：移除 10 顆按鈕的 `TOUCH_TAP`、機台 5 種事件、各軸 `CELL_MOVEMENT_COMPLETE`、`onUpdate`，`machine.cleanup()`，移除全部子物件；之後可再 `init()`
  - `_machine`／`_frame` 改 `T | null`，讀取經 getter（未 init 時 throw）
  - 按鈕：`addButton(…, handler: (event: egret.TouchEvent) => void)` 收具名方法、以 `this` 註冊，並記下來給 `cleanup()` 用相同參數移除；三顆「開始」各一個具名方法
  - 其餘匿名函式：`onUpdate`、`startSpin`／`stopSpin` 的 `.catch` → 具名欄位；`filter`／`map` → 一般迴圈；狀態列的 groupOffset 串 → `describeGroupOffsets()`
- `TestSymbolTable`：`symbolDataList()`、`testCellDefinitions()` 的 `map` → 一般迴圈

**和 plan 不同的一處**：plan 寫場景「無建構子內容」。場景是 `egret.DisplayObjectContainer`（非 eui），依規範要在「第一次 ADDED_TO_STAGE」呼叫 `init()`；要收到這個事件，監聽只能在建構時掛，而 `Main.ts` 除了 import 那一行不在範圍內。所以建構子只留 `super()` 與註冊這一個監聽，其餘初始化全在 `init()`。

## 整輪結果（spec §11 驗證項目）

| 項目 | 結果 |
|---|---|
| TS 2.4.2 編譯 | `TypeScript 2.4.2 - 0 error(s)`（改寫前 8 個） |
| 無 `import`／`export` | 範圍內與 `Main.ts` 頂層 0 筆 |
| Map／Set 用法 | `keys()`／`values()`／`entries()`／`Array.from`／`?.`／`??`／`unknown`／`abstract` 0 筆；Map 只用 `forEach`（具名 visitor） |
| 無匿名函式 | `=>` 只剩具名欄位與型別宣告 |
| 跨模組不用回呼 | 跨模組回呼屬性全部改成自訂事件；只剩同模組的 `BaseMovement` 三個回呼與 `TestSlotMachine.onUpdate` |
| 監聽成對 | `BaseRoundManager` add 6／remove 6；`SlotMachineScene` add 8／remove 9（`ADDED_TO_STAGE` 在觸發時與 `cleanup()` 各移除一次） |
| 建構子 | 只剩 4 個事件類別（只呼叫 `super`）與場景（見上） |

## Review Status

- 2026-10-01 已做 code review（high），見 [round-manager-followup-final-review.md](round-manager-followup-final-review.md)
  - 已修：`requestStop()` 未 init 不再 throw；manager 機台欄位改 private；場景 `cleanup()` 回到剛建構狀態；`ReelStopFlow` 相依合成一個物件；掉落批次資料改存機台（在「上一批還在跑」檢查之後才寫入）
  - 不需修：第一個 round 回 null（伺服器沒資料時是在等，不會回 null；出錯情況歸既有待辦）
  - 延後：斷言重寫（→ plan Task 7）；每格事件改用事件池（目前只有測試場景在聽）
  - 修正後：型別檢查 0、打包成功、基準 85 行仍相同、各修正點另行驗證

## Verification Evidence

- TypeScript compile：0 error(s)
- 打包：成功、無錯誤
- **改寫前後逐行比對**（Phase 5 前錄的基準）：一般／Turbo／L2／急停／切換停輪時間／切換軸數／切換聽牌的各軸時刻、順序、聽牌、停下盤面，與 12 種緩動 —— Phase 6 之後仍 **85 行完全相同**
- **按鈕實點**（瀏覽器滑鼠點擊）10 顆全部有效：Normal／Turbo／L2 開轉並停輪、急停記錄「@0.500s」並全部停下、Server 延遲 0.05→0.30、盤面、方向（→垂直反向）、軸數（→1）、停輪時間（→1.60）、聽牌（→無）；切換後開轉一次，設定全部生效
- **場景 cleanup → init**：cleanup 後舊機台 5 種事件監聽 1→0、舊單軸 1→0、10 顆舊按鈕 1→0、`onUpdate` 清除、場景子物件 13→0、舊機台 `inited = false`；再 `init()` 建出新機台與 10 顆按鈕、開轉正常；重複 `init()` 無動作
- console 無錯誤
- 前面各階段另外驗過：manager 實跑（Phase 4）、掉落機台實跑（Phase 5）、icon 四方向與 `iconClass` 錯誤（Phase 3）
- Tests：本輪略過 `tests/`（仍用舊 API，無法編譯）
- 環境備註：瀏覽器面板隱藏時頁面載入，舞台尺寸會是 0×0，滑鼠點擊對不到按鈕；截圖一次後恢復。與程式無關

## Remaining Risk

- `tests/CoreGeometry.test.ts`（357 項斷言）用的是舊 API（`import`、回呼屬性、建構子收參數、泛型），本輪完全沒跑；恢復斷言需要另外改寫
- `doc/` 內仍以舊 API 描述的文件：`GameViewManager-Reference-Study.md`、`Port-Completeness-Audit.md`、`SESSION-2026-09-17-…`、`Slot-Base-Unit-Refactor-1x1.md`（提到 `onReelStopped`、`iconFactory`、`ROUND_DATA_PENDING` 等）；本輪沒改
- 瀏覽器驗證大多用 JS 手動推幀，沒有看真實 rAF 心跳下的畫面（面板隱藏）
- **測試場景沒有掉落的按鈕與畫面**：掉落只用 JS 臨時組機台驗過事件、盤面與急停，沒看過畫面。已列入待辦（`doc/GameViewManager-Reference-Study.md` §10.4，2026-10-01）
- 全部改動未 commit

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

1. Phase 6 標為 DONE（review 修正已完成）
2. 進 Phase 7（plan Task 7）：重寫斷言 —— 先請使用者決定測試檔的匿名函式要不要照規範改
3. Phase 7 完成後 workflow 標為 COMPLETE，再問是否封存
4. commit 由使用者決定時機

## Next Available Actions

1. 同意，進 Phase 7（並回答測試檔匿名函式要不要改）
2. 先 commit 目前的改動，再進 Phase 7
3. Phase 7 另開一輪，本輪先標完成
4. 修改本 checkpoint／暫停／取消

## Recommended Next Step

- 先 commit 目前的改動（已驗證、review 已修），再進 Phase 7；斷言重寫改動量大，分開 commit 比較好追

## User Decision Needed

Please confirm one of:

1. Approve and continue.
2. Revise checkpoint, checklist, or proposed operation steps.
3. Pause workflow.
4. Cancel workflow.
