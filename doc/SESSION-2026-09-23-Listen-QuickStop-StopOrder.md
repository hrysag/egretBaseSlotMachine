# 交接：聽牌、急停依序停、停止順序、量化誤差歸零、資料到達時推算停輪

> 期間：2026-09-23 ～ 09-26
> 起點 commit：`ad47b91`（分支 `feat/machine-display-and-multireel`）
> 終點：**全部未 commit**（工作區，斷言 281 項全過）
> 前一份交接：[SESSION-2026-09-17-Machine-Display-And-MultiReel.md](SESSION-2026-09-17-Machine-Display-And-MultiReel.md)
> 對話紀錄匯出：[session-exports/2026-09-26-session-916f6714.zip](session-exports/2026-09-26-session-916f6714.zip)（09-26 這個 session 的完整對話，含 `transcript.jsonl`）
>
> **本文一律以「類別.成員」指路，不寫行號。** 各決議的完整依據與驗算數據在主線 doc
> [Slot-Base-Unit-Refactor-1x1.md](Slot-Base-Unit-Refactor-1x1.md) §3.7／§3.8。

---

## 0. 一句話

決議 41～48 落地，修掉 **8 個缺陷**（其中 2 個是上一個 commit 就存在、牌庫含大圖才掃得出來的急停缺陷），
斷言 **175 → 281**。停輪規劃的根本改變：**資料到達時才沿停止順序推算每軸停輪**（決議 47），伺服器晚到時
軸間隔與順序照樣保留 —— Cocos 完成版與本期之前的 Egret 版都會亂。

---

## 1. 工作方法（沿用前一份，加上本期學到的）

前一份的四條照舊：讀原始碼再下結論、先大量驗算再改、改完還原一次確認會紅、看誤差是否隨參數放大。本期新增：

| 教訓 | 發生經過 |
|---|---|
| **參考專案沒用到 ≠ 該刪** | 我以 1016 沒有聽牌加速為由提議刪 `speedMultiplier`，被糾正：1016 只是一個遊戲的需求。刪除要有「分層／歸屬」的理由 |
| **情境要符合實際操作** | 我拿「資料到之前就急停」測停輪順序，但 1016 的急停一定等資料到才生效（`_interruptFlag`） |
| **還原測試要真的測得到** | §11p「切速前急停」按太早、§11s 啟動效果那條效果時長剛好是幀長整數倍 —— 兩次都是還原不會紅，改條件後才有效 |
| **量測基準要和框架一致** | 框架以 `elapsedRollTime` 計時（每幀開頭就吃掉整幀），格邊界在幀中間；推算停輪先後要用連續時間 |
| **有前提的斷言要先驗前提** | §11l「同幀停下」先斷言五軸真的同幀 |
| **推測先掛紀錄再下結論** | 「未啟動的軸沒補到」是推測，掛紀錄後發現是舊預算殘留 |
| **盤面要檢查 group 完整性，不能只比 id** | 急停砍格留下半組大 Symbol 的缺陷，錯位盤面 id 仍是 `[1,73,73]`，只比 id 的驗算全部判定正確。我的驗算因此漏了好幾天，是使用者在瀏覽器截圖才發現 |
| **牌庫要含大 Symbol** | 之前的驗算牌庫多半只有 1×1，碰不到「表演牌大圖被砍半」 |
| **不要自己改參數去湊效果** | 我為了讓聽牌看得出來，自己改每格速度、提議拉長停輪時間，都被否決為「自作主張」。框架行為不符預期時，當成框架問題提出（→ 決議 46、47） |
| **先查原版再下結論** | 「伺服器晚到時順序亂」先查了 Cocos（一樣亂）與 1016（用相對格數，不會亂），才找到根源 |

使用者偏好：**一件一件來**；**先寫進 md 再實作**（但使用者說「不用寫 md 直接改」時就直接改）；問題先「描述狀況」再談修法；
驗算數字給他看過再定論；**回覆用中文、講簡單**；測試場景要拉長滾動只能**延後模擬伺服器**，不能改停輪時間或速度。

---

## 2. 決議（主線 doc §0 表格已同步）

| # | 內容 | 狀態 |
|---|---|---|
| 41 | 自動旋轉移出框架（`autoSpin` / `stopAutoSpin` 刪除） | 已實作 |
| 42 | 聽牌時間在**規劃時**算定（含 `speedMultiplier` 換算與切速邊界）；`fastMode`／急停不排聽牌時間；聽牌軸**一律成對**發回調；聽牌途中急停**依照當下速度**；`speedMultiplier >= 1` | 已實作 |
| 43 | 普通模式急停補「剛好足以依序停止」的表演格 | 已實作 |
| 44 | 啟動順序與停止順序分開設定：`SlotMachineSpinConfig.stopTimings` | 已實作 |
| 45 | 停輪量化誤差壓到 0：每格自我修正（只拉長、ε = +25%）、連續時間、實際原點；附帶 `BaseMovement.TIME_EPSILON` | 已實作 |
| 46 | 聽牌從前一軸**實際**停下起算（Cocos 原版註解的本意；決議 42 誤用規劃停輪，伺服器晚到時聽牌只剩 0.017 秒） | 規則已實作；最初的「延後提交」做法被 47 取代 |
| 47 | **資料到達時沿停止順序直接推算每軸停輪**：普通軸 = max(規劃, 前一軸停輪 + 軸間距, 本軸最早能停)、聽牌軸 = max(前一軸停輪 + duration, 本軸最早能停)；連帶修正啟動效果播完那一幀時間被用兩次 | 已實作 |
| 48 | **Turbo（`fastMode`）停止間隔為 0**：`stopDelaySeconds` 當 0、只保留順序，與 Cocos 移植版相同；寫進 `SlotMachineSpinConfig` 說明 | 已實作 |

---

## 3. 修掉的缺陷

| # | 缺陷 | 成因 | 修法 | 斷言 |
|---|---|---|---|---|
| 1 | 聽牌 `speedMultiplier` 把 `duration` 一起除掉 | 結果已提交後才改目標（無效）與速度（生效） | `BaseReel.planListenSpeedUp()` 規劃時排切速 | §11p |
| 2 | `fastMode` 下仍排聽牌時間，Turbo 同步失效 | 規劃不看 `fastMode` | `planListen` 旗標 | §11p |
| 3 | 聽牌回調漏發 | 聽牌軸同幀已停就 `return` | 已停仍依序發 | §11o |
| 4 | 普通模式急停＋錯開啟動 → 停輪順序亂 | 砍完表演格後各軸相位不同 | `prepareOrderedQuickStopPadding()` | §11k |
| 5 | 自訂停止順序時同幀回調照軸號發 | `update()` 照 `_runtimeReels` 走訪 | `_updateOrder` | §11l |
| 6 | 急停在等待後面軸啟動期間 → 停輪反轉 | 第二次沒碰的軸留著舊預算 | 能補的軸一律寫（0 也寫） | §11l |
| 7 | **結果先到後急停：砍表演格留下半組大 Symbol，結果被接進去**（截圖：第 4 軸只剩一格） | `applyQuickStopDataSkip()` 沒拆進場端殘組（決議 30 只在提交時拆） | 急停砍到格子時也 `dissolveIncompleteEntryGroup()` | §11t |
| 8 | **Turbo 急停同步補牌插進結果中間，那一軸永遠停不下來**（5 軸只停 4 軸） | `insertPerformanceCellsBeforeResult()` 假設結果未進場；Turbo 同步沒檢查 `canApplyQuickStopPadding` | 補牌函式擋住；Turbo 只對能補的軸同步 | §11u |

另外兩個實作時抓到、屬於新機制本身的問題：停輪時刻落在幀邊界時被浮點雜訊拆到兩幀（→ `BaseMovement.TIME_EPSILON`，決議 45）；
啟動效果播完那一幀時間被用兩次（→ `BaseReel.updateMovement()`，決議 47）。

缺陷 7、8 **上一個 commit 就存在**（`ad47b91` 的程式在同樣的掃描下壞 152 組），不是本期改出來的。

---

## 4. 查參考專案得到的事實

**1016**（`D:\Tools\project\Game1016\Web_Slot`）：

- **停輪是相對的**：`UniReelView1016.calculateRandomDataLength()` 在資料到達時對每軸塞
  `ceil((第幾個停 × staggerStop + 聽牌時間) ÷ moveInterval)` 格假資料，不看現在幾秒 → 伺服器再晚，間隔與順序都保留
- `UniSlotMachine1016.canStopRoll()` 的最短滾動時間（`totalRoll`）**整段註解掉**，只等資料
- `staggerRoll` 三個速度等級都是 0；`staggerStop` regular 0.2、Lv1／Lv2 為 0
- **聽牌**：時間在提交時換算假資料格數，速度從不改變；Lv1／Lv2 聽牌表演與時間都不啟動
- **停止按鈕**從開轉就啟用，但資料未到時只記 `_interruptFlag`，資料到才執行

**Cocos 完成版**（`D:\cocosTest\NewSlotMachine\SlotFrameWork\SlotMachine`）：

- 停輪 = 各軸 `startDelay 累加 + targetStopSeconds`，開轉時就定；伺服器晚到時各自鉗到 earliest，**順序會亂**（48 組中 45 組）
- 聽牌 `runOneListenReel()` 註解寫「duration 從 Callback 發生的這一刻起算……前一軸的實際停止誤差不會吃掉聽牌時間」→ 決議 46 的依據
- 沒有 `stopTimings`；`fastMode` 全軸 0 秒啟動 → Turbo 同時停 → 決議 48 的依據
- 測試機台 `resultCommitDelay`：腳本預設 1、場景存檔 0.05；多軸場景存檔每格 0.08、停輪 0.15；腳本預設聽牌第 2 軸（`listenReelIndex = 1`）1.5 秒 × 1.5

---

## 5. 斷言：175 → 281

```
§11e  config 停輪早於物理下限：從最早能停起算，間隔與順序保留（決議 47 改寫）
§11k  普通模式急停依序停（決議 43）                        11
§11l  自訂停止順序右到左、同幀回調、舊預算                  10
§11m  stopTimings：同時啟動右到左、急停、鎖軸               12
§11n  stopTimings 守門                                      4
§11p  聽牌時間、fastMode、急停速度、setListenReels         17
§11o  聽牌回調成對發出                                     12
§11q  量化誤差壓到 0：同時停、錯開 0.13、                    11
      啟動效果中規劃聽牌、低幀率（決議 45）
§11r  聽牌從前一軸實際停下起算：伺服器晚到、                13
      連續聽牌、結果送出後馬上急停（決議 46）
§11s  伺服器晚到照 config 間隔與順序停、                     8
      資料在啟動效果中送到（決議 47）
§11t  結果先到後急停：可視段每格都找得到 head（缺陷 7）       3
§11u  Turbo 結果先到後急停：五軸都停、盤面正確（缺陷 8）       2
§11v  Turbo 忽略 stopDelaySeconds：全軸同一幀停（決議 48）    2
```

合計 **281 項**。每個修正都做過「單獨還原 → 對應項紅」。
執行方式：`npx tsc --module commonjs --target es2017 --outDir temp/tests --skipLibCheck tests/CoreGeometry.test.ts libs/modules/egret/egret.d.ts libs/modules/eui/eui.d.ts` → `node temp/tests/tests/CoreGeometry.test.js`。

---

## 6. 決議 45～48 的要點（完整內容見主線 §3.7／§3.8）

**決議 45**：每格邊界 `本格時間 = clamp((目標 − 現在) / 剩餘格數, 原速, 原速 × 1.25)`；聽牌分段；急停後不修正；
「現在」用連續時間（`BaseReel._cellStartTime` / `_cellDuration`）；實際原點（`BaseSlotMachine._originByReel`）。
使用者決定：接受「畫面上最多晚一幀」、一起做實際原點、ε = +25%。

**決議 47**（取代 46 的延後提交）：`BaseSlotMachine.createCurrentStopTimings()` 在 `stopSpin()` 當下沿停止順序推算，
最早能停由 `BaseReel.projectEarliestStopTime(result)` 給。延後提交（等前一軸提交）已移除：它讓同時停的軸一格一格往後拖，最多晚 0.32 秒。

**決議 48**：`BaseSlotMachine.createBaseStopTimes()` 在 `fastMode` 時把 `stopDelaySeconds` 當 0。
不這樣做時，各軸目標不同 → 修正拉長量不同 → 格邊界錯開半格 → Turbo 急停會有軸晚半格停。

**驗算總表**（框架實作本身）：

| 驗算 | 組數 | 結果 |
|---|---:|---|
| 混合（含啟動效果、第 2 軸聽牌、右到左停止順序、伺服器早到／晚到） | 6,912 | 反轉 0、盤面錯 0、停得到的誤差 ±2e-14 |
| 聽牌／fastMode／急停依序／聽牌途中急停 | 2,196 | 全部 0 |
| 聽牌伺服器晚到／早到、結果送出後馬上急停 | 1,344 | 聽牌長誤差 ±2e-14、反轉 0 |
| 測試場景設定 × 急停時刻 × 幀長（嚴格盤面判斷） | 4,464 | 0 |
| 牌庫含大圖 × Turbo／普通 × 停止順序 × 急停（嚴格） | 4,608 | 逾時 0、盤面錯 0、半格警告 0 |

---

## 7. 驗算腳本

本期後半的腳本在 scratchpad `916f6714-…/scratchpad`，**session 結束會消失**：

| 檔 | 用途 |
|---|---|
| `harness.js` | 共用 harness：`require` `temp/tests/` 的編譯輸出（先載 `EgretStub.js`），機台與 `HeadlessSlotMachine` 同形；每幀 `await setImmediate`。連續停輪時刻 = `_originByReel[i] + reel._cellStartTime` |
| `strictBoard.js` | 讓 `getVisibleCellSymbolIds()` 在可視段有格子找不到 head 時回傳 `["GROUP_BROKEN"]` —— 套上後各腳本的「盤面錯」就包含 group 錯位 |
| `sceneLike.js` / `sceneSweep.js` | 照測試場景設定（ids 1～10、62、73；啟動／停止效果；牌庫含大圖）掃急停時刻 × 幀長 × 伺服器延遲，內建 group 完整性檢查 |
| `bigBank2.js` | 牌庫含大圖 × Turbo／普通 × 停止順序 × 急停，分類統計逾時、盤面錯、半格警告；可加 `noProj` / `noEffectFix` / `noCorr` 參數拿掉個別修正 |
| `project.js` / `framework_now.js` | 決議 47 前後對照（現況／等前一軸／直接推算）6,912 組 |
| `late_cocos.js` | 伺服器晚到時 Cocos 完成版 vs Egret 的停輪順序（用上一期的 `cocos/` 替身） |
| `d46.js` / `sweep45b.js` | 聽牌伺服器晚到、決議 45 的聽牌／fastMode／急停驗算 |
| `head/` | 用 `git archive HEAD` 抽出上一個 commit 的原始碼編譯，拿來確認缺陷是否既有 |

**重建要點**：

- 編譯：專案目錄 `npx tsc ...`（見 §5）；舊版原始碼可 `git archive HEAD src/SlotMachine tests | tar -x -C <dir>` 後用 `--rootDir` 編（少引擎 d.ts 會報型別錯但照樣產出 JS）
- 框架內部欄位在 JS 下可直接存取；monkeypatch 私有方法時要**原樣轉傳參數**
- 「還原測試」直接改編譯出來的 JS，跑完還原 —— 原始碼不動
- **盤面判斷一律套 `strictBoard.js`**，牌庫要含 1×2／1×3

---

## 8. 環境與工具鏈的坑

- **沒有 Python**：多行替換用 `node -e` 或 Edit 工具
- `tsc` 要在**專案目錄**用 `npx tsc`
- Bash 雙引號裡的反引號會被當成指令替換；**`$'\r'` 放進雙引號裡的 `$(...)` 會讓 Bash 解析失敗**
- **換行符逐檔不同**（repo 一律存 LF，git 轉換）：`tests/CoreGeometry.test.ts`、`src/test/TestSlotMachine.ts`、`SlotMachineSpinConfig.ts` 工作區是 CRLF；
  `src/SlotMachine/Core/` 其餘各檔、`src/test/SlotMachineScene.ts`、`doc/` 是 LF。每個檔內部一致，改完維持原本那一種
- **在這個環境 `grep -c $'\r'` 不可信**（`$'\r'` 變空字串，每行都算符合）。用 `node -e` 數 `/\r\n/g` 與 `/\n/g`
- `node -e` 裡直接寫中文 anchor 有時比對不到（編碼），改用 Edit 工具或把內容寫成檔案再讀
- harness 每幀 `await` 用 `setImmediate`，不要用 `setTimeout(0)`
- `egret build` 前後比對 `manifest.json` 雜湊，有變就還原（它會改寫換行）
- Browser pane 隱藏時 rAF 停擺：用 `setInterval(() => egret.ticker.update(), 16)` 手動推進；截圖前先停掉並 `egret.ticker.update(true)`

---

## 9. 還沒做的（依建議順序）

1. **測試場景**（`src/test/SlotMachineScene.ts`）現況：預設 5 軸（可切 1／3／5；`_board` 依方向等比縮小，垂直 0.745、水平 0.601；
   狀態列 13 號字、行距 3）；普通每格 0.08、停輪時間 0.15／1.6（Cocos 場景存檔）；**模擬伺服器預設 0.05 秒**（Cocos 場景存檔，
   可切 0.3／1／3，測急停切到 3）；聽牌 = 第 2 軸（R1）1.5 秒 × 1.5（Cocos 腳本預設，可切「無」）；聽牌軸黃框、狀態列印聽牌開始／結束與各軸 `mi`
2. **即停**（`immediateStop()`）—— 仍零斷言；順序不保證、未啟動軸留在 idle
3. **停軸後重排**（`reconfigureStoppedLayout()`）—— 零斷言；停止效果播放中沒有守衛
4. **機台層缺「完全停」的出口** —— 形狀未定（主線 §3.8）
5. **第一軸就聽牌** —— 沒有前一軸，目前取 `max(規劃, duration)`，未驗
6. `lastStopPlan.actualStopTime` 是預測值：急停發生在修正途中時，已拉長的格子不會扣回（僅供除錯）
7. `getGroupRuntimes()`、決議 39／40、Drop

### 9.1 之後的工作另記

- 滾動的修正（浮點收尾、空殼跟著轉、Turbo 急停反轉）→ [SESSION-2026-09-27-Rolling-Fixes.md](SESSION-2026-09-27-Rolling-Fixes.md)
- 掉落模組的整理（Q1～Q4 已定案）→ [Drop-Module-Readiness.md](Drop-Module-Readiness.md) §7

**Git**：本期所有改動都未 commit（決議 41～48、8 個缺陷修正、斷言 281 項、測試場景、doc）。尚未 commit／push／開 PR。
