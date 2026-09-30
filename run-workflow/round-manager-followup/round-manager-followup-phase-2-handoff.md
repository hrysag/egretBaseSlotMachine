# Phase Execution Handoff：Phase 2 自訂事件與機台介面

## Required Superpower

`superpowers:executing-plans`（inline 執行，同 Phase 1）

## Phase

- Name：Phase 2 自訂事件與機台介面（plan Task 2）
- Goal：跨模組的回呼屬性改成 `egret.Event` 子類別的自訂事件；新增兩個機台介面。發送位置、順序與原本回呼相同
- Mode：FAST
- Source plan：`run-workflow/round-manager-followup/round-manager-followup-plan.md` Task 2
- Spec：§5（自訂事件）、§8.1（介面）
- Approved skeleton report：無（FAST）

## Runtime Gate

- Runtime state：`run-workflow/workflow-state.json`
- Current workflow state：IMPLEMENTATION
- Active phase：phase-2
- Workspace reconciliation：Phase 1 的修改尚未 commit（使用者選擇直接進 Phase 2），屬本輪起點，RECONCILED
- Blocking issue：無

## Implementation Boundary

`game-implementation-boundary`（Egret）：`typescript.md`、`project-rules.md`（2026-10-01 重讀）。重點：只用 namespace；TS 2.4.2；事件監聽需同一函式參考才能移除；禁止跨類別 callback（使用者裁定：跨模組禁止）。

## Allowed Changes

- Create：`Core/Event/SlotMachineEvent.ts`、`Core/Event/ReelEvent.ts`、`Core/ISlotMachine.ts`、`Drop/Event/DropEvent.ts`、`Drop/IDropSlotMachine.ts`、`Manager/Event/RoundEvent.ts`（皆在 `src/SlotMachine/` 下，LF）
- Modify：`Core/BaseSlotMachine.ts`、`Core/Reel/BaseReel.ts`、`Drop/BaseDropSlotMachine.ts`、`Drop/BaseDropReel.ts`、`Manager/BaseRoundManager.ts`、`Manager/DropRoundManager.ts`、`test/SlotMachineScene.ts`
- 上述檔案內提到已移除回呼屬性的註解，同步改成事件名稱

## Forbidden Changes

- `BaseMovement` 的同模組回呼（`onValueChanged` 等）、`TestSlotMachine.onUpdate`：保留（spec §5.3）
- `BaseDropReel` 的 `onValueChanged` 改寫、icon、manager 的 `init()`／介面注入／去泛型、其他匿名函式：分屬 Task 3～6，本階段不動
- `tests/**`、`scripts/**`、`tsconfig.json`

## Public API Notes

- 移除的回呼屬性（經使用者同意的 API 變更）：
  - `BaseSlotMachine`：`onReelStarted`、`onAllReelsStarted`、`onReelStopped`、`onAllReelsStopped`、`onListenStart`、`onListenEnd`
  - `BaseReel`：`onHalfCellComplete`、`onCellMovementComplete`、`onRollStarted`、`onRollStopped`、`onStopEffectStarted`、`onStopEffectCompleted`、`onStartEffectCompleted`、`onReelDataChanged`
  - `BaseDropSlotMachine`：`onReelDropStarted`、`onReelDropCompleted`；`BaseDropReel`：`onDropStarted`、`onDropCompleted`
  - `BaseRoundManager`：`onStageEnter`、`onGameEnd`
- 新增：`BaseSlotMachine implements ISlotMachine`、`BaseDropSlotMachine implements IDropSlotMachine`、`BaseDropSlotMachine.allReelsDroppedOut`、`BaseRoundManager extends egret.EventDispatcher`
- manager 的建構子收機台維持到 Task 4；本階段 manager 尚無 `cleanup()`，事件監聽的解除在 Task 4 補

## Handoff Rules

- 發送：每個發送類別一個私有發送方法，先 `hasEventListener(type)`，沒人聽就不 `new`
- 原本 `if (this.onXxx !== undefined) { this.onXxx(…); }` 就地換成發送方法，**位置不動**；原本外圍的 `try/finally` 保留
- 接收：具名方法或具名欄位；`addEventListener(type, listener, this)` 與 `removeEventListener` 參數相同
- 若必須改名或改結構才能編譯，停下回報

## Verification

- TypeScript compile：`node run-workflow/round-manager-followup/check-ts242.js` → 只剩基準 8 個
- 搜尋：`\.on[A-Z]\w*\s*=[^=]`（Drop、Manager、test）只剩 `onUpdate`；`public on\w+\?:`（SlotMachine）只剩 `BaseMovement` 三個
- 打包：`egret build` 成功；`manifest.json` 被改就還原
- 瀏覽器：一般／Turbo 開轉、急停、切換聽牌各一次；起轉／停輪／聽牌標記照常；切換軸數（重建機台）後標記仍正常（確認舊機台監聽已移除、新機台已掛上）
- Cleanup checks：場景重建機台前移除舊機台與舊軸的監聽
