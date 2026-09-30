# Review：整輪改動（code review, high）

> 日期：2026-10-01
> 範圍：本輪全部未 commit 的改動（`src/SlotMachine/**`、`src/test/**`、`src/Main.ts`）
> 結果：8 項，修 5 項、不需修 1 項、延後 2 項

## 各項與處理

| # | 項目 | 處理 |
|---|---|---|
| 1 | `BaseRoundManager.requestStop()` 未 `init()`／`cleanup()` 後會 throw（原本沒在跑一局就不做事） | **已修**：未 init 或沒在跑一局都直接 return；`startGame()` 未 init 仍 throw |
| 2 | 第一個 `nextRound()` 回 `null` 時滾輪還在轉 | **不需修**（使用者確認）：伺服器資料沒到時 `nextRound()` 是在等，不會回 null。真正的情況是伺服器出錯 → `nextRound()` 丟錯 → 滾輪還在轉，屬於既有待辦「出錯後機台與畫面怎麼收拾」（主文件 §10.4） |
| 3 | `tests/CoreGeometry.test.ts`（357 項斷言）還是舊 API，編譯不過 | **延後到 Phase 7**：使用者確認重要、要重寫 |
| 4 | manager 的機台欄位改成可寫的 protected，子類別換掉機台會讓 `cleanup()` 移錯監聽 | **已修**：改成 private `_rollMachine`／`_dropMachine`，只在 `init()`／`cleanup()` 改；子類別照舊用 `requireRollMachine()`／`requireDropMachine()` |
| 5 | 測試場景 `cleanup()` 不歸零本輪狀態，清理後加回舞台不會自動 `init()` | **已修**：`cleanup()` 回到剛建構的狀態 —— 新增 `resetRunState()`（模擬 Server、急停、各軸時刻歸零，保留使用者選的設定），並重新掛上一次性的 `ADDED_TO_STAGE` 監聽 |
| 6 | 每格發的事件每次新建事件物件（沒用事件池） | **改由 spec §13 處理**（2026-10-01 討論定案：單軸不再對外發事件，這項隨之消失；未實作）。原評估：目前只有測試場景聽每格事件（一般約 60 次／秒、L2 約 300 次／秒）；遊戲換圖走空殼自己的 hook，不聽這類事件。等遊戲真的需要時再改 `egret.Event.create()`／`release()` |
| 7 | `ReelStopFlow` 四個 getter 重複同一段檢查 | **已修**：四個相依收進一個 `ReelStopFlowDependencies` 物件，只留一個 getter |
| 8 | 掉落機台批次項目帶三個可為 null 的欄位，`startReelDrop()` 的 null 檢查永遠不會觸發 | **已修**：這批的種類與逐軸資料改存在機台上，由 `run()` 在「上一批還在跑」的檢查**之後**才寫入（避免被拒絕的新指令蓋掉正在跑的那批），這批結束、出錯或 cleanup 時清空；`PendingDropStart` 回到 `{ reelIndex, startAt }` |

## 修正後驗證

- TypeScript 2.4.2：0 error(s)；打包成功
- 改寫前基準逐行比對：85 行仍完全相同
- #1：未 init、cleanup 後呼叫 `requestStop()` 都不 throw；未 init 呼叫 `startGame()` 仍 throw
- #8：掉落一局（掉出 → 掉入 → 消除）事件與盤面同 Phase 5（`[9,4,6]`、`[4,5,6]`、`[7,8,5]`）；掉出途中再下 `dropIn` → throw，原本那批照自己的資料跑完，下一次 `dropIn` 盤面正確，批次資料已清空
- #5：轉動中（等伺服器）`cleanup()` 後狀態全部歸零、子物件 0、一次性監聽重新掛上；移出再加回舞台 → 自動 `init()`，開轉正常
- console 無錯誤
