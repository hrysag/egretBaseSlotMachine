# 遊戲流程層（GameViewManager）：1016／1024 對照與我們的待定問題

> 日期：2026-09-28
> 目的：替本框架做一個 `BaseRoundManager`（1016／1024 對應的是 `BasicSlotGameViewManager`；改名理由見 §9 G1），控制基礎的**滾輪型**與**掉落型**機台
> 1016 原始碼：`D:\Tools\project\Game1016\Web_Slot\assets\Game1016\Script`
> 1024 原始碼：`D:\Tools\project\Game1024\assets\Game1024\Script`
> BIG_wings 原始碼：`D:\Tools\project\BIG_wings\assets\game\BigWings\script`（§5.4，一般連線、非消除）
> CandyParty2 原始碼：`G:\bbin\CandyParty2-master\src`（§5.5，消除類）
> 相關：[Drop-Module-Readiness.md](Drop-Module-Readiness.md)（掉落模組；連消迴圈歸遊戲流程層）、[Core-Runtime-Flow.md](Core-Runtime-Flow.md)（機台內部流程）
>
> **本文一律以「類別.成員」指路，不寫行號。**
> §1～§6 是讀原始碼得到的事實；§7 是讀的時候看到、不建議照抄的地方；§8 對照我們現有的機台；§9 是待定問題，逐題定案。
>
> **目前進度（2026-09-29）**：G1～G12 全部定案。未定、另外談：切分頁的處理（G7）；出錯後的收拾（G12）；各入口／環節／回呼的正式名稱與參數（實作時）。
> 定案帶出的機台工作（2026-09-29 決定先做，再寫 `BaseRoundManager`）：滾輪機台補「全部完全停下」等待入口（G9）；掉落機台補急停「直接到位」（G6）與逐軸通知（G5）。
> **三項都已實作（2026-09-29）**，斷言 314 → **333** 全過，每項都做過還原確認；專案 tsconfig（es5）編譯零錯誤。
> **`BaseRoundManager` 骨架已完成（2026-09-29，§10）**，斷言 → **350** 全過。以上全部未 commit。

---

## 0. 一句話

兩款都是三層：**Controller**（接 UI 按鈕與伺服器）→ **GameViewManager**（一局從開轉到演完的整條流程，機台在它手上）→ **SlotMachine**（只管滾與停）。
manager 靠一條「回合時間軸」（NG → RS×n → FG×n，1024 還有每次連消）一格一格往下走；每一格就是「轉（或不轉）→ 停 → 演 → 下一格」。

> 時間軸是 1016／1024 把伺服器一次送來的多個 round 排成一列的做法，**底層單位仍是 round**；BIG_wings、CandyParty2 沒有時間軸，一轉收一份 round 資料（§5.4、§5.5）。我們採 round 為單位，見 §9 G3。

---

## 1. 三層分工

| 層 | 1016 | 1024 | 管什麼 |
|---|---|---|---|
| Controller | `GameController016` ← `AbstractBasicGameController` | `GameController1024` ← 同名基底 | 公版 UI 按鈕、送注單、收伺服器資料、下注與餘額、自動旋轉的「要不要下一局」 |
| **Manager** | `GameViewManager1016` ← `BasicSlotGameViewManager` | `GameViewManager1024` ← 同名基底（1024 版多了分段取資料的方法） | 一局的完整流程；持有機台、表演控制器、面板 |
| 機台 | `UniSlotMachine1016` ← v3 `UniSlotMachine` | `UniSlotMachine1024` | 滾動、停輪、急停、補牌掉落 |

manager 的幫手：

| 幫手 | 內容 |
|---|---|
| `ProcessDataAfterServer`（`_processedServerData`） | 把伺服器資料攤成回合時間軸 `_timeline: RoundStep[]`（`{ state, data }`），`_roundIdx` 指向目前這一格。見 §3 |
| `BasicGameModeManager` | 狀態（NG／RS／FG）切換時 `changeAllGameState()` 一次廣播給登記過的物件（表演、背景容器、音樂、面板），它們實作 `IGameMode.changeGameState()` |
| `GlobalAccessWriter` | 全域資料（目前狀態、Turbo 等級、是否中斷中……），只有 manager 拿得到寫入金鑰 |
| `AsyncScope` / `FlowAbortManager` | 可中斷的等待；按 Stop 時 `abortAll()` 砍掉正在等的表演 |
| `ShowAniProcessController1016` / `1024` | 中獎表演，manager 只呼叫 `beforeProcessWinScoreData()` / `runShowProcess()` 等高階入口 |

初始化順序（Controller 的 `initForOtherSystem()` 呼叫）：`beforeInit()` → `init()`（建機台、資料、狀態管理）→ `registerSystem()`（掛機台回呼、登記廣播對象、初始化全域資料）。

---

## 2. 一局的流程（1016）

```text
[按 Spin]  AbstractBasicGameController.startSpin()
   ├ manager.startSpin()           → reSetDataForBeforeSpin()（清表演）→ doStartSpin() → 機台 startRoll(turbo)
   ├ manager.setAutoModeTimer()    → 開始計「最少滾多久」（processRollToStopTime()）
   └ sendDataToServer()

[資料回來] GameController016.processReceiveBet()
   ├ manager.setServerReceiveData(roundData)   → 建回合時間軸，_roundIdx = 0（NG）
   └ manager.newRoundDataToStopSpin()          → 等上面的計時器 → stopSpin(目前這格的資料)

[停輪]    BasicSlotGameViewManager.stopSpin()
   ├ beforeStopSpin()        1016：設定聽牌軸（multiSetReadyHand）
   ├ await doStopSpin()      → await 機台 stopRoll(盤面, wild 資料)
   │    └ 每軸停下：_oneReelRollEndCallBackFromSlot
   │         播停輪音效、啟動 wild／scatter 出場動畫、收集該軸回彈 Promise（getEndBouncePromise）
   ├ await beforeAllReelRollEnd()
   │    等出場動畫與回彈全部結束 → wild 位移（或不位移）表演
   └ processAfterAllReelRollEnd()
        ├ await doShowResultAfterStopRoll()   中獎表演、RS／FG 次數表演
        └ checkNextRound()

[下一格]  BasicSlotGameViewManager.checkNextRound()
   ├ _processedServerData.setRoundIdx() 有下一格：
   │    RS → await beforeProcessReSpinRound()（第一把開面板）→ processRound()
   │    FG → await beforeProcessFGRound()（第一把開面板、切狀態）→ processRound()
   └ 沒有下一格 → finalizeToNormal()
        → beforeProcessNormalRound()（FG 結算面板）→ processNormalRound()
        → 發 GameViewEvents.SHOW_END → Controller.onGameViewShowEndEventHandler() 決定要不要自動下一局

[RS／FG 每一把] processRound()
   局間停頓（checkConditionForRoundStep()，依有無中獎、有無 JP 查表）
   → startSpin() → 等 processRollToStopTime() → stopSpin(這格的資料) → 又回到 [停輪]
```

要點：

- **最少滾動時間在 manager**，不在機台。`processRollToStopTime()` = 企劃表的 `totalRoll − earlyStop`；v3 `UniSlotMachine.canStopRoll()` 自帶的 `_normalRollTime` / `_fastRollTime` 在 1016 沒有用上（交接文件記過：1016 的 `totalRoll` 在機台那層整段註解掉）
- **RS／FG 的「伺服器資料」其實早就在時間軸上**，`processRound()` 只是再轉一次、再停在下一格的盤面
- 聽牌軸由 manager 在**資料到了之後**（`beforeStopSpin()`）才設

---

## 3. 回合時間軸

`ProcessDataAfterServer.buildTimeline()`：NG 一格 → `reSpinReelInfo` 每筆一格 → `freeGameReelInfo` 每筆一格。

| 入口 | 用途 |
|---|---|
| `setServerReceiveData()` | 重建時間軸，`_roundIdx = 0` |
| `setRoundIdx()` | 往下一格，沒有就回 false |
| `getCurrentStep()` / `getCurrentData()` / `getCurrentState()` | 目前這格 |
| `getPrevState()` / `getNextStepGameState()` / `getIsLastStep()` | 判斷切換（NG→RS、RS→FG、最後一格） |
| `setSpinIndexForTemporary()` / `getCurrentStepForClick()` | 開轉時記下「這一轉對應哪一格」，給 Stop 流程用 |
| `isFirstReSpin()` / `isFirstFreeGame()` | 第一把才開面板 |

1024 另有 `setServerReceiveDataIncremental()` / `buildTimelineIncremental()`（分段補進時間軸），以及 `ProcessDataAfterServer1024.checkDataIsSameRound()`（這一格與上一格是不是同一局，用來分辨「連消」與「死盤重轉」）。

---

## 4. Stop 按鈕的分流

`BasicSlotGameViewManager.onStopBtnClickHandler()`：

| 當下 | 行為 |
|---|---|
| 輪子還沒全停（`_isRollEnd` false） | 轉給機台 `stopRollCallBack()`（急停；資料未到只記旗標，到了才執行） |
| 已全停、表演中 | `_isInterrupting = true`、`_async.abortAll()`、發 `INTERRUPT_PROCESS` —— 砍掉正在等的表演 |

各段表演開始前 manager 會把 `_isInterrupting` 設回 false，所以「一次 Stop 砍一段」。

---

## 5. 1024 多出來的東西

### 5.1 連消迴圈在 manager

每次消除都是時間軸上的一格。`GameViewManager1024.doShowResultAfterStopRoll()` 演完中獎後，若這格有補牌資料：

1. `setVisibleDropIcon(remove, false)` 先藏起要消的牌
2. `await _basicShowAniProcess.doRefillAniBeforeSlotMachineReFill()` 消除動畫
3. `await 機台.startReFillDrop({ reFill, remove }, 副盤)` 補牌掉落

接著 `checkNextRound()` → `GameViewManager1024.processRound()` 依下一格分三路：

| 下一格 | 行為 |
|---|---|
| 同一局（`checkDataIsSameRound()` true） | **不轉**：`stopSpin(null, NO_SPIN_SAME_ROUND)` 直接跳到判獎與表演 |
| 同狀態、不同局（死盤） | 重轉：`startSpin(SPIN_SAME_ROUND)` → 0.3 秒 → `stopSpin(下一格)` |
| 最後一格 | 視上一格有沒有得分決定要不要再轉一次，否則直接進表演 |

→ 與 [Drop-Module-Readiness.md](Drop-Module-Readiness.md) §7.2「連消迴圈歸遊戲流程層、框架只給單步入口」一致。

### 5.2 分段取資料（挑戰遊戲 → FG）

NG 時間軸走完、但達成進 FG 條件時不結束，改走 SP 分支：

- `checkSpConditionForFinalizeToNormal()` 回 true → `await beforeProcessSpRound()` → `processSpRound()`
- `beforeProcessSpRound()` 回傳一個 Promise，把 resolve 存在 `_challengeFgResolve`；開挑戰遊戲 UI（或 FG 次數到上限直接要 FG 盤面）
- 伺服器回 FG 盤面 → Controller `processOtherActionWithBetData()` → manager `afterReceiveOtherActionWithBet()` → 開 FG 面板後呼叫 `_challengeFgResolve()` 放行
- 挑戰輸了 → `onChallengeHandler` 收到 `BACK_TO_NG` 也呼叫 resolve，`processSpRound()` 看狀態還是 NG 就結束

### 5.3 外層滾輪包掉落

`GameViewManager1024.doStopSpin()` 把主盤 `symbolData2ds` 與副盤 `topReelSymbolData1ds` 合成一份丟給 `UniSlotMachine1024.stopRoll()`。manager 只面對一台機台，外層 Icon 內包掉落軸的細節在機台裡（見 Drop-Module-Readiness §7.6）。

### 5.4 BIG_wings：沒有時間軸，一轉一份 round 資料

`GameManager`（`components/GameManager.ts`）就是這款的 manager，持有轉輪 `BigWingsRoller`。

```text
[按 Spin]  BaseView：command SPIN → presenter.beginGame(betInfo)（向伺服器要這一轉）
                     同時 GameManager.onSpin() → roller.launch()
[資料回來] gameManager.begin(data)
           → 存下這一轉的 Cards、Lines、FreeGame、FreeGameSpin、PayTotal、Wild
           → delayToStop()（依 Turbo／FG／Auto／一般 等不同毫秒）→ onStop() → roller.stop(cards)
[全停]    RollerEvent.StopEnd → checkResult()
           依序 await：displayBigWin → displayJPWinning → displayLockWild → displayScore → displayFree
           → over() 發 CostumeEventName.END → BigWingsView 收到後 presenter.endGame()
```

- **一般連線遊戲（有擴展 wild），不是消除類**
- **每一轉各自向伺服器要一份資料**（一則 `onBeginGame` = 一轉），manager 不持有多個 round
- `Cards` 是 5 軸 × 4 格，**一轉一個完整盤面**；MockData 沒有一轉多組盤面的資料。`currentCardIndex`、`arrCleanAll` 兩個欄位這款沒用上
- 一轉的資料：`Cards`、`AxisLocation`（各軸停在輪帶的位置，例 `"98-108-188-108-105"`）、`Lines`（每條含 `Grids`、`Payoff`）、`FreeGame`（`HitFree`、`FreeGameTime`、scatter 位置）、`Wild`（`Expanding`、哪幾軸）、`PayTotal`、`BBJackpot`
- **FG 也是一轉一則**：中 FG 那一轉 `FreeGame.HitFree = true`、`FreeGameTime = 10`、`Status = 1`；之後每轉 FG `BetTotal = 0`、`Status = 3`、`FreeGameSpin.FreeGameTime` 遞減並帶觸發那轉的 `HitWagersID`；最後一轉 `FreeGameTime = 0`、`Status = 0`。遊戲以 `GameManager.isFree` 旗標記住目前在 FG
- 同樣把「最少滾多久」放在 manager（`GameManager.delayToStop()`），與 1016 相同

### 5.5 CandyParty2：消除類，一轉內含每一步的完整盤面

PIXI 專案，外層是公司共用框架 `H5Prototype`（`SlotModel` / `SlotController` / `PIXISlotView` / `SlotCostume`）。
`Costume`（`PC/Costume.ts`）收資料、管 FG 與 JP 表演；消除迴圈寫在盤面元件 `Candys`（`PC/Candys.ts`）裡。

**一轉的資料**（`Costume.begin()` 交給 `Candys`）：

| 欄位 | 內容 |
|---|---|
| `_cards` | 陣列，**每一步一個完整盤面**：第 0 個是初始盤面，第 k+1 個是第 k 次消除、補完後的盤面 |
| `_lines` | 與 `_cards` 對應；`_lines[k]` 是第 k 步要消的**好幾組**，每組 `Grids`（消哪些格）、`ElementID`、`GridNum`、`Payoff` |
| `_levelID` | 關卡 1～3，盤面大小隨之改成 4×4／5×5／6×6（`Candys.setCandys()`：`line = cpstage + 3`） |
| `_brickNum` | 過關用的剩餘餅乾數 |

伺服器**沒有**另外給「補進來的新牌」清單。

**消除怎麼跑**（`Candys.onFrame2()` → `candyCrush()` → `delay()`）：

1. 全部糖果落定
2. 照 `_lines[k]` 一組一組消，每組間隔 600 毫秒
3. 補位：被消掉的格子直接換成**下一個完整盤面同一格**的糖果，起始高度設成上面那顆原本的位置，再以物理落下（有反彈）
4. 走到最後一個盤面 → `endGame()` 發 `SCORE`

其他：FG 由盤面上的 FG 糖（id 7）觸發；`Costume.end()` 看 `_freeTimes` 還有就 `autoFreeSpin()`（每轉 FG 是否各自向伺服器要，未追到 `H5Prototype` 底層）。
每輪改盤面大小與 Drop-Module-Readiness §7.6 Q13 同類。

---

## 6. manager 呼叫機台的全部入口

| 1016／1024 機台入口 | manager 呼叫的時機 |
|---|---|
| `init()` | manager `init()` |
| `startRoll(turbo)` | `doStartSpin()` |
| `stopRoll(盤面, …)`（await） | `doStopSpin()` |
| `stopRollCallBack()` | Stop 按鈕、輪子未全停 |
| `oneReelRollEndCallBack`（回呼） | `registerSystem()` 掛上；每軸停下 |
| `multiSetReadyHand(軸)` | 1016 `beforeStopSpin()`（NG）／`doStartSpin()`（RS） |
| `getEndBouncePromise(軸)` | 1016 單軸停下時收集，`beforeAllReelRollEnd()` 等完 |
| `startReFillDrop(…)`（await） | 1024 `doShowResultAfterStopRoll()` |
| 遊戲專屬：`playWildAppearAnimation()`、`forceToHandoffScatter()`、`setAllLight()`、`updateExpand()`、`sortReelLayerIndex()`…… | 各表演段落 |

---

## 7. 讀的時候看到、不建議照抄的地方

事實記錄，不是結論；要不要避開歸 §9 討論。

| # | 現象 | 所在 |
|---|---|---|
| 1 | **流程接續大量不 await**：`processAfterAllReelRollEnd()`、`checkNextRound()`、`processRound()`、`stopSpin()` 都是呼叫了不等，錯誤會被吞掉，也沒辦法從外面等「這一局整個結束」 | `BasicSlotGameViewManager` 各處 |
| 2 | **manager 等待用 tween 計時**（`addTweenDelay()` → `GameUtilsTools.DeferByTweenPromiseWithCancel()`），和機台的每幀時間是兩個時間源 | `BasicSlotGameViewManager.addTweenDelay()` |
| 3 | **機台型別持有基底、用時一直轉型**：`(this._slotMachine as UniSlotMachine1016)` 出現數十次 | `GameViewManager1016`、`GameViewManager1024` |
| 4 | **借用 `stopSpin()` 走「不轉」分支**：`stopSpin(null, NO_SPIN_SAME_ROUND)`，基底版遇到 null 直接 return，1024 覆寫成另一條路 | `GameViewManager1024.stopSpin()` |
| 5 | **基底直接呼叫公版 UI**（`GenericUIManager.instance.setMainUIToSpinMode()` 等），1024 還得包 try/catch 防 UI 沒掛 | `BasicSlotGameViewManager.startSpin()` / `onStopBtnClickHandler()` |
| 6 | **抽象方法有一半兩款都空著**：`setStartAutoSpinMode()`、`setPlayerBetValue()`、`goBackLobby()`、`changeScene()`；1024 連 `setTwoLevelTurboMode()` 也空 | 兩款 manager |
| 7 | **兩款的基底已分岔**：1024 的 `checkNextRound()` 把 `beforeProcessNewRoundData()` 移到進位之前、多了 NORMAL 分支與 SP 分支；1016 則在 `newRoundDataToStopSpin()` 另外補呼叫一次 | 兩份 `BasicGameViewManager.ts` |
| 8 | `GameViewManager1024.processRollToStopTime()` 開頭 `if (dataType) return 0.2`，後面的 `else` 又依 `dataType` 分支 —— 後段走不到 | 同左 |
| 9 | **中斷旗標散在各處手動重設**：`_isInterrupting = false` + 寫全域資料，在 1016 出現十幾次 | `GameViewManager1016` |

---

## 8. 對照我們現有的機台

### 8.1 滾輪：`BaseSlotMachine`

| 1016 | 我們 | 差異 |
|---|---|---|
| `startRoll(turbo)` | `startSpin(mode, reelIndexes?)` | 我們用註冊過的 `SpinConfig` 模式名，Turbo 是其中一種 |
| `stopRoll(盤面)` | `stopSpin(resultByReel)`（await 到全停） | 同形 |
| `stopRollCallBack()` | `quickStop()` | 我們資料未到時也只記下，到了才套用 —— 同形 |
| `multiSetReadyHand()` | `setListenReels()` | 我們在 `stopSpin()` 時才規劃，所以資料到了再設、或開轉時設都可以 |
| `oneReelRollEndCallBack` | `onReelStopped` | 我們另有 `onAllReelsStopped`、`onListenStart` / `onListenEnd`、`onReelStarted` |
| `getEndBouncePromise()`（等回彈播完） | **沒有**機台層出口 | 主線 §6「機台層缺完全停的出口」，形狀未定。manager 需要它 |
| manager 的最少滾動時間計時器 | `SpinConfig` 的 `targetStopSeconds`，機台保證不早於它停 | 我們的機台自己保證，manager 可能不必計時 —— §9 |
| — | `immediateStop()` | 1016 沒有對應 |

### 8.2 掉落：`BaseDropSlotMachine`

| 1024 | 我們 |
|---|---|
| `startReFillDrop({ reFill, remove })` | `dropRefill(removePositions, refillCells)` |
| （1024 不用） | `dropOut(fastMode)` / `dropIn(boards, fastMode)` |

### 8.3 現在的臨時流程層

`src/test/SlotMachineScene.ts` 目前就在做 manager 的事（開轉、模擬伺服器延遲、送結果、急停、聽牌設定），而且等待用的是機台心跳轉出來的同一份 deltaTime（`tickSpin()`，避免 §7 第 2 項）。

---

## 9. 待定問題

依相依順序，逐題討論；定案的結果直接寫在各題之下。

**G1　放在哪一層、哪個資料夾 → 已定案（2026-09-28）。** manager 要同時引用滾輪（`Core`）與掉落（`Drop`）。

```text
src/SlotMachine/
  Core/        滾輪（現有）
  Drop/        掉落（現有）
  Manager/     新增：BaseRoundManager.ts 放在這層最上面；之後的幫手（資料樣式、設定）放子資料夾
```

- **資料夾叫 `Manager`，不叫 `Flow`**：`Core/Reel/Internal/` 已有 `ReelStopFlow`（停輪規劃）、`ReelDataFlow`（資料佇列），由 `BaseReel` 持有；叫 `Flow` 容易被當成和它們同一類
- **類名 `BaseRoundManager`**：統一用本框架的 `Base` 前綴（`BaseSlotMachine`、`BaseReel`、`BaseDropSlotMachine`），不沿用 1016／1024 的 `Basic`
  - 原訂 `BaseSlotGameViewManager`，G3 定案「以 round 為單位」後改名（2026-09-28）：它管的是 round、同時管滾輪與掉落、也不是畫面元件，`View`、`SlotGame` 都不貼切
- **主類別放資料夾最上層**：與 `Core/BaseSlotMachine.ts`、`Drop/BaseDropSlotMachine.ts` 相同，設定照例放 `Config/`
- **相依單向**：`Manager` → `Core`、`Drop`；`Core`、`Drop` 不得引用 `Manager`（與「`Drop` 可引用 `Core`、反向不行」同一條規則）

**G2　一個 manager 怎麼同時支援滾輪型與掉落型 → 已定案（2026-09-28）。**
候選：一個基底同時持有兩種機台（各自可為空）／基底只管流程骨架、機台由子類別決定／滾輪與掉落各一個子類別。
1024 的「外層滾輪包掉落」是一台機台（§5.3），我們的組合在遊戲層（Drop-Module-Readiness §7.6），manager 面對的會是兩台。

**→ 定案：基底各留一個位置給滾輪機台與掉落機台，每個位置都可以不給。**

```ts
class BaseRoundManager {
    protected rollMachine?: BaseSlotMachine;      // 滾輪機台（Core）
    protected dropMachine?: BaseDropSlotMachine;  // 掉落機台（Drop）
}
```

| 遊戲型態 | 給哪幾台 |
|---|---|
| 純滾輪（如 1016） | 只給滾輪機台 |
| 純掉落 | 只給掉落機台（換盤面用掉出 → 掉入） |
| 先滾再掉（如 1024） | 兩台都給：滾輪機台管外層滾動；掉落機台管內嵌在外層 Icon 裡的掉落軸（Drop-Module-Readiness Q10：內嵌時仍由掉落機台推時間；Q11 暫定：不收養） |

- 流程走到某一步要用哪一台就用哪一台；**要用的那台沒給就 throw**，不默默略過
- 不採用「滾輪、掉落各一個子類別」或「機台由子類別決定」：遇到先滾再掉都要再多一個類別，或讓遊戲自己重寫一次流程
- 欄位名稱（上面的 `rollMachine` / `dropMachine`）與怎麼傳進來（建構、`init()` 參數或 setter）實作時再定

**G3　回合時間軸歸誰 → 已定案（2026-09-28）：不做時間軸，以 round 為單位。**
原題是「1016／1024 的時間軸帶著 NG／RS／FG 語意，框架要不要提供通用時間軸」。使用者指出前提錯了：

- **伺服器不論 NG、RS、FG，都以 round 為單位送進來。** 滾輪型一個 round = 一個完整盤面；消除型一個 round = 每一次消除後的盤面（陣列）
- **round 資料自己帶著**有無得獎、bonus 等特殊模式
- **伺服器不一定一次送完** NG、RS、FG，有的廠商分開送；中間也可能插 bonus 或其他表演。這些是遊戲層的事
- 三款都對得上：1016／1024 時間軸的每一格就是一個 round（§3）；BIG_wings 一轉收一份 round 資料（§5.4）

**→ 定案：**

1. **manager 一次只處理一個 round**，不持有整條時間軸。一個 round 內：先把機台帶到第一個盤面，消除型再依序做每一次消除；中間在固定時點呼叫遊戲層的掛勾（演中獎、bonus 等，掛勾形狀歸 G5）
2. **round 與 round 之間**：一個 round 做完，manager 向遊戲層要「下一個 round」，**可以等待**
   - 資料已在手上 → 立即給
   - 廠商分開送 → 等向伺服器要回來再給
   - 中間要插挑戰遊戲、bonus 表演 → 也在這裡等（取代 1024 存 resolve 的做法，§5.2）
   - 遊戲層回答「沒有了」→ 這一局結束
3. **round 的狀態（NG／RS／FG／bonus……）由遊戲層定義與切換**，框架只原樣傳給掛勾，不解讀

**G4　消除型 round 要給框架什麼（隨 G3 改寫）→ 已定案（2026-09-28），見本題末段。**
原題「轉／不轉／補牌怎麼表達」起因是 1024 把每次消除攤成時間軸的一格、再用 `stopSpin(null, …)` 借道「不轉」（§7 第 4 項）。
改成「一個 round 內含每次消除的盤面」之後，這個借道不再需要。剩下的問題是：
掉落機台的 `BaseDropSlotMachine.dropRefill(removePositions, refillCells)` 每次要「消哪些格」與「補進來的新牌」。
round 資料要直接給這兩樣，還是只給每次消除後的盤面、由框架推出來？

**→ 定案：每一次消除，round 直接給「消哪些格」與「補進來的新牌」**，與 `dropRefill(removePositions, refillCells)` 一致。

**原則：框架只定資料樣式，不管伺服器怎麼送。** 各廠商送法不同，由遊戲層轉手成框架要的樣式再送進來。已看過的兩款消除類：

| | 伺服器送什麼 | 遊戲層要轉什麼 |
|---|---|---|
| 1024 | 初始盤面 + 一串依序取用的補牌符號（壓縮在 base64 裡），**沒有**中獎位置、**沒有**消哪些格 | 解析器（`ProcessSlotData1024.processByteAfterDecodeBuffer()`）自己用賠率表算中獎 → 中獎格即消除格 → 從補牌串取新牌、算出每一步的完整盤面。`removeData` / `reFillData` 是**解析器的產物**，不是伺服器直接給的 |
| CandyParty2 | 每一步的完整盤面 + 每一步消哪些格（`Grids`），**沒有**新牌清單 | 新牌 = 下一個盤面每一軸最上面、數量等於該軸消掉格數的那幾格 |

> 更正：本題原文與 Drop-Module-Readiness §7.4 Q2 寫「1024 的伺服器直接給 `removeData` / `reFillData`」，不正確（2026-09-28 重讀 `ProcessSlotData1024` 確認）。

不採用「只給消除後的盤面、框架比對前後推算」：同一種牌可能剛好掉到同一格，推不準。例（某一軸，由上到下）：

```text
消除前  7, 3, 7
消除後  5, 7, 7

可能一：消掉中間的 3，上面的 7 掉一格，補 5
可能二：消掉上面的 7 與中間的 3，補 5、7
```

兩種的掉落動畫不同，框架無從分辨。（知道消了哪幾格就不會混淆，但那已經是「消哪些格」這一項，歸遊戲層轉手。）

**G5　表演怎麼接 → 已定案（2026-09-28）。**
原題：manager 在「全停之後、下一格之前」要讓遊戲演中獎，用可覆寫的步驟方法（像 `doShowResultAfterStopRoll()`）還是回呼／事件？

**→ 定案一：五個環節（使用者定義）。** 不論滾輪、掉落或混合模式都一樣：

| # | 環節 | 用途（舉例） |
|---|---|---|
| 1 | 每一 round 開始前 | 設定這個 round 要用的資料 |
| 2 | 旋轉前／掉入前／消除前 | 依模式再改各軸的演出，例如停止順序、聽牌軸、掉入先後；補 wild |
| 3 | 旋轉中／掉入中／消除中 | 過程中的事件，例如某一軸停下、聽牌開始 |
| 4 | 旋轉結束／掉入結束／掉落結束 | 全部到位 |
| 5 | 每一 round 結束 | |

**→ 定案二：1 與 5 每個 round 一次；2～4 在「初始盤面」與「每一次消除」各走一遍，每個環節都等遊戲的表演演完才往下。**

```text
1 round 開始前
  2 → 3 → 4      初始盤面（滾輪型：轉到盤面；掉落型：掉入盤面）
  2 → 3 → 4      第 1 次消除（消掉格子 → 補牌掉落）
  2 → 3 → 4      第 2 次消除
  ……
5 round 結束
```

依據（兩款消除類，事實記錄）：

| | 每一步怎麼走 | 每一步能插表演嗎 |
|---|---|---|
| 1024（滾輪包掉落的混合模式） | 每次消除拆成時間軸一格，**manager 整個流程再走一遍**：同 round 的後續步驟借 `stopSpin(null, NO_SPIN_SAME_ROUND)` 不轉，直接進 `beforeAllReelRollEnd()`（唐僧補 wild）→ `doShowResultAfterStopRoll()`（中獎演出 → 消除 → 補牌掉落）。「局數 −1」（`prepareForNextRound()`）只在新 round 做 | 可以，manager 在每一步呼叫表演並等它演完 |
| CandyParty2（純掉落） | 重複只在盤面元件 `Candys` 內部：落定 → `candyCrush()`（JP／FG 糖檢查、照 `_lines[k]` 一組一組消，組間寫死 `setTimeout` 600 毫秒）→ `delay()` 補位 → 落定……；最後 `endGame()` 發 `SCORE`。外層 `Costume` 收不到每一步的通知，只每幀輪詢盤面狀態 | 只能改盤面元件本身；步驟間不等表演 |

→ 取 1024 的彈性（每一步都能插、都會等），但不需要它的繞路：G3／G4 已定一個 round 直接帶著每一次消除的資料，不必拆時間軸、不必借 `stopSpin(null, …)`、不必用 `checkDataIsSameRound()` 猜是不是同一局。
純掉落對照 CandyParty2：1 清上一盤、依關卡改盤面大小；初始盤面的 2～4 是掉入；每次消除的 2～4 是消除補牌；5 對應它的 `endGame()`。

**記下、未決定：**

- 清上一盤要淡出還是掉出（`BaseDropSlotMachine.dropOut()`），由遊戲在 1 或 2 自己決定；CandyParty2 用淡出（`Candys.clearCandys()`）
- **掉落機台缺逐軸通知**：`BaseDropReel` 有 `onDropStarted` / `onDropCompleted`，但 `BaseDropSlotMachine` 沒有往外轉，只回傳整台的 Promise；滾輪機台有 `onReelStopped` 等。環節 3 若要知道「哪一軸掉完了」，要先補這個出口
  → **2026-09-29 定案：做**。`BaseDropSlotMachine` 把逐軸的開始／完成往外轉，寫法比照滾輪機台的回呼屬性
  → **已實作（2026-09-29）**：`BaseDropSlotMachine.onReelDropStarted` / `onReelDropCompleted`
    - 機台**不佔用**單軸自己的 `onDropStarted` / `onDropCompleted`（留給遊戲）；到位從單軸掉落的 Promise 得知，所以一定在這批的 Promise resolve 之前發出
    - 這批裡沒有要掉的軸（補牌時沒有要消的軸）不發；急停時被提前開始的軸照發開始與到位
    - 斷言 329 → **333**（§12f，4 項）。還原確認：沒要掉的軸也發 → 紅 1 項；不發到位 → 紅 3 項；急停時等待中的軸不轉發 → 紅 1 項
- 各環節的正式方法名稱與參數，實作時再定

**→ 定案三：接法用可覆寫的方法。**

- 每個環節是 `BaseRoundManager` 上一個可覆寫的非同步方法；遊戲繼承 `BaseRoundManager`，覆寫需要的環節
- manager **等方法跑完**才往下一個環節
- 每個方法收到這個 round 的資料與狀態，由遊戲自己判斷要演什麼
- 沒覆寫的環節預設什麼都不做，直接往下
- 「下一個 round 是什麼」（G3）遊戲一定要回答，做成**抽象方法**
- 不採用回呼／事件：事件沒辦法讓 manager 等表演演完，還得另外把 Promise 傳回來。1016／1024 也是覆寫（`doShowResultAfterStopRoll()` 等）

**G6　Stop 按鈕與中斷表演 → 已定案（2026-09-28）。**
原題：還在轉 → `quickStop()`；演出中 → 中斷。框架要不要提供可中斷的等待（1016 的 `AsyncScope`），還是中斷整個交給遊戲層？

**→ 定案：`BaseRoundManager` 給一個「玩家按 Stop」的入口，依當下情況分流。**

| 當下 | 行為 |
|---|---|
| 滾輪在轉 | 轉給 `BaseSlotMachine.quickStop()` |
| 掉落中（掉入或消除補牌） | **直接到位**：所有還在掉、或還在等開始的牌直接跳到最終位置，等同滾輪急停砍表演資料；各軸照常發掉落完成通知，manager 接著進環節 4（G5），後續流程不變 |
| 表演中（某個環節的覆寫方法還在跑） | 通知正在跑的那個環節「玩家要跳過」，由遊戲自己提前收尾；**manager 不強行砍掉** |

- 不強行砍：硬砍會讓演到一半的畫面狀態亂掉；1016 因此在十幾處手動重設中斷旗標（§7 第 9 項）
- 通知的具體形式（傳給覆寫方法的參數，或 manager 上的旗標），實作時再定
- **掉落機台要新增急停入口**（推翻 Drop-Module-Readiness §7.4 Q6「不做掉落急停」，該處已同步註記）：
  - `BaseDropReel`：把所有還沒走完的移動直接推到終點
  - `BaseDropSlotMachine`：還在等軸間隔的軸立刻開始，並直接到位

**實作（2026-09-29，已完成）**：名稱比照滾輪機台，叫 `quickStop()`。

- `BaseDropReel.quickStop()`：每組清掉移動、`cellOffset` 直接設成終點（`GroupDrop.to`），照常發 `onDropCompleted`、resolve；沒在掉落時不做事
- `BaseDropSlotMachine.quickStop()`：還在等軸間隔的軸立刻開始，再逐軸 `quickStop()`，這批的 Promise 照常 resolve；沒在掉落時不做事
- 斷言 322 → **329**（§12e，7 項）。還原確認：不把位置放到終點 → 紅 2 項；機台不先開始等待中的軸 → 紅 1 項；機台不轉給各軸 → 紅 2 項

**G7　時間源 → 已定案（2026-09-28）：manager 本身不等任何時間，所以沒有時間源的問題。**
原題：manager 的等待（局間停頓、最少滾動時間）要走機台心跳的 deltaTime，還是引擎計時器？（§7 第 2 項、§8.3）

1016 的 manager 自己等三種時間：最少滾動時間、局間停頓（`checkConditionForRoundStep()`）、各段表演前的延遲（`beforeShowWin` 等）。

- **manager 只負責依序走環節（G5），本身不等任何時間**
- 局間停頓、表演前延遲都是表演，由遊戲在覆寫的環節裡自己等（用遊戲自己的 tween／計時器）
- **框架不提供 `wait(秒數)` 工具**：曾提議讓遊戲在覆寫方法裡用與機台同一個時鐘的等待工具，但沒有非做不可的理由，收回
- 最少滾動時間見 G8

**切分頁再切回來怎麼處理 → 未定，另外談。** 使用者提的兩種方式：背景用另一個執行緒持續送計時器時間進來強行驅動；或切回來時重新要資料、還原狀態。
這是整個遊戲層級的策略，不屬於 manager。機台已留好口：推進是 `update(deltaTime)`、心跳 `startTicking()` 可覆寫（主線決議 37），哪一種都接得上。

**G8　最少滾動時間要不要在 manager → 已定案（2026-09-28）：不要。**
1016 在 manager 計時（`processRollToStopTime()` = `totalRoll − earlyStop`），BIG_wings 也是（`GameManager.delayToStop()`）；
我們的滾輪機台已由 `SpinConfig` 的 `targetStopSeconds` 保證不會太早停，manager 收到資料就直接 `stopSpin()`，不另計時。

**G9　機台「完全停下」的出口 → 已定案（2026-09-28）。**
原題：manager 要等回彈／停止效果播完才能演中獎（1016 的 `getEndBouncePromise()`）。這是主線 §6 未定的那一項，要先定形狀（機台回呼，或 `stopSpin()` 的 Promise 延到停止效果播完）。

現況（查過程式碼）：

- 單軸對齊結果那一刻 = 停下：`BaseReel.completeStop()` 切到 `Stopped`、resolve 停輪 Promise，**停止效果從這一刻才開始播**（`onStopEffectStarted`）
- `BaseSlotMachine.stopSpin()` 在**全部軸對齊**時 resolve、發 `onAllReelsStopped`，**不等停止效果播完**；逐軸的 `onReelStopped` 也在對齊那一刻
- 單軸有 `onStopEffectStarted` / `onStopEffectCompleted`，機台沒有往外轉
- 掉落機台沒有停止效果，Promise 結束時牌就真的停了，不受影響

**→ 定案：`stopSpin()` 的意思不變，機台另外補一個「全部完全停下」的出口。**

- `BaseSlotMachine` 新增一個等待入口：**這一輪有轉的軸全部播完停止效果才結束；沒有停止效果的軸，對齊就算完成**
- manager 的順序：`await stopSpin()` → 等完全停下 → 進環節 4（G5）
- `stopSpin()` 與 `onReelStopped` 維持在「對齊那一刻」：像 1016 在單軸停下時播 scatter 出場、與回彈同時進行，留給環節 3 用
- 不採用「`stopSpin()` 延到停止效果播完才 resolve」：會改掉現有語意，已用到它的斷言與測試場景都得跟著改
- 入口名稱實作時再定。主線 [Slot-Base-Unit-Refactor-1x1.md](Slot-Base-Unit-Refactor-1x1.md) §6 那一項已同步註記

**實作（2026-09-29，已完成）**

- `BaseReel.waitForSettledAsync()`：停輪且停止效果播完才結束。比照 `waitForStoppedAsync()` 用自己的 Promise，**不佔用**遊戲的 `onStopEffectCompleted` 回呼
  - 停止效果播完那一幀結束（`updateMovement()`）；沒有停止效果可播時，停輪那一刻結束（`completeStop()`）
  - 本軸不在滾動、也沒有停止效果在播時立即結束（包含從未啟動過）；`startRoll()`、`init()`、`cleanup()` 會放掉等待中的 Promise，不會卡住
- `BaseSlotMachine.waitForSettledAsync()`：等最近一輪有轉的軸全部完全停下
  - 另存 `_lastSpinReelIndexes`：`_activeReelIndexes` 在停輪時就清掉，但停止效果要到之後才播完
  - **轉動中呼叫會 throw**：那時還沒啟動的軸看起來是靜止的，會被誤判成已經停下。manager 的用法是 `await stopSpin()` 之後再呼叫
- 斷言 314 → **322**（§11x，8 項）。還原確認：停止效果播完時不結束 → 紅 1 項；沒有停止效果時停輪不結束 → 紅 1 項；改用停輪就清掉的 `_activeReelIndexes` → 紅 4 項

**G10　不碰 UI 與伺服器 → 已定案（2026-09-28）。**
原題：1016 基底直接呼叫公版 UI（§7 第 5 項）。我們的 manager 只對外發事件／回呼，UI 與網路全留給 Controller（遊戲層）？

**→ 定案：manager 完全不引用 UI 與網路，對外兩條路。**

| | 覆寫的方法（G5） | 通知出口（本題） |
|---|---|---|
| 給誰用 | 繼承 `BaseRoundManager` 的遊戲本身 | 外面的 Controller、UI 面板等，沒有繼承 manager 的物件 |
| manager 等不等 | **等**方法跑完才往下 | **不等**，發了就繼續 |
| 用途 | 表演、改這一輪的演出 | 通知要資料、切換其他 UI |

- **通知用回呼屬性**，寫法與機台的 `onReelStopped` / `onAllReelsStopped` 相同，框架內一致
- **五個環節（G5）各自進入時各發一次**
- **「round 結束」的通知同時代表「需要下一個 round 的資料」**，不另設通知；Controller 聽到後自己向伺服器要
- **另加一個「整局結束」通知**（2026-09-29，G11 討論時追加）：遊戲回答「沒有下一個 round」、這一局整個走完時發一次，相當於 1016 的 `SHOW_END`；上層 Controller 以它當作判斷自動旋轉、更新餘額的時機
- 遊戲層收到按鈕事件，呼叫 manager 的入口（開始一局、玩家按 Stop 等，G6）
- 回呼名稱與參數實作時再定

**G11　自動旋轉放哪 → 已定案（2026-09-29）：自動旋轉維持給更上層的 Controller 處理；`BaseRoundManager` 只關注這一 round 的流程控制。**
原題：主線已決定自動旋轉移出機台、歸遊戲流程層。1016 是 Controller 問公版 UI「要不要下一局」。manager 只發「這一局結束」，要不要自動下一局由 Controller 決定？

1016／1024 的做法（共用 `AbstractBasicGameController`，事實記錄）：

1. 開啟自動：公版 UI Auto 面板 → `GameRoot.onGenericUIAutoSpinStartClick(autoTimes)` → `Controller.onStartAuto()`（讀停止條件、放入目前餘額；`manager.setStartAutoSpinMode(true)`，兩款都是空實作）→ `checkAutoNext()`
2. 判斷下一局：`GenericUIManager.checkAutoStatus(checkAutoNextData)` —— 次數減 1（無限次除外）、更新 UI；次數還夠且沒碰到停止條件（`autoSpinUI.isMeetsAnyStopCondition()`）→ Controller `startSpin()`；否則關自動、UI 切回一般
3. 每一局結束：manager 在**整局最後**（NG、RS、FG 全走完、局間停頓也等完）發 `SHOW_END` → `Controller.onGameViewShowEndEventHandler()` → `setAutoNextRound()` 填入「這局有沒有進 FG、這局總賠率、餘額」（前兩項是 `processReceiveBet()` 收到資料時就先算好的）→ 回到 2

- 停止條件與次數由**公版 UI 判斷**，Controller 只提供資料；manager 在自動旋轉上唯一的角色是整局結束發一次 `SHOW_END`
- 注意：1016 的 `SHOW_END` 是**一整局**結束才發；本框架 G10 定的是**每個 round** 結束都發通知

**round 與 round 之間由誰接（G11 討論時確認）→ 維持 G3 的做法：manager 自己一路接下去。**
曾比較另一種做法：manager 每次只跑一個 round，由 Controller 在收到「round 結束」後決定下一步、再交下一個 round。能力相同，差在「下一個 round」的程式碼放哪、manager 知不知道「一局」。

- 維持 G3：一局內的 round 由 manager 接（遊戲子類別實作「下一個 round」抽象方法），局與局之間由 Controller 接
- 為此追加「整局結束」通知（G10），相當於 1016 的 `SHOW_END`，給 Controller 當作判斷自動旋轉的時機

**G12　流程要不要全程 await → 已定案（2026-09-29）：要。**
原題：§7 第 1 項。manager 的公開入口（例如「跑一局」）回傳一個 Promise，一局演完才 resolve、錯誤會往外丟？

- **manager 內部每一步都 await**：機台動作、各環節的覆寫方法（G5）、要下一個 round（G3），都照順序等完才往下
- **「開始一局」的入口回傳 Promise，整局結束時 resolve**，與「整局結束」通知（G10）同一時間點；Controller 可 await 這個 Promise，也可聽通知
- **中間任何一步出錯**（遊戲覆寫方法丟錯、機台報錯）→ 這一局停下、Promise reject、錯誤往外丟，不吞掉
- 出錯之後機台與畫面怎麼收拾，實作時再看
- 對照：1016 的 `processAfterAllReelRollEnd()`、`checkNextRound()`、`processRound()`、`stopSpin()` 都是呼叫了不等，錯誤被吞掉、外面也等不到整局結束（§7 第 1 項）

> 建議順序：G1 → G2 → G3／G4（時間軸長什麼樣）→ G9（manager 需要的機台出口）→ 其餘。

---

## 10. 骨架（2026-09-29）

### 10.1 起轉與 round 開始是兩回事 → 一個基底、兩個子類別（使用者定案）

- **滾輪可以不等資料就先起轉**；**掉落要資料到了才能開始**。round 的模式要資料到了才知道
- 兩者差別只在「初始盤面怎麼出現」；round 迴圈、消除、環節 1／5、通知、Stop 分流、全程 await 都共用
- 不硬做成同一個流程，也不拆成兩個完全獨立的 manager（共用的部分要寫兩份）

| 類別 | 內容 |
|---|---|
| `BaseRoundManager` | 共用：round 迴圈、五個環節、消除、通知、Stop 分流、全程 await；「初始盤面怎麼出現」留成抽象 |
| `RollRoundManager` | 一局開始就起轉（不等資料）；資料到 → 環節 1、2 → 停輪；後續 round（例如 FG）不在轉，環節 3 才起轉。1024 這種先滾再掉也用它，消除交給掉落機台 |
| `DropRoundManager` | 資料到 → 環節 1、2 → 掉出（盤面還在時）→ 掉入 |

```text
滾輪  startGame() → 起轉 → 等第一個 round 的資料
      → 1 → 2 → 3（stopSpin → 等完全停下）→ 4 → [消除：2 → 3 → 4]… → 5
      → 下一個 round：1 → 2 → 3（起轉 → stopSpin → 等完全停下）→ 4 → … → 5 → … → 整局結束
掉落  startGame() → 等第一個 round 的資料
      → 1 → 2 → 3（掉出 → 掉入）→ 4 → [消除：2 → 3 → 4]… → 5 → …
```

### 10.2 骨架的具體形狀（名稱皆暫定，可再改）

- 檔案：`src/SlotMachine/Manager/` 下 `BaseRoundManager.ts`、`RollRoundManager.ts`、`DropRoundManager.ts`、`Data/RoundData.ts`；不是顯示物件（一般類別）
- **資料樣式**（G4）：`RoundData { state; board; cascades? }` —— `state` 遊戲自訂、框架不解讀；`board` 每軸一份、畫面閱讀順序；`cascades` 每次消除 `{ removePositions, refillCells }`
- **入口**：`startGame()` 回傳整局結束才 resolve 的 Promise（G12）；`requestStop()` 依當下分流（G6）
- **環節**（G5）：可覆寫的 async 方法，manager 依序 await；環節 3 與機台動作**同時跑**、兩者都完成才往下（不擋機台）
- **下一個 round**（G3）：抽象方法 `nextRound()`，回 `null` = 整局結束；第一個 round 也從這裡拿（Controller 收到伺服器資料後交給遊戲子類別）
- **滾輪用哪個模式**：抽象方法，由遊戲決定（Turbo 等）；第一個 round 起轉時資料還沒到，所以參數可能是 `null`
- **通知**（G10）：一個回呼收五個環節的進入，另一個回呼收整局結束
- **Stop 表演中**（G6）：manager 呼叫可覆寫的「玩家要跳過」方法，遊戲自己收尾
- **掉落機台缺席而 round 有消除** → throw（G2）

未定、骨架先不做：環節 3 的逐軸事件怎麼轉給遊戲（目前遊戲可直接掛機台的 `onReelStopped` / `onReelDropCompleted`）；出錯後的收拾（G12）。

### 10.3 實作（2026-09-29，骨架已完成）

| 檔 | 內容 |
|---|---|
| `Manager/Data/RoundData.ts` | `RoundData<TState>`、`RoundCascade`、`RoundStage`（1～5）、`RoundStepContext`（`round` + `stepIndex`：0 = 初始盤面，k = 第 k 次消除） |
| `Manager/BaseRoundManager.ts` | `startGame()`、`requestStop()`、`playing`、`currentStage`；抽象 `nextRound()`、`presentBoard()`；可覆寫 `beginGame()`、`onRoundStart` / `onBeforeStep` / `onStep` / `onAfterStep` / `onRoundEnd`、`onSkipRequested()`；通知 `onStageEnter`、`onGameEnd` |
| `Manager/RollRoundManager.ts` | `beginGame()` 起轉；`presentBoard()`：沒在轉就起轉 → `stopSpin()` → `waitForSettledAsync()`；抽象 `getSpinMode(round \| null)` |
| `Manager/DropRoundManager.ts` | `presentBoard()`：盤面還在就 `dropOut()` → `dropIn()`；可覆寫 `isFastDrop()`（預設否） |

- 不是顯示物件；機台以建構參數 `{ roll?, drop? }` 傳入；`RollRoundManager` 沒給滾輪機台、`DropRoundManager` 沒給掉落機台 → 建構時 throw
- 環節 3 的覆寫方法與機台動作用 `Promise.all` 同時跑；`currentStage` 只在環節進行中有值，等下一個 round 的資料時為 undefined
- 斷言 333 → **350**（§13a～13d，17 項）：起轉早於資料、兩個 round 的環節順序（NG 資料到時已在轉、FG 到環節 3 才起轉、環節 4 在回彈播完之後）、通知與整局結束的先後、掉落的消除重複 2～4、Stop 三種分流、出錯 reject、守門
- 還原確認：不等完全停下 → 紅 1；一局開始不先起轉 → 紅 4；表演中 Stop 不通知遊戲 → 紅 1；不走消除 → 紅 2
- 專案 tsconfig（es5）編譯零錯誤。測試場景還沒接上 manager，沒在瀏覽器跑過
