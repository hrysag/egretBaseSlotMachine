# Phase Execution Handoff：Phase 1 namespace 化

## Required Superpower

`superpowers:executing-plans`（使用者選 Native，inline 執行）

## Phase

- Name：Phase 1 namespace 化（plan Task 1）
- Goal：範圍內全部檔案改成 `namespace slot_core／slot_drop／slot_manager／slot_test`（原訂 `slot.core` 等，打包工具不支援帶點寫法，使用者改定底線，見 spec §4），移除 `import`／`export` 陳述式，行為不變
- Mode：FAST
- Source plan：`run-workflow/round-manager-followup/round-manager-followup-plan.md` Task 1
- Approved skeleton report：無（FAST，spec §10 為輕量骨架）

## Runtime Gate

- Runtime state：`run-workflow/workflow-state.json`
- Current workflow state：IMPLEMENTATION
- Active phase：phase-1
- Workspace reconciliation：開工前工作區已有上一期未 commit 的修改（`doc/GameViewManager-Reference-Study.md`、`Manager/BaseRoundManager.ts`、`Manager/Data/RoundData.ts`、`tests/CoreGeometry.test.ts`、兩個未追蹤 md／zip），屬本輪起點，RECONCILED
- Blocking issue：無

## Implementation Boundary

`game-implementation-boundary`（Egret）：`engines/egret/typescript.md` Module Style、`project-rules.md` Typescript 規範。

## Allowed Changes

- `src/SlotMachine/**/*.ts`
- `src/test/*.ts`
- `src/Main.ts`：只改 `import { SlotMachineScene } …` 那一行與 `new SlotMachineScene()`

## Forbidden Changes

- `AssetAdapter.ts`、`LoadingUI.ts`、`Platform.ts`、`ThemeAdapter.ts`、`EgretToolchainShim.d.ts`、`Main.ts` 其他內容
- `tests/**`、`scripts/**`、`tsconfig.json`、`egretProperties.json`
- 任何邏輯改動（本階段只換模組寫法）

## Handoff Rules

- 類別名稱、方法名稱、流程不變
- 只換外殼：刪 `import`、包 namespace、跨模組改完整名稱、刪 `BaseReel.ts` 轉匯出
- 若必須改名或改結構才能編譯，停下回報

## Verification

- TypeScript compile：`node run-workflow/round-manager-followup/check-ts242.js` → 只剩基準 8 個錯誤
- Tests：無（本輪略過 tests/）
- Manual runtime checks：`egret build` 成功；瀏覽器開測試場景、一般模式轉一次、console 無錯誤
- Cleanup checks：不適用（本階段不新增監聽／Promise）
