# 移植完成度盤點

> 對象：`src/SlotMachine/Core` ↔ `D:\cocosTest\NewSlotMachine\SlotFrameWork\SlotMachine\assets\Script\SlotMachine`
> 姊妹文件：[Slot-Base-Unit-Refactor-1x1.md](Slot-Base-Unit-Refactor-1x1.md)（主線）、[Core-Responsibility-Slimming.md](Core-Responsibility-Slimming.md)、[Core-Runtime-Flow.md](Core-Runtime-Flow.md)、[Drop-Module-Readiness.md](Drop-Module-Readiness.md)
> 盤點基準：commit `fffdb75`（§4 缺口 1 與 §6 順序已隨後續實作更新）
>
> **本文一律以「類別.成員」指路，不寫行號。**

---

## 0. 一句話

**程式碼幾乎全部搬完了，四個缺口都補完了（見 §4）；但「搬完」不等於「跑過」—— 實機只驗過單軸、Vertical 正向、normal 模式這一條路。**

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

## 4. 真正的缺口：四項（全部結清）

| # | 缺的東西 | Cocos 原本 | 我們現在 | 為什麼要補 |
|---|---|---|---|---|
| 1 | ~~**`getGroupIcons()`**~~ | `ReelIconManager.getIconsForRuntimes()` | **已補** | 走鄰居推導、回傳新陣列，兩端截斷時回傳格數可能少於 `cellSpan`。連帶做了決議 34（Icon 的輸入拆成 `ReelIconLayout` / `ReelIconCell`）。見主線 §3.9；斷言 `tests/CoreGeometry.test.ts` §8～8d |
| 2 | ~~**`getVisibleIcons()`**~~ | `BaseReel` 與 `BaseSlotMachine` 兩層都有 | **已補**（兩層都有） | 判準見缺口 3 |
| 3 | ~~**`getIntersectingSymbols()` 的 1×1 版**~~ | 幾何判斷「與顯示區有交集」的 Symbol | **判準已定，併入 `getVisibleIcons()`** | 「該 group 在可視段裡至少擁有一格」等價於「圖與顯示區有交集」，純索引算術，不需要幾何與 epsilon。剩下的只有要不要再開一個回傳 Runtime 的版本。見主線 §3.9 |
| 4 | ~~**方向的對外讀取**~~ | `BaseReel.layoutType` / `inverseDirection` | **已補**，但只給 `layoutType` 與 `exitTowardPositiveAxis` | 決議 35：`inverseDirection` 刻意不暴露，避免遊戲層複製框架的座標慣例。補的過程中查出 `resultEntryAtDisplayStart` 的 Horizontal 分支是反的（移植時沒跟上 `mapAxisToLocal()` 的改動），已修，見主線 §2.5 |

### 4.1 第 3 項是決議 31 造成的回頭帳（已結）

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

1×1 版不必做幾何。**判準已定案並實作**：對可視段的每一格算 `headIndex = index - groupOffset` 去重，就是所有「圖有蓋進可視區」的 group；剛好貼邊（`stripOffset === 0` 時進場側再外面那一格）交集為零，排除。實作是 `getVisibleIcons()`（主線 §3.9），斷言在 `tests/CoreGeometry.test.ts` §9／§9b。

---

## 5. 搬完 ≠ 跑過

程式碼都在，**但實機只驗過單軸、normal 模式**（四方向已補驗，見下）。下列路徑至今一次都沒執行過：

| 從沒執行過 | 所在 |
|---|---|
| **多軸**（實機） | 純 TS 斷言已涵蓋錯開啟動、fastMode、鎖軸與停輪順序（`tests` §11～11e），但**瀏覽器沒跑過**；`TestSlotMachine.createReelTimings()` 的 `staggerStart` 在場景裡仍未生效 |
| 聽牌 | `BaseSlotMachine.setListenReels()` / `runListenSequence()` |
| 即停 | `BaseSlotMachine.immediateStop()`、`BaseReel.requestImmediateStop()`（急停兩個順序已由 §11i／§11j 涵蓋） |
| 自動旋轉 | `BaseSlotMachine.autoSpin()` / `stopAutoSpin()` |
| 停軸後重排 | `BaseReel.reconfigureStoppedLayout()` |

**已補驗**：決議 31 的**退場端截斷**已在瀏覽器跑過 —— 這筆實機債結清。

**Turbo 同步的補牌盲點已修，兩個進入順序各一個成因**（主線 §3.6）：各軸退場端墊的格數不同時 Turbo 根本不同步，失步量精確等於墊格數。「玩家先按」是看不到還沒提交的墊格；「結果先到」是墊格被併進結果區段、`_resultStartIndex` 指的不是本體。1080 組驗算。這條是 1016 沒有的功能（它的 `fastStopRoll()` 逐軸砍到不同的保留數，本來就沒同時停），所以那邊沒這個 bug。

**停輪時間的柵欄錯誤已修**（主線 §3.7）：`calculateResultEntryHalfCellCount()` 把交接次數當時間用，導致實際停輪比要求早約一格。252 組參數組合實測，修正後 `realized === plan.actualStopTime`。這是多軸斷言建起來之後第一個被抓到的真 bug。

**四方向也補驗了**：垂直正／反與水平正／反都在瀏覽器實際跑過（人工目視，測試場景的「切換方向」鈕）。水平那一支原本是壞的 —— `resultEntryAtDisplayStart` 的 Horizontal 分支反了，見主線 §2.5；修正後盤面順序正確。

> 水平模式下**狀態列的 `visible ids` 不能當證據** —— 提交與讀回用同一個布林，旗標錯會互相抵銷，照樣印出送進去的盤面，只有畫面會鏡像。驗水平一定要看圖，並且送左右不對稱的盤面（例如 `8,9,10`）。
> 另外測試素材是直式的（1×1 為 160×128、073 為 160×384），水平下會被拉伸變形，那是素材不是幾何。

測試場景的 `RESULT_SCENARIOS` 可以逐一送出不完整大圖的盤面（`73,73,1` / `73,1,1` / `1,73,73` / `62,62,1` / `1,62,62`），狀態列同時印出「可視段的每一格」與 `getVisibleIcons()`，兩者在截斷盤面上的分岔看得見。

純 TS 斷言 175 項。決議 37 把推進抽成 `update(deltaTime)` 之後，**機台層的時序也進了斷言範圍**（測試子類別覆寫 `startTicking()`，完全不碰引擎，時間是決定性的）。仍然不涵蓋的是真實 frame pacing、rAF 節流與實際算繪 —— 那些只能實機驗。

---

## 6. 建議的接續順序

1. ~~`getGroupIcons()`（缺口 1）~~ —— **已完成**，連帶做了決議 34
2. ~~`getVisibleIcons()`（缺口 2）與缺口 3 的判準~~ —— **已完成**，兩層都有
3. ~~方向出口（缺口 4）~~ —— **已完成**（決議 35），並修掉 Horizontal 的閱讀順序推導
4. **`getGroupRuntimes()`** —— Drop 要動的是 `cellOffset`（在 Runtime 上），走訪邏輯已現成，只差公開入口
5. **多軸實機** —— 斷言已涵蓋時序與守門（§11～11h）；還缺瀏覽器實跑（場景仍是單軸，`staggerStart` 未生效）
6. Turbo 同步 / `fastMode` → 聽牌 → 急停即停
7. Drop（見 [Drop-Module-Readiness.md](Drop-Module-Readiness.md) §6）



---

## 7. 附錄：commit 時發現的工具鏈坑

**`egret clean` 會覆蓋 tracked 的根目錄 `manifest.json`**，把 `"game": ["main.js"]` 換成 `bin-debug/` 底下 30 個逐檔 JS 的清單（那是舊編譯器的產物格式）。

這是「不要拿 `egret clean` 當清理工具」的第二條事證 —— 第一條是它會洗掉 `bin-debug/js/main.js`。

**跑完 `clean` 一定要再 `build` 一次，而且要看 `git status` 有沒有多出 `manifest.json`。**

補一條：`egret build` 也會重寫根目錄 `manifest.json`，但**內容一個 byte 都沒變**，只是換行符寫成 LF 而工作區慣例是 CRLF，於是 `git status` 出現一個假的 `M`。`git checkout -- manifest.json` 即可還原，不必擔心改壞。
