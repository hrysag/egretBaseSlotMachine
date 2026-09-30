# Phase Execution Handoff：Phase 4 Manager 改寫

## Required Superpower

`superpowers:executing-plans`（inline 執行）

## Phase

- Name：Phase 4 Manager 改寫（plan Task 4）
- Goal：`Manager/` 四個檔照 Cocos／Core 寫法與 Egret 規範改寫：去 `abstract`、泛型、`unknown`、`hook.call`；`init(roll, drop)` 收介面、`cleanup()` 移除監聽；起轉的 Promise 不再丟掉。流程（五個環節、逐軸事件、Stop 分流、全程 await）不變
- Mode：FAST
- Source plan：`run-workflow/round-manager-followup/round-manager-followup-plan.md` Task 4
- Spec：§8

## Runtime Gate

- Runtime state：`run-workflow/workflow-state.json`
- Current workflow state：IMPLEMENTATION
- Active phase：phase-4
- Workspace reconciliation：Phase 1～3 修改未 commit，RECONCILED
- Blocking issue：無

## Implementation Boundary

`game-implementation-boundary`（Egret）＋ 使用者對 manager 的寫法要求：不用匿名函式註冊、不把方法當值傳再 `.call`、不用 `abstract`／泛型、要遊戲實作的方法給預設實作並註明「留給繼承類別」、`init()` + `_inited` + `assertInitialized()` + `cleanup()`、一個參數一行、不隨手 `as`、不在 getter 裡臨時組物件、`throw new Error(` 換行寫訊息。

## Allowed Changes

- `Manager/BaseRoundManager.ts`、`Manager/RollRoundManager.ts`、`Manager/DropRoundManager.ts`、`Manager/Data/RoundData.ts`（LF）
- `Manager/Event/RoundEvent.ts`：只在型別需要時跟著改

## Forbidden Changes

- `Core/**`、`Drop/**`、`test/**`、`tests/**`
- 流程順序、事件發送時機

## Public API Notes（經使用者同意的變更）

- 建構子收機台 → `init(roll: slot_core.ISlotMachine | null, drop: slot_drop.IDropSlotMachine | null)`；重複 `init()` throw；新增 `cleanup()`
- 刪除 `RoundManagerMachines`（只有 manager 的建構子在用）
- 去泛型：`RoundData.state: any`；`RoundStepContext`、`RoundReelEventContext` 無型別參數
- `ROUND_DATA_PENDING` → `RoundDataConst.PENDING_STEP_INDEX`
- `nextRound()` 預設回 `null`；`presentBoard()`、`RollRoundManager.getSpinMode()` 預設 throw
- `rollMachine`／`dropMachine` 型別改介面，沒給為 `null`；`requireRollMachine()`／`requireDropMachine()` 回介面

## Handoff Rules

- 每個環節在呼叫處直接寫「進入 → await 對應方法 → 離開」，不經 `runStage()`
- 逐軸事件的 context：資料未到時用一個固定的 pending 物件（欄位），不每次新建
- 起轉：`startSpin()` 的 Promise 存在欄位；`presentBoard()` 照原時機呼叫 `stopSpin()`，與起轉 Promise 用 `Promise.all` 一起等（`stopSpin()` 會先登記結果再等起轉，不能改成先等起轉才呼叫）
- 壓「Uncaught (in promise)」的 `_ignoreRejectionHandler` 已是具名欄位，保留
- 若必須改名或改結構才能編譯，停下回報

## Verification

- 型別檢查 → 只剩 `BaseDropSlotMachine` 的 `unknown` 與 `ReelAxisEffect` TS7017（2 個）
- 搜尋：`abstract|unknown|\.call\(|<TState` 0 筆；`constructor\(` 0 筆（`Manager/`，事件類別除外）；監聽 add／remove 成對
- 打包成功；測試場景不受影響（開轉一次）
- manager 沒有場景在用，執行期流程無從在瀏覽器驗證（checkpoint 註明）
