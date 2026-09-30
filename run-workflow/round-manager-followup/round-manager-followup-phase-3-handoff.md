# Phase Execution Handoff：Phase 3 Icon 與 `BaseDropReel` 主動讀值

## Required Superpower

`superpowers:executing-plans`（inline 執行）

## Phase

- Name：Phase 3 Icon 與 `BaseDropReel` 主動讀值（plan Task 3）
- Goal：空殼改由 `iconClass`／`iconSkinName` 兩個字串欄位建立，取代 `iconFactory`；`BaseDropReel` 不再掛 `BaseMovement.onValueChanged`，每幀自己讀值
- Mode：FAST
- Source plan：`run-workflow/round-manager-followup/round-manager-followup-plan.md` Task 3
- Spec：§6、§7

## Runtime Gate

- Runtime state：`run-workflow/workflow-state.json`
- Current workflow state：IMPLEMENTATION
- Active phase：phase-3
- Workspace reconciliation：Phase 1、2 修改未 commit（使用者直接進 Phase 3），RECONCILED
- Blocking issue：無

## Implementation Boundary

`game-implementation-boundary`（Egret）。重點：`egret.getDefinitionByName()` 依全域名稱找類別（namespace 已由打包工具掛上 `window`）；不用匿名函式；刪除前先查相依。

## Allowed Changes

- `Core/Reel/Config/ReelConfig.ts`：`ReelIconDisplayConfig` 改兩個選填字串欄位；刪除 `ReelIconFactory`（相依只有本表列出的檔案）
- `Core/Reel/Internal/ReelIconManager.ts`：`initializeIcons()`
- `Core/Reel/BaseReelIcon.ts`：`setupCell()`、兩個唯讀 getter
- `Core/Reel/BaseReel.ts`、`Drop/BaseDropReel.ts`：兩個公開欄位、`configureIconDisplay()`
- `Drop/BaseDropReel.ts`：`createGroupDrop()`、`update()`、`completeDrop()`、`cleanup()`（spec §6）
- `test/TestReelIcon.ts`、`test/TestSlotMachine.ts`

## Forbidden Changes

- `BaseMovement` 本身、`BaseReel`／`ReelAxisEffect` 對 `BaseMovement` 的同模組回呼
- 其他匿名函式、建構子 → `init()`（Task 5、6）
- `tests/**`、`scripts/**`、`resource/**`

## Public API Notes

- `ReelIconDisplayConfig`：`iconFactory` → `iconClass?: string`、`iconSkinName?: string`；`ReelIconFactory` 移除
- `BaseReel`、`BaseDropReel` 新增 `public iconClass: string = ""`、`public iconSkinName: string = ""`（可在 exml 填）；`configureIconDisplay(config)` 有給的欄位先寫入，再以兩個欄位建立空殼
- `BaseReelIcon.setupCell(cellPitch, exitTowardPositiveAxis, vertical)`；新增唯讀 getter `exitTowardPositiveAxis`、`vertical`；`onCellSetup(cellPitch)` 簽章不變
- **與 plan 的差異**：plan 寫 `initializeIcons(container, iconClass, iconSkinName, exitTowardPositiveAxis, vertical)`。`ReelIconManager` 本身就是方向的唯一來源（`exitTowardPositiveAxis`、`layoutType` 都在它身上），改成 `initializeIcons(container, iconClass, iconSkinName)`，由它自己把方向交給 `setupCell()`，不從外面多傳一份
- `TestReelIcon`：無建構子參數；`TestSlotMachine.createIcon()` 移除

## Handoff Rules

- `iconClass` 為空字串 → `slot_core.BaseReelIcon`；找不到、或不是 `BaseReelIcon` 本身／子類別 → throw，訊息含 `iconClass`；**在清掉舊空殼之前**檢查，失敗不動現有空殼
- `iconSkinName` 非空才設定 `skinName`
- `BaseDropReel.update()`：每組 `movement.update(deltaTime)` 後把 `movement.value` 寫進該組每一格的 `cellOffset`，全部組推完再 `syncAllIcons()`，順序不變
- 若必須改名或改結構才能編譯，停下回報

## Verification

- 型別檢查 → 只剩基準 8 個
- 搜尋：`iconFactory|ReelIconFactory|onValueChanged`（Drop、test）0 筆；`iconFactory|ReelIconFactory`（src）0 筆
- 打包（`EGRET_PATH`）成功
- 瀏覽器：切換方向（垂直正／反、水平正／反）各轉一次，大圖延伸方向與改寫前相同；暫時把 `iconClass` 改成 `"slot_test.NotExist"` 重新打包，確認 throw 訊息含該名稱，再改回
- 掉落：沒有場景在用，只能型別檢查（checkpoint 註明）
