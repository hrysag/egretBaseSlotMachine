# 交接：流程層 BaseRoundManager 定案與骨架、機台補三個出口

> 期間：2026-09-28 ～ 09-29
> 起點：`4d02dd8`（掉落模組雛形，斷言 314）
> 終點：`c2765df`（已 push 到 origin/main，斷言 350 全過）＋ 未 commit：本文、`GameViewManager-Reference-Study.md` §10.4 待辦
> 前一份交接：[SESSION-2026-09-27-Rolling-Fixes.md](SESSION-2026-09-27-Rolling-Fixes.md)
> 對話紀錄匯出：[session-exports/2026-09-29-session-cccebe96.zip](session-exports/2026-09-29-session-cccebe96.zip)（本 session 完整對話，`transcript.jsonl`）
> 接續 session 匯出：[session-exports/2026-09-29-session-d17079ee.zip](session-exports/2026-09-29-session-d17079ee.zip)（2026-09-29 下半段：環節 3 逐軸事件定案與實作（主文件 §10.5，斷言 357，未 commit）；`Manager/` 四個檔被指出不符 Cocos／Core 寫法規範，逐行違規清單在該段對話末尾，**尚未修改**）
> **主文件：[GameViewManager-Reference-Study.md](GameViewManager-Reference-Study.md)**（參考專案事實 §1～§8、定案 §9 G1～G12、骨架 §10）
>
> **本文一律以「類別.成員」指路，不寫行號。**

---

## 0. 一句話

讀了 4 個參考專案的「流程層」，逐題定案 12 題，做出 `BaseRoundManager`（一局遊戲的 round 流程控制）骨架，
並先替機台補上 manager 需要的三個出口。斷言 314 → 350。

---

## 1. 下一個 session 從哪裡接

1. 讀本文，再讀 [GameViewManager-Reference-Study.md](GameViewManager-Reference-Study.md) §9（定案）、§10（骨架與待辦）
2. **第一件待辦：測試場景改用 manager 來跑**（§10.4），才能在瀏覽器確認流程

---

## 2. 讀過的參考專案

| 專案 | 路徑 | 類型 | 重點 |
|---|---|---|---|
| 1016 | `D:\Tools\project\Game1016\Web_Slot` | 滾輪 | Controller → `GameViewManager1016` → 機台三層；回合時間軸 |
| 1024 | `D:\Tools\project\Game1024` | 滾輪包掉落（混合） | 連消每一步拆成時間軸一格；消除資料是**遊戲層解析器算出來的**，不是伺服器直接給 |
| BIG_wings | `D:\Tools\project\BIG_wings` | 一般連線（非消除） | 一轉一則資料，FG 也一轉一則 |
| CandyParty2 | `G:\bbin\CandyParty2-master` | 純掉落消除 | 一轉內含每一步的完整盤面 + 每步消哪些格；消除迴圈寫在盤面元件內，外層插不進去 |

---

## 3. 定案摘要（白話；完整依據見主文件 §9）

| 題 | 定案 |
|---|---|
| 放哪、叫什麼 | `src/SlotMachine/Manager/`，類名 `BaseRoundManager`（原叫 BaseSlotGameViewManager，改名） |
| 滾輪／掉落 | manager 各留一個位置給滾輪機台與掉落機台，都可以不給 |
| 單位 | **以 round 為單位**，不做時間軸；伺服器怎麼送不管，一局內 round 接 round 由 manager 問遊戲「下一個 round」 |
| 消除資料 | 每次消除給「消哪些格」＋「補進來的新牌」；**框架只定資料樣式，遊戲層轉手** |
| 環節 | 五個：1 round 開始前、2 旋轉／消除前、3 旋轉／消除中、4 結束、5 round 結束；1 與 5 每 round 一次，2～4 初始盤面與每次消除各走一遍；做成可覆寫的 async 方法 |
| Stop | 滾輪在轉 → 急停；掉落中 → 直接到位；表演中 → 通知遊戲自己收尾 |
| 時間 | manager 本身不等任何時間、不提供 wait、不另計最少滾動時間 |
| 完全停下 | `stopSpin()` 不變，另補「停止效果播完」的等待入口 |
| UI／網路 | manager 不碰；對外兩條路：覆寫方法（會等）、通知回呼（不等，五環節各一次＋整局結束一次） |
| 自動旋轉 | 歸上層 Controller；manager 只管一局內的 round 流程 |
| await | 全程 await；`startGame()` 整局結束才 resolve，出錯往外丟 |
| 起轉 | **起轉 ≠ round 開始**：滾輪不等資料就先轉，掉落要等資料 → 一個基底、兩個子類別 |

---

## 4. 這期寫的程式（`c2765df`）

**機台補的三個出口**

| 入口 | 內容 |
|---|---|
| `BaseSlotMachine.waitForSettledAsync()` / `BaseReel.waitForSettledAsync()` | 停止效果（回彈）播完才結束；轉動中呼叫機台版會 throw |
| `BaseDropReel.quickStop()` / `BaseDropSlotMachine.quickStop()` | 掉落急停：直接到位（推翻 Drop Q6「不做掉落急停」） |
| `BaseDropSlotMachine.onReelDropStarted` / `onReelDropCompleted` | 掉落逐軸通知，不佔用單軸自己的回呼 |

**manager 骨架**（`src/SlotMachine/Manager/`）：`BaseRoundManager`、`RollRoundManager`、`DropRoundManager`、`Data/RoundData.ts`。
遊戲要做的：繼承其一、實作 `nextRound()`（滾輪另要 `getSpinMode()`）、覆寫需要的環節。名稱全部暫定。

**斷言**：§11x（完全停下）、§12e（掉落急停）、§12f（逐軸通知）、§13a～13d（manager）。每項都做過還原確認。
執行：`npx tsc --module commonjs --target es2017 --outDir temp/tests --skipLibCheck tests/CoreGeometry.test.ts libs/modules/egret/egret.d.ts libs/modules/eui/eui.d.ts` → `node temp/tests/tests/CoreGeometry.test.js`（約 80 秒）。
專案編譯檢查：`npx tsc --noEmit -p tsconfig.json`（目前 0 錯誤）。

---

## 5. 待辦

**manager（主文件 §10.4）**

1. 測試場景改用 manager 來跑
2. 環節 3 的逐軸事件怎麼轉給遊戲 → **已定案、已實作，斷言 357 全過，未 commit**（主文件 §10.5）：manager 接下機台逐軸回呼、轉成可覆寫方法，可回傳 Promise、環節 4 前等完；起轉照樣送，第一個 round 資料未到時以 -1 或 0 之類標示
3. 出錯後機台與畫面怎麼收拾
4. 切分頁再切回來的處理（使用者提過兩種：背景執行緒送時間強行驅動；切回來重新要資料）
5. 各入口／環節／回呼的正式名稱

**之前留下、這期沒動**

- 掉落 Q12 mask、Q13 每輪改格數（CandyParty2 依關卡改 4×4～6×6，屬同類需求）、Q14 wild 撐開、Q15 內嵌時每輪要掉的軸不同（Drop-Module-Readiness §7.6）
- 掉落雛形不支援被畫面邊緣截斷的大圖
- 普通模式急停「第一個要停的軸還沒開始滾」的反轉（Rolling-Fixes §3.2）
- 即停、停軸後重排零斷言；第一軸就聽牌未驗（SESSION-2026-09-23 §9）
- 小修：主線 §6「有急停時的停止順序反轉」仍寫修法待定（實際已定案實作）；Drop-Module-Readiness §7 開頭進度仍寫「下一題 Q11」

---

## 6. 工作方法（本期學到的，已存記憶）

| 教訓 | 經過 |
|---|---|
| **講重點，不要廢話** | 回報多了表格與段落，被說「廢話太多」。一題一個重點、給建議，細節進 md |
| **讀參考專案只報事實，不擅自下結論** | 從欄位註解推「BIG_wings 一轉多組盤面」、從 1024 推「伺服器直接給消除資料」，都錯。要標明查到哪、哪些沒追 |
| **框架只定資料樣式** | 伺服器怎麼送（一次送完、分段送、只給盤面）不是框架的事，遊戲層轉手 |
| **起轉與 round 開始是兩回事** | 我把起轉綁進 round，使用者指出滾輪不等資料就能轉、掉落要等資料 |
| **使用者定義的結構照用** | 五個環節是使用者直接給的分法 |
| 每題定案才寫 md；使用者說「寫進 md」才寫 | 定案前先確認理解，不自己延伸機制 |

---

## 7. 環境

- 本期 auto mode 的安全檢查服務一度無回應（`classifier gave no verdict`），寫檔與指令全被擋；使用者切換權限模式後恢復。不是使用者設定問題
- 換行：工作區內 `tests/CoreGeometry.test.ts`、`BaseSlotMachine.ts`、`BaseReel.ts` 是 CRLF；`Drop/`、`Manager/` 與新建的 md 是 LF；git 會轉換。改檔維持該檔原本那一種
