# 交接：機台顯示物件化、多軸斷言、四個停輪時間的 bug

> 期間：2026-09-15 ～ 09-17
> 起點 commit：`917c887`（移植完成度盤點）
> 終點 commit：`e7a6228`（分支 `feat/machine-display-and-multireel`，尚未併回 main）
> 中間 commit：`12d058c`（Icon 查詢族與方向出口，**已推上 main**）
>
> **本文一律以「類別.成員」指路，不寫行號。**

---

## 0. 一句話

四個缺口全部結清、決議 34～40 落地、斷言 **77 → 175**；過程中抓到**四個從沒被執行過的 bug**，三個修好了，第四個（聽牌的 `speedMultiplier`）**只確認未修**。

---

## 1. 這段期間的工作方法（重要，請沿用）

使用者反覆糾正的一件事：**先查證再下結論，不要先講再回頭補**。本期間我犯過四次，每次都是被戳了才去讀原始碼：

| 我下的結論 | 實際 | 怎麼被抓到 |
|---|---|---|
| 「ENTER_FRAME 比較合理」 | 它不帶時間、且必須有 DisplayObject 當事件源 | 使用者要我讀引擎 |
| 「`eui.Component` 也會失效」 | 當時只看過 `Group` 的註冊，沒查 `Component` | 使用者問「你閱讀過原始碼了嗎」 |
| 「幾何差異被 Turbo 吸收，只有 moveInterval 會失步」 | 實驗全用 1×1，沒有補格，是盲點 | 使用者說「去讀 1016 的補牌處理」 |
| 「Turbo 同步已修好」 | 只修了兩個進入順序的其中一個 | 使用者問「急停跟 Turbo 差在哪」 |

**有效的做法**（後半段改用這個，抓到三個 bug）：

1. 讀原始碼確認前提，**引用檔名與段落**，不要類比推論
2. 提出修法之後**先跑大量參數組合驗算**，再動手改
3. 改完**把修正還原一次**，確認斷言真的會紅
4. 誤差要看「是否隨參數放大」——固定值代表柵欄／off-by-one，等比例才是公式錯

使用者明確要求過：「先驗算多一點我看結果後定論」、「你提議的修法改了後之前改動的還準確嗎？先驗算」。

---

## 2. 決議 34～40（全部記在主線 doc）

| # | 內容 | 狀態 |
|---|---|---|
| 34 | Icon 的輸入拆成 `ReelIconLayout`（我在哪，每幀）與 `ReelIconCell`（我是什麼，變了才推） | 已實作 |
| 35 | 方向出口只給推導結果（`exitTowardPositiveAxis` / `layoutType`），`inverseDirection` 不暴露 | 已實作 |
| 36 | 機台是顯示物件（`extends eui.Component`），`init()` 收養 Reel，**mask 蓋在機台** | 已實作 |
| 37 | 推進抽成 `update(deltaTime)`，心跳只是預設的殼；心跳維持 `startTick` | 已實作 |
| 38 | Icon 收在 `BaseReel` 內的普通容器，避開 eui 的強制重測量 | 已實作 |
| 39 | 跨軸表演**搬的是表演物件不是 Icon**，每幀單向跟隨 worldPos | **未實作** |
| 40 | Reel 之間的層級排序用**保留槽位**，不指派連續索引 | **未實作** |

決議 39 是使用者給的做法（他前公司的完成版就是這樣做），三條規則：

- Icon 從頭到尾**不搬**，位置維持框架獨佔
- 搬的是掛在 Icon 上的**表演物件**，Icon 持有它的引用
- 進入轉移狀態後每幀 `表演物件.worldPos = icon.worldPos`，**單向**

要做時框架要補三樣（主線 §3.9）：overlay 容器、每幀跟隨的驅動（**不能掛 `syncAllIcons()`，停穩後它就不跑了，要掛 `BaseSlotMachine.update()`**）、`BaseReelIcon` 的表演物件契約（唯一會動到公開介面的）。

---

## 3. 修好的三個 bug

全部是「格數」與「時間」被混用，而且都在**從沒執行過的路徑**上。

### 3.1 停輪時間的柵欄錯誤（早一格）

`BaseReel.calculateResultEntryHalfCellCount()` 回傳的值被當時間用，算的卻是交接次數。commit 那個邊界上的第一次交接與 commit **同刻**，所以 N 次交接只跨過 N−1 個 `moveInterval`。

**252 組驗算**：修正前 `realized − plan.actualStopTime` 固定 −1.000 格，與所有參數無關；修正後為 0。

### 3.2／3.3 Turbo 同步的補牌看不到退場端墊格

急停有**兩個進入順序**，`prepareFastQuickStopPadding()` 兩個呼叫點，成因不同：

| 順序 | 觸發點 | 成因 | 修法 |
|---|---|---|---|
| 玩家先按、結果後到 | `stopSpin()` 內 | 結果還沒寫進佇列，看不到等一下會墊幾格 | `ReelStopFlow.pendingExitTruncationCellCount` |
| 結果先到、玩家後按 | `quickStop()` 內 | 墊格被併在 `resultSegment` 開頭，`_resultStartIndex` 指的是墊格不是本體 | `ReelDataFlow._resultExitPadCellCount` + `pendingCellCountBeforeResultBody()` |

兩者**互斥**（`clearResultEntry()` 在資料提交同一個函式的尾端），不會重複計算 —— 這點有用 1080 組驗證過，`pre` 路徑的數字與修 3.2 之後**逐格相同**。

> **`skipPendingPerformanceData()` 的砍除範圍刻意不動** —— 它只能砍到 `_resultStartIndex`，墊格砍掉盤面就壞了。兩個計數分開，**不要合併**。§11j 最後一條斷言就是這道防線。

---

## 4. 已確認但**沒修**的 bug：聽牌的 speedMultiplier

**症狀**（`duration = 0.6`）：

| `speedMultiplier` | 實際聽牌間隔 |
|---|---|
| 1 | 0.65（量化誤差，正常） |
| 2 | **0.3334** |
| 3 | **0.2334** |

**加速倍率把 `duration` 一起除掉了**，停在 `duration / multiplier`。

**成因**：`BaseSlotMachine.runOneListenReel()` 在前一軸停下之後才設定，但那時該軸的資料**早就 commit 過**（`stopSpin()` 先對所有軸 commit，才 `await runListenSequence()`）。於是：

- `setActiveTargetStopTime()` **失效**（行程已定案）
- `setActiveMoveInterval()` **生效**（格數不變、每格變快）→ 總時間等比例縮短

**Cocos 版一模一樣**（diff 只有換行與 optional chaining 差異），所以是原版就帶著的 bug。

**修法方向**：依 `ListenReelConfig` 的 JSDoc，正確行為應該是加速之後**多走幾格把時間補回 `duration`**。機制現成 —— Turbo 補牌就是 commit 之後往結果前面插格（`ReelDataFlow.insertPerformanceCellsBeforeResult()`），聽牌只是沒用它。

這比前三個修正大一階（是「設定項目沒被實作完整」，不只是算術錯），而且會改變手感，所以停在這裡等決定。

---

## 5. 推翻的舊結論（避免重複繞路）

| 原本寫的 | 實測 |
|---|---|
| 決議 5／§2.4「多軸 strip 長度必須一致，否則 Turbo 有相位差」 | **錯**。幾何差異（`maxCellSpan` 1/2/3、可視 3/4/5）被半格補牌完全吸收，停輪離散 0.0000s。真正的前提是 **`moveInterval` 一致**。3-4-5-4-3 機台是合法設定 |
| Port Map §1.3「只有 `startTick` 帶時間，所以選它」 | 理由不成立 —— `getTimer()` 是公開函式。真正的理由是**語意**（startTick 是計時器，ENTER_FRAME 是顯示物件的每幀回調，而且需要 DisplayObject 當事件源） |
| Port Map §2.1「`BaseReel` 維持純 class」 | 沒有被採用。實作走第四條：`extends eui.Component` 但 Icon 收在內部普通容器 |
| 我一度標成「停輪順序不保證是已知缺口」 | **不是缺口**。那是我把 `targetStopSeconds` 設得比物理下限還早，任何配置都救不了 |

---

## 6. 斷言現況：175 項

新增的區段：

```
§8 ～ §8d   決議 34 與 getGroupIcons()（含兩端截斷、相鄰同 id group）
§9 ／ §9b   getVisibleIcons() 在截斷盤面與滾動中
§10～§10c   四方向（含用真 BaseReel 驗閱讀順序的端對端）
§11～§11e   多軸：錯開啟動、fastMode、鎖軸、停輪順序與間隔、鉗制
§11f～§11h  守門：moveInterval、幾何不擋、resultByReel 形狀
§11i／§11j  Turbo 同步的兩個進入順序
```

**機台層第一次進入斷言範圍**，靠的是決議 37：測試子類別 `HeadlessSlotMachine` 覆寫 `startTicking()` 成不做事，整條路完全不碰引擎（`egret` 在 `BaseSlotMachine` 只出現三次，全在 `startTicking()` / `stopTicking()` 裡），時間因此是決定性的，不會 flaky。

執行方式不變：

```bash
npx tsc --module commonjs --target es2017 --outDir temp/tests --skipLibCheck \
    tests/CoreGeometry.test.ts libs/modules/egret/egret.d.ts libs/modules/eui/eui.d.ts
node temp/tests/tests/CoreGeometry.test.js
```

---

## 7. 還沒做的

依建議順序：

1. **聽牌的 `speedMultiplier`**（§4）—— 已定位、已驗證、等決定要不要修
2. **即停** —— `BaseSlotMachine.immediateStop()` / `BaseReel.requestImmediateStop()` 仍 0 次執行
3. **自動旋轉** —— `autoSpin()` / `stopAutoSpin()` 仍 0 次
4. **停軸後重排** —— `reconfigureStoppedLayout()` 仍 0 次
5. **多軸實機** —— 場景仍是單軸，`staggerStart` 在瀏覽器裡還沒生效過
6. **`getGroupRuntimes()`** —— Drop 的第一個相依，走訪邏輯已現成（`ReelIconManager.getGroupIndexRange()`），只差公開入口
7. 決議 39／40 的實作
8. Drop（見 [Drop-Module-Readiness.md](Drop-Module-Readiness.md) §6）

第 2～4 項與已修的三個 bug 同源（都是停輪時間的算術，且從沒執行過），**建議一起掃**。

---

## 8. 環境與工具鏈的坑

- **heredoc 在這個環境對長內容不穩** —— 寫長檔案要用 Write 工具，寫完**一定要 grep 確認內容真的進去了**。我曾經以為場景改好了，其實 heredoc 整段失敗、檔案還是舊版，而 `tsc` 因為預設參數照樣編得過。
- **`src/` 與 `tests/` 是 CRLF**，`doc/` 是 LF。用 perl 做多行替換時 `\n` 對不上 CRLF，要改用行號 `head`/`tail` 接合，或先 `sed 's/$/\r/'` 轉換。
- **perl 的 `s{}{}` 會數大括號配對**，替換內容含 TS 程式碼時很容易提早結束。
- **`egret build` 會重寫根目錄 `manifest.json`**，內容一個 byte 沒變、只是換行符變 LF，`git status` 出現假的 `M`。`git checkout -- manifest.json` 還原即可。
- **Browser pane 隱藏時 rAF 停擺**，遊戲時間幾乎不前進。`document.visibilityState` 仍是 `visible`，所以可以用 `setInterval` 手動 pump `egret.ticker.update()`。
- 驗算腳本放在 scratchpad（`matrix.js` / `qsmatrix.js` / `qs2matrix.js` / `turbo*.js` / `listen.js`），直接 require `temp/tests/src/...` 的編譯輸出，配一份從 `temp/tests/tests/EgretStub.js` 複製的 `stub.js`。**session 結束會消失**，需要時照本文的描述重建即可。

---

## 9. Git 狀態

```
main                              12d058c  已推上 origin
feat/machine-display-and-multireel e7a6228  尚未併回
```

`e7a6228` 是本期間第二個 commit（11 檔、+1337 −54）。要併回的話：

```bash
git checkout main && git merge --ff-only feat/machine-display-and-multireel
```
