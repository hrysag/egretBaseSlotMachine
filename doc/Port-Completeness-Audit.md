# 移植完成度盤點

> 對象：`src/SlotMachine/Core` ↔ `D:\cocosTest\NewSlotMachine\SlotFrameWork\SlotMachine\assets\Script\SlotMachine`
> 姊妹文件：[Slot-Base-Unit-Refactor-1x1.md](Slot-Base-Unit-Refactor-1x1.md)（主線）、[Core-Responsibility-Slimming.md](Core-Responsibility-Slimming.md)、[Core-Runtime-Flow.md](Core-Runtime-Flow.md)、[Drop-Module-Readiness.md](Drop-Module-Readiness.md)
> 盤點基準：commit `fffdb75`
>
> **本文一律以「類別.成員」指路，不寫行號。**

---

## 0. 一句話

**程式碼幾乎全部搬完了，真正的缺口只有四項；但「搬完」不等於「跑過」—— 實機只驗過單軸、Vertical 正向、normal 模式這一條路。**

這兩件事要分開看，否則會誤判剩餘工作量。

---

## 1. 盤點方法（可重現）

```bash
C="D:/cocosTest/NewSlotMachine/SlotFrameWork/SlotMachine/assets/Script/SlotMachine"

ext() {
    grep -oE "^\s+(public|protected)\s+(static\s+)?(async\s+)?(get |set )?[A-Za-z_][A-Za-z0-9_]*" "$1" \
    | sed -E 's/^\s+(public|protected)\s+(static\s+)?(async\s+)?(get |set )?//' | sort -u
}

comm -23 <(ext "$C/<檔>") <(ext "src/SlotMachine/<檔>")   # Cocos 有、Egret 沒有
```

只比對 `public` / `protected`；`private` 是實作細節，改名不算缺口。

---

## 2. 檔案層級：一對一全部有對應

| | 檔數 | 實際程式碼行數 |
|---|---:|---:|
| Cocos | 19 | 5,696（總行數） |
| Egret | 21 | 5,608（總行數） |

差異全部有來由：

| Egret 多出來的 | 來源 |
|---|---|
| `Core/Internal/NumberAssert.ts` | 瘦身決議（15 份重複 helper 收成 5 個純函式） |
| `Core/Reel/Config/ReelIconDirection.ts` | 從 `ReelConfig.ts` 拆出 |
| `Core/Reel/Config/ReelTimingConfig.ts` | 從 `ReelConfig.ts` 拆出，讓停輪流程維持零引擎相依 |

| Cocos 有、Egret 沒有的檔 | 來源 |
|---|---|
| `ReelBounceConfig.ts` + `ReelStartEffectConfig.ts` | 決議 20 合併成 `ReelEffectConfig.ts`（兩者欄位本來就完全相同） |

---

## 3. 成員層級：43 處差異，39 處有來由

「Cocos 有、Egret 沒有」共 **43 處**（相異名稱 37 個，少數成員在兩個類別各出現一次）。逐一對過之後，**39 處是決議刪除、改名或 Egret 無對應**：

| 分類 | 成員 | 來源 |
|---|---|---|
| 決議 20 改名 | `bounceActive`、`onBounceStarted`、`onBounceCompleted` | → `stopEffectActive`、`onStopEffect*` |
| 決議 §4.2 / §4.3 | `iconContainer`、`iconPrefab` | 容器就是 `this`；prefab → `iconFactory` |
| Egret 無 Component | `update`、`updateMode`、`setUpdateMode`、`onDestroy` | `ReelUpdateMode` 移除；`onDestroy` → `cleanup()` |
| 簽章合併 | `configureReels`、`reels` | Cocos 的 `init()` 不吃參數，我們合併成 `init(reels)` |
| 內部改名 | `recycleExitedIcon`、`recycleExitedIconKeepingData`、`tryHandoffExitedIcon`、`syncAll`、`getEntryBufferRuntimes`、`validateVisibleData`、`movementSign` | 對應 `recycleExitedCell*`、`handoffOneCell`、`syncAllIcons`、`getReplaceableEntryRuntimes`、`validateResultData`、`resultEntryAtDisplayStart` |
| 決議 28 | `ReelStopFlow.moveInterval` / `setMoveInterval` | 三份 `moveInterval` 收成一份 |
| 瘦身 §3.2 死碼 | `ReelStopFlow.quickStopRequested` / `pendingVisibleResult` / `pendingRequiredTail` | 外部拿不到實例，留著等於死碼 |
| 主線 §4 刪除清單 | `calculateResultEntryHalfCellCount`、`calculateQuickStopHalfCellCount`、`canHandoffExitBuffer`、`applyOffset`、`createVisibleLayout`、`getDataAxisLength` | 1×1 之後不需要（含兩個 1000 步模擬迴圈） |
| 決議 1 自然消失 | `ReelDataFlow.countCells` | 佇列已逐 Cell，`length` 就是答案 |
| 等價替換 | `getFullyVisibleSymbols` | → `getVisibleRuntimes()`。1×1 之後「完全可見」就是可視段本身，不需要幾何判斷 |

**另外：`src/SlotMachine/` 底下沒有任何 `TODO` / `FIXME` / 未實作的樁。** 每個方法都是完整實作。

---

## 4. 真正的缺口：四項

| # | 缺的東西 | Cocos 原本 | 我們現在 | 為什麼要補 |
|---|---|---|---|---|
| 1 | **`getGroupIcons()`** | `ReelIconManager.getIconsForRuntimes()` | 無 | 主線 §3.4 規劃過、doc 一直在引用，但從未實作。**Drop 的第一個相依**（Drop doc §6 第 1 步），也是大 Symbol 中獎表演的入口 |
| 2 | **`getVisibleIcons()`** | `BaseReel` 與 `BaseSlotMachine` 兩層都有 | 只有 id 版（`getVisibleCellSymbolIds()` / `getAllVisibleSymbolIds()`） | 中獎表演要拿的是 Icon 不是 id。資料拿得到（`icons` + `firstVisibleIndex`），但要遊戲層自己切 |
| 3 | **`getIntersectingSymbols()` 的 1×1 版** | 幾何判斷「與顯示區有交集」的 Symbol | 無 | 見下方 |
| 4 | **方向的對外讀取** | `BaseReel.layoutType` / `inverseDirection` | 無（決議 28 收歸 `ReelIconManager` 獨家持有，`BaseReel` 只留 `resultEntryAtDisplayStart`） | `TestReelIcon` 現在要靠建構參數被外部告知方向（那個檔案的 JSDoc 就在講這個缺口）。Drop 也會需要 |

### 4.1 第 3 項是決議 31 造成的回頭帳

`getIntersectingSymbols()` 當初被歸進主線 §4 刪除清單，理由是「1×N 時代的幾何查詢」。

**那個理由在決議 31 之後不成立了。** 截斷兩端都可能之後，一個 group 的 head 可以在顯示區外、卻把圖蓋進可視區：

```text
        ┌────────┐
 進場   │  7:0   │ ← head 在這裡，圖往下蓋三格
 buffer │        │
        ╞════════╡
 可視   │  7:1   │ ← 玩家看得到這張圖，
        │  7:2   │    但 7:0 這個 runtime 不在可視段裡
        │  2:0   │
        ╞════════╡
```

也就是說：**「這張圖出現在畫面上」與「這個 runtime 在可視段裡」不再等價。** 現在沒有任何 API 問得到前者。

1×1 版不必做幾何 —— 可視段往兩端各多看 `maxCellSpan - 1` 格，收集 `groupOffset === 0` 且圖會蓋進可視區的 head 即可，是索引算術。**定義要先討論**（「有交集」的判準、要不要含剛好貼邊的），所以列為待討論而非直接實作。

---

## 5. 搬完 ≠ 跑過

程式碼都在，**但實機只驗過單軸、Vertical 正向、normal 模式**。下列路徑至今一次都沒執行過：

| 從沒執行過 | 所在 |
|---|---|
| **多軸**（`reelList.length > 1`） | `BaseSlotMachine.startDueReels()` 的錯開啟動；`TestSlotMachine.createReelTimings()` 的 `staggerStart` 從來沒生效 |
| `fastMode`（同步啟動分支） | `BaseSlotMachine.startSpin()` |
| **Turbo 同步停輪** | `BaseSlotMachine.prepareFastQuickStopPadding()`、`ReelDataFlow.insertPerformanceCellsBeforeResult()`，整條沒跑過 |
| 聽牌 | `BaseSlotMachine.setListenReels()` / `runListenSequence()` |
| 急停／即停 | `BaseSlotMachine.quickStop()` / `immediateStop()`、`BaseReel.requestQuickStop()` / `requestImmediateStop()` |
| 自動旋轉 | `BaseSlotMachine.autoSpin()` / `stopAutoSpin()` |
| 四方向 | 只跑過 Vertical 正向；Horizontal 與 `inverseDirection` 沒驗過 |
| 停軸後重排 | `BaseReel.reconfigureStoppedLayout()` |
| **決議 31 的退場端截斷** | 程式與斷言都有，**實機沒驗** |

純 TS 斷言 77 項涵蓋的是幾何與資料流，**不涵蓋 Movement、心跳與多軸協調** —— 那幾項只能實機驗。

---

## 6. 建議的接續順序

1. **`getGroupIcons()`（缺口 1）與方向出口（缺口 4）** —— 同時是 Drop 與中獎表演的相依，不動流程、風險低，做完可以立刻用斷言鎖住
2. **`getVisibleIcons()`（缺口 2）** —— 同上，順手
3. **`getIntersectingSymbols()` 的 1×1 定義（缺口 3）** —— 要先討論判準
4. **多軸** —— 其餘每一項的前提；`maxCellSpan` 統一、strip 長度一致這些決議到現在都還沒被真正驗證過
5. Turbo 同步 / `fastMode` → 聽牌 → 急停即停 → 四方向
6. Drop（見 [Drop-Module-Readiness.md](Drop-Module-Readiness.md) §6）

實機驗證的債另外還有一筆：**決議 31 的退場端截斷**，程式改完之後還沒跑過瀏覽器。

---

## 7. 附錄：commit 時發現的工具鏈坑

**`egret clean` 會覆蓋 tracked 的根目錄 `manifest.json`**，把 `"game": ["main.js"]` 換成 `bin-debug/` 底下 30 個逐檔 JS 的清單（那是舊編譯器的產物格式）。

這是「不要拿 `egret clean` 當清理工具」的第二條事證 —— 第一條是它會洗掉 `bin-debug/js/main.js`。

**跑完 `clean` 一定要再 `build` 一次，而且要看 `git status` 有沒有多出 `manifest.json`。**
