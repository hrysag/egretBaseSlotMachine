# Phase Execution Handoff：Phase 5 其他規範修正（Core、Drop）

## Required Superpower

`superpowers:executing-plans`（inline 執行）

## Phase

- Name：Phase 5 其他規範修正（plan Task 5）
- Goal：Core、Drop 內剩下不合規範的寫法全部改掉：建構子收參數 → `init()`；緩動表匿名函式 → 具名方法；`unknown` → `any`；其餘匿名函式 → 一般 `for` 迴圈或具名欄位。行為不變；型別檢查到 0 錯誤
- Mode：FAST
- Source plan：`run-workflow/round-manager-followup/round-manager-followup-plan.md` Task 5
- Spec：§9

## Runtime Gate

- Runtime state：`run-workflow/workflow-state.json`
- Current workflow state：IMPLEMENTATION
- Active phase：phase-5
- Workspace reconciliation：Phase 1～4 修改未 commit，RECONCILED
- Blocking issue：無

## Implementation Boundary

`game-implementation-boundary`（Egret）：禁止匿名函式（宣告成變數指向 lambda）；建構子不做初始化，改 `init()` + `_inited`；「不可重寫已定義好的底層演算法」—— 只換寫法、不改計算。

## Allowed Changes

- `Core/Reel/Internal/BaseMovement.ts`、`Core/Reel/Internal/ReelStopFlow.ts`、`Core/Reel/Internal/ReelAxisEffect.ts`、`Core/Reel/Internal/ReelDataFlow.ts`、`Core/Reel/Internal/ReelIconManager.ts`、`Core/Reel/Data/ReelSymbolRegistry.ts`
- `Core/Reel/BaseReel.ts`、`Core/BaseSlotMachine.ts`
- `Drop/BaseDropReel.ts`、`Drop/BaseDropSlotMachine.ts`
- 上述檔案與 `Core/SlotMachine/Config/*.ts` 內提到舊回呼名稱的註解

## Forbidden Changes

- `Manager/**`（Phase 4 已完成）、`test/**`（Phase 6）、`tests/**`
- 任何計算、時序、發送順序

## 做法（與 plan 的差異另標）

| 項目 | 做法 |
|---|---|
| `BaseMovement` | 無建構子；`_value = 0`、`_inited`；`init(initialValue = 0)` 已 init 直接 return；新增 `cleanup()`（清指令、三個回呼、值歸 0、`_inited = false`）。**不在各方法加 `assertInitialized()`**：`ReelAxisEffect.reset()` 等可能在設定前被呼叫（例如未 `init()` 的單軸被 `cleanup()`），加了會把原本可行的順序變成 throw |
| `BaseMovement` 呼叫端 | `BaseReel.wireMovementAndReset()`、`ReelAxisEffect.configure()` 開頭 `init(0)`；`BaseDropReel.createGroupDrop()` `init(from)`；`BaseReel.cleanup()`、`ReelAxisEffect.cleanup()` 改呼叫 `movement.cleanup()` |
| `ReelStopFlow` | 無建構子；四個相依 `T \| null = null`，經 private getter 取用（null 時 throw）；`init(…)` 已 init 直接 return；`BaseReel` 在 `wireMovementAndReset()` 呼叫 |
| `ReelAxisEffect` 緩動表 | 每個緩動一個 `private static` 具名方法；`resolveEasing()` 改 `switch`（同時解掉 TS7017） |
| `ReelDataFlow.takeNextPerformanceSymbol()` | 判斷式參數 `accepts: (cellSpan) => boolean` 改成 `maxCellSpan: number`（`cellSpan <= maxCellSpan`）。原本兩種判斷式 `cellSpan === 1`、`cellSpan <= shortfall`；`cellSpan` 恆為正整數，`=== 1` ⇔ `<= 1`（plan 未列，屬「其餘匿名函式」） |
| `new Promise((resolve) => …)` | 具名 executor 欄位 |
| 陣列 `map`／`filter`／`find`／`every`／`some`／`forEach` | 一般 `for` 迴圈 |
| `sort` 比較函式、`Map.forEach` | 具名 static 方法／具名欄位（lib 無 iterable，Map 只能 `forEach`） |
| `.then(() => undefined)` | 改 `async` 寫法 |
| `BaseDropSlotMachine` 批次 | `PendingDropStart` 改存資料（`kind: DropBatchKind`、盤面／消除資料），由具名方法依 `kind` 呼叫單軸；`unknown[]` → `any[]` |
| `BaseDropSlotMachine` 到位轉發 | `void dropped.then(() => …)` 改成 `dropped.then(this._reelDropSettledHandler)`：handler 逐軸找「已開始、已不在掉、還沒轉發」的軸發 `REEL_DROP_COMPLETED`。時機與原本相同（單軸 Promise resolve 後的第一個 microtask，早於整批 Promise 的等待者） |

## Handoff Rules

- 只換寫法；迴圈的走訪順序、結果陣列的順序與原本相同
- CRLF 檔維持 CRLF（`BaseSlotMachine.ts`、`BaseReel.ts` 及 Core 其他 CRLF 檔），LF 檔維持 LF
- 若必須改名或改結構才能編譯，停下回報

## Verification

- 型別檢查：`TypeScript 2.4.2 - 0 error(s)`
- 搜尋：`=>`（Core、Drop）只剩具名欄位與型別宣告；`unknown|constructor\(`（事件類別除外）0 筆
- 打包成功
- 瀏覽器：一般／Turbo／L2 開轉、急停、切換停輪時間、切換軸數、切換聽牌，停輪時刻與順序與改寫前相同（改寫前的數值見 Phase 2、3 checkpoint）；另以 JS 驗證回彈緩動值與改寫前公式一致
