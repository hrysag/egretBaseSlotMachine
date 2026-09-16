# Cocos Slot 底層移植到 Egret 的引擎能力對照

> 引擎版本：egret-core 5.4.1（`D:\Egret_test\egret-core-master\egret-core-master`）
> 來源專案：`D:\cocosTest\NewSlotMachine\SlotFrameWork\SlotMachine`（Cocos Creator 3.8.7）
> 目標專案：`D:\Egret_test\newSlotMachineBase`
> 姊妹文件：`Eui_test\doc\Egret-EUI-Group-vs-DisplayObjectContainer.md`、`Egret-EUI-Component-Lifecycle.md`、`EgretUIEditor-Custom-Components.md`

---

## 0. 一句話結論

**純邏輯的部分（約 70%）可以原封不動搬過去；會痛的只有四件事：**

1. Egret 沒有 Component／`update(dt)`，心跳給的是 **timeStamp 不是 deltaTime**。
2. Egret 的 **Y 軸向下**，錨點預設在左上角且單位是像素。
3. Egret 沒有 Prefab／`instantiate()`，對應物是 **exml skin + `new`**。
4. `DisplayObject.width/height` **對顯示沒有作用**，不等於 `UITransform.setContentSize()`。

其餘（`BaseMovement`、`ReelDataList`、`ReelDataFlow`、`ReelStopFlow`、`ReelSymbolRegistry`、`ReelBounce`、`ReelState`）完全不碰引擎 API，是純 TypeScript，直接複製即可。

---

## 1. 心跳與 deltaTime（最關鍵的一項）

### 1.1 Egret 沒有 `update(deltaTime)`

Cocos 的 `Component.update(deltaTime)` 在 Egret 沒有對應物。取得每幀回調只有兩條路：

```ts
// src/egret/utils/startTick.ts:52
export function startTick(callBack:(timeStamp:number)=>boolean, thisObject:any):void {
    ticker.$startTick(callBack, thisObject);
}
```

```ts
// src/egret/player/SystemTicker.ts:322
private broadcastEnterFrame(): void {
    let list: any[] = DisplayObject.$enterFrameCallBackList;
    ...
    list[i].dispatchEventWith(Event.ENTER_FRAME);
}
```

### 1.2 兩者觸發頻率不同 —— 這點必須知道

`SystemTicker.update()` 由 rAF 驅動：

```ts
// src/egret/web/EgretWeb.ts:241-244
requestAnimationFrame(onTick);
function onTick(): void {
    requestAnimationFrame(onTick);
    ticker.update();
}
```

而 `update()` 內部：

```ts
// src/egret/player/SystemTicker.ts:251-291（節錄）
public update(forceUpdate?: boolean): void {
    let timeStamp = egret.getTimer();
    ...
    if (this.isPaused) { this.lastTimeStamp = timeStamp; return; }
    this.callLaterAsyncs();
    for (let i = 0; i < length; i++) {
        if (callBackList[i].call(thisObjectList[i], timeStamp)) {   // ← startTick 回調，每個 rAF 都跑
            requestRenderingFlag = true;
        }
    }
    let deltaTime = timeStamp - this.lastTimeStamp;
    this.lastTimeStamp = timeStamp;
    if (deltaTime >= this.frameDeltaTime || forceUpdate) { ... }
    else { ...; if (this.lastCount > 0) { ...; return; } }          // ← 沒到 frameRate 就在這裡返回
    this.render(true, ...);
    this.broadcastEnterFrame();                                      // ← ENTER_FRAME 只在真正出幀時廣播
}
```

| 來源 | 觸發頻率 | 參數 |
|---|---|---|
| `egret.startTick(cb, this)` | **每個 rAF**（60／120Hz，與 frameRate 無關） | `timeStamp`（ms，自框架啟動） |
| `Event.ENTER_FRAME` | 只在通過 frameRate 閘門、真正渲染的幀 | Event 物件，**沒有時間** |

預設 `$frameRate = 30`（`SystemTicker.ts:162`）。

**後續補查（選定心跳時重讀原始碼）**，兩點修正本節原本的判斷：

1. **`egret.getTimer()` 是公開函式**（`getTimer.ts:49`，`Date.now() - sys.$START_TIME`），所以「只有 `startTick` 帶時間」不構成選它的理由 —— 走 `ENTER_FRAME` 也自己相減得出 deltaTime。
2. **`ENTER_FRAME` 必須有一個 DisplayObject 當事件源。** `DisplayObject.$addListener()` 在監聽 `ENTER_FRAME` 時把自己推進 `$enterFrameCallBackList`（`DisplayObject.ts:2185`），註冊時**沒有** stage 檢查，所以離線物件照樣收得到 —— 但非顯示物件（例如純 class 的協調者）根本沒有這個入口。

真正選 `startTick` 的理由因此是**語意**：引擎對它的說明是「註冊並啟動一個計時器」，那正是協調者要的；`ENTER_FRAME` 是顯示物件的每幀回調。詳見主線 doc 決議 37。

### 1.3 對 Slot 的結論

**用 `startTick` + 自己算 deltaTime**，並且**只註冊一個**，由 `BaseSlotMachine` 統一推進所有 Reel：

```ts
private _lastTimeStamp = 0;

private onTick = (timeStamp: number): boolean => {
    const deltaTime = (timeStamp - this._lastTimeStamp) / 1000;   // Egret 給毫秒，框架內部用秒
    this._lastTimeStamp = timeStamp;
    for (const reel of this._runtimeReels) {
        reel.updateMovement(deltaTime);
    }
    return false;   // 回傳 true 會強制立刻重繪
};
```

好消息：現有框架已經有 `ReelUpdateMode.External`（`ReelConfig.ts`），`BaseReel.updateMovement(deltaTime)` 本來就是公開入口。**Turbo 同步停輪要求所有軸吃同一份 deltaTime，External 模式正好是唯一正確選擇** —— 移植後應該直接廢掉 `ReelUpdateMode.Self`，因為 Egret 沒有「每個物件自己 update」這種東西。

暫停行為：`isPaused` 檢查在回調迴圈**之前**（`SystemTicker.ts:264`），所以暫停時 tick 不會觸發，`lastTimeStamp` 也會被同步更新，恢復時不會噴出一個巨大的 deltaTime。但**瀏覽器分頁切到背景時 rAF 停止**，這條路徑不走 `isPaused`，恢復後第一幀的 deltaTime 會很大 —— 移植時要在 `onTick` 裡加 deltaTime 上限鉗制（Cocos 版本沒有這個問題是因為引擎自己做了）。

---

## 2. 沒有 Component／Node／Prefab

| Cocos | Egret 5.4.1 | 說明 |
|---|---|---|
| `Component` 掛在 `Node` 上 | **不存在** | Egret 是純顯示列表繼承制 |
| `Node` | `egret.DisplayObject` | |
| 容器 `Node` | `egret.DisplayObjectContainer`（`display/DisplayObjectContainer.ts`） | |
| `Prefab` + `instantiate()` | `.exml` skin + `new YourComponent()` | 見 `Egret-EUI-Component-Lifecycle.md` |
| `node.addChild()` | `container.addChild(child)`（`DisplayObjectContainer.ts:133`） | |
| `node.destroy()` | **沒有 destroy** → `parent.removeChild(child)` + 自行斷參考 | |
| `node.isValid` | 無對應；用 `child.parent !== null` 或自己記旗標 | |
| `onDestroy()` | `Event.REMOVED_FROM_STAGE` 監聽，或自己呼叫 `cleanup()` | |
| `@property` Inspector | exml 屬性／Egret UI Editor 自訂元件面板 | 見 `EgretUIEditor-Custom-Components.md` |
| `Enum()` 裝飾器 | 無；exml 只能給字串或數字 | |

### 2.1 `BaseReel` 該繼承誰？

三個選項：

| 方案 | 做法 | 判斷 |
|---|---|---|
| A. 組合 | `BaseReel` 維持純 class，建構時傳入一個 `egret.DisplayObjectContainer` 當 icon 容器 | **推薦**。Reel 本來就只操作數值與 Icon，不需要自己是顯示物件；也最容易寫純 TS 測試 |
| B. 繼承 `egret.DisplayObjectContainer` | `class BaseReel extends egret.DisplayObjectContainer` | 最接近現在的形狀，但 Reel 就被綁死在顯示樹上 |
| C. 繼承 `eui.Group` | 可用 exml 佈局與約束 | 只有在需要 EUI 佈局約束時才值得；`eui.Group` 會在子項增刪時自動 `invalidateSize()`，滾輪每半格搬 Icon 會一直觸發測量，**對 Slot 是純負擔** |

`eui.Group` 的自動失效來自 `implementUIComponent(Group, egret.DisplayObjectContainer, true)`（見 `Egret-EUI-Group-vs-DisplayObjectContainer.md`）。滾輪每秒搬幾十次 Icon，選 A 或 B 才不會每次都跑一輪 measure。

> **實作走的是第四條，本節的推薦沒有被採用。** `BaseReel extends eui.Component`（`BaseSlotMachine` 也是，見主線 doc 決議 36），但 Icon **不掛在它身上** —— 收在內部一個普通 `DisplayObjectContainer`（決議 38）。這樣同時拿到「可以出現在 UI Editor 的 Custom 面板」與「Icon 重排不觸發測量」。
>
> 補查確認 `eui.Component` 與 `eui.Group` 註冊時都傳 `isContainer = true`（`Component.ts:1023`、`Group.ts:905`），所以本節對 `Group` 的警告對 `Component` 一樣成立 —— 這是把 Icon 內移的直接理由。

### 2.2 `BaseReelIcon` 該繼承誰？

`BaseReelIcon` 目前做三件事：綁 `SymbolData`、套位置、套 contentSize。

建議 **`extends eui.Component`**（`components/Component.ts:79`），因為它是唯一能吃 `skinName` 的類別 —— 這是 Prefab 的替代品：

```ts
// components/Component.ts:160-164
public get skinName(): any { ... }
public set skinName(value: any) { ... }
```

如果 Icon 的美術不需要 exml（只是一張 Bitmap），那直接 `extends egret.DisplayObjectContainer` 更省。

---

## 3. 座標系與錨點（會靜默出錯的一項）

### 3.1 Y 軸方向相反

Egret 是螢幕座標：**原點左上、Y 軸向下**。證據（eui 垂直佈局由上往下排，y 遞增）：

```ts
// src/extension/eui/layouts/VerticalLayout.ts:147, 295
let y = paddingT;
...
y += dy + gap;
```

Cocos 是 Y 軸向上。所以 `ReelIconManager` 裡這兩個方向常數要重新推導：

```ts
// ReelIconManager.ts:58-72（Cocos 版）
public get movementSign(): 1 | -1 {
    return this._inverseDirection ? 1 : -1;
}
private get displayOrderSign(): 1 | -1 {
    return this._layoutType === ReelIconDirection.Vertical ? -1 : 1;
}
```

`displayOrderSign` 在垂直時是 `-1`（Cocos：畫面由上到下 = y 遞減）。**在 Egret 要改成 `+1`**（畫面由上到下 = y 遞增），水平仍是 `+1`。

也就是說垂直與水平在 Egret 下 `displayOrderSign` 都是 `+1` —— 這個常數可以直接刪掉。而 `movementSign`（正常由上往下滾 = y 遞增）預設要變成 `+1`，`inverseDirection` 時是 `-1`，正好與 Cocos 版相反。

> 移植時最省事的做法：把 `displayOrderSign` 與 `movementSign` 這兩個 getter 當成整份程式唯一的方向來源（現在已經是了），只改這兩處，其餘幾何判斷（`canHandoffExitBuffer`、`getEntryBufferRuntimes`、`isAligned`）不用動。`getVisibleTopEdge()` / `getVisibleBottomEdge()` 的命名在 Egret 下會語意相反，建議改名為 `getAxisMinEdge()` / `getAxisMaxEdge()`。

### 3.2 錨點是像素偏移，不是 0～1

```ts
// src/egret/display/DisplayObject.ts:379-386（$getConcatenatedMatrix 內）
let offsetX = self.$anchorOffsetX;
let offsetY = self.$anchorOffsetY;
...
matrix.$preMultiplyInto($TempMatrix.setTo(1, 0, 0, 1, -offsetX, -offsetY), matrix);
```

```ts
// src/egret/display/DisplayObject.ts:1709-1714
if (self.$anchorOffsetX != 0) { resultRect.x -= self.$anchorOffsetX; }
if (self.$anchorOffsetY != 0) { resultRect.y -= self.$anchorOffsetY; }
```

- 預設 `anchorOffsetX/Y = 0` → **原點在內容左上角**（Cocos 預設是正中央 0.5, 0.5）。
- 單位是**像素**，不是比例。

現有 `ReelIconManager` 的 `axisPosition` 全部是**以 Symbol 中心**計算的（`centerFromStart = occupiedCellsFromStart + cellSpan * 0.5`）。要維持這套數學不動，Icon 必須在換資料後同步設定：

```ts
icon.anchorOffsetY = runtime.cellSpan * cellPitch * 0.5;   // 垂直
icon.anchorOffsetX = iconWidth * 0.5;
```

**注意 1×N Symbol 換資料時 `cellSpan` 會變，`anchorOffsetY` 必須跟著重設**，否則 1×3 換成 1×1 後位置會偏半格。這是 Cocos 版不存在的新失敗點（Cocos 用比例錨點，換尺寸自動跟著走）。

> **已被後續決議取代**：基本單位改回 1×1 之後，icon node 恆為 1×1、`anchorOffset` 恆為 `cellPitch / 2` 這個**常數**，span 的差異推到美術子物件的偏移上，此失敗點消失。
> 見 [Slot-Base-Unit-Refactor-1x1.md](Slot-Base-Unit-Refactor-1x1.md) §2.7。本節其餘關於 `anchorOffset` 是像素偏移、預設在左上角的說明仍然有效。

---

## 4. `width` / `height` 有三種語意

| 類別 | `width` 寫入的效果 | 出處 |
|---|---|---|
| `egret.DisplayObject` / `DisplayObjectContainer` | **只存進 `$explicitWidth`，對顯示毫無影響** | `DisplayObject.ts:880-885` |
| `egret.Bitmap` | 真的改變繪製寬度 | `Bitmap.ts:462` |
| `eui.UIComponent` / `eui.Group` / `eui.Component` | 觸發 invalidate，下一輪 validate 真正重佈局 | `UIComponent.ts:1221` |

```ts
// src/egret/display/DisplayObject.ts:865-885
$getWidth(): number {
    return isNaN(self.$explicitWidth) ? self.$getOriginalBounds().width : self.$explicitWidth;
}
$explicitWidth: number = NaN;
$setWidth(value: number): void {
    if (this.$explicitWidth == value) { return; }
    this.$explicitWidth = value;          // 就這樣，沒別的了
}
```

### 對 Slot 的結論

`BaseReelIcon.applyLayout()` 現在做的 `transform.setContentSize(layout.width, layout.height)`，在 Egret 下**不能靠設 `width/height` 達成**（除非 Icon 是 `eui.Component`）。

實務上 Slot 也**不需要**改 Icon 容器的尺寸 —— 尺寸只是給 mask／點擊用。建議改成：

- Icon 容器：不設 width/height，只設 `x/y` 與 `anchorOffsetX/Y`。
- 真正要改大小的是裡面那張 `egret.Bitmap`（或 exml skin 裡的 `eui.Image`），那裡設 `width/height` 才有效。
- `ReelIconLayout.width/height` 保留當作「這張 Icon 佔幾格」的資訊傳給遊戲端 Hook，不再直接當成 contentSize 套用。

---

## 5. 顯示層級（displayPriority）

Cocos 版用 `node.setSiblingIndex(index)` 實作 `displayPriority` → `ReelIconManager.sortIconDisplayLayers()`。

Egret 有兩條路：

```ts
// src/egret/display/DisplayObjectContainer.ts:502
public setChildIndex(child: DisplayObject, index: number): void
```

```ts
// src/egret/display/DisplayObject.ts:2350-2365, 2382-2392
public set zIndex(value: number) { ...; this.parent.$sortDirty = true; }
public set sortableChildren(value: boolean) { ... }
```

```ts
// src/egret/display/DisplayObjectContainer.ts:867-888
public sortChildren(): void {
    ...
    if (sortRequired && children.length > 1) {
        children.sort(this._sortChildrenFunc);   // ← 直接重排 $children 陣列
    }
}
```

**建議用 `setChildIndex`**，理由：

- 與現有 `sortIconDisplayLayers()` 一對一對應，邏輯不用改。
- `sortableChildren + zIndex` 會**實際重排 `$children` 陣列**，之後 `getChildIndex()` 的結果就變了；`ReelIconManager` 自己維護 `_icons` 陣列，兩套順序並存容易混淆。
- `zIndex` 走 `$sortDirty`，排序時機由引擎決定，除錯時比較難對。

---

## 6. 顯示區裁切（Mask）

Cocos 用 `Mask` component。Egret 兩條路：

```ts
// src/egret/display/DisplayObject.ts:1497-1502
public get mask(): DisplayObject | Rectangle
public set mask(value: DisplayObject | Rectangle)
```

```ts
// src/egret/display/DisplayObject.ts:1349
public get scrollRect(): Rectangle
```

- `mask = new egret.Rectangle(x, y, w, h)` —— 最簡單，矩形裁切。
- `scrollRect` 也能裁，但它同時是捲動視窗（改 `x/y` 會捲動內容），對 Slot 是多餘語意。

**建議：Reel 容器設 `mask = Rectangle`。** 注意 Egret 的 Rectangle 是**值拷貝**（`$setScrollRect` 內 `copyFrom`），改了 Rectangle 物件後必須重新賦值才生效，engine 註解有明講：

> 注意：要改变一个显示对象 scrollRect 属性的值，您必引用整个 scrollRect 对象，然后将它重新赋值给显示对象的 scrollRect 属性。
> （`DisplayObject.ts:1337`）

---

## 7. `scheduleOnce` 的替代品

`BaseSlotMachine.waitSeconds()` 目前用 `this.scheduleOnce(cb, seconds)`。Egret **沒有 `setTimeout` 包裝**，只有：

```ts
// src/egret/utils/Timer.ts:54, 247
export class Timer extends EventDispatcher { ... }
$update(timeStamp: number): boolean {
    let deltaTime = timeStamp - this.lastTimeStamp;
    if (deltaTime >= this._delay) { ... }
    ...
    egret.TimerEvent.dispatchTimerEvent(this, egret.TimerEvent.TIMER);
}
```

`egret.Timer` 一樣由心跳推進，精度就是一幀。

**但更好的做法是：連 Timer 都不要用。** 錯開啟動（`startDelaySeconds`）改成在同一個 tick 迴圈裡用累積時間判斷：

```ts
this._elapsed += deltaTime;
while (this._nextReelIndex < timings.length
       && this._elapsed >= this._startAtSeconds[this._nextReelIndex]) {
    this.startOneReel(timings[this._nextReelIndex++]);
}
```

理由：現在 Cocos 版的 `scheduleOnce` 與 `updateMovement` 是兩個不同的時間源，Turbo 同步停輪對 half-Cell 相位敏感，同一個 deltaTime 累積器才能保證各軸相位可預測。移植正好是修掉這個隱患的時機。

---

## 8. Promise / async-await 可以留

Egret 專案模板：

```json
// tools/templates/empty/tsconfig.json
"target": "es5",
"lib": ["es5", "dom", "es2015.promise"],
"experimentalDecorators": true
```

且 `Eui_test/egretProperties.json` 已經掛了 `promise` 模組（`build/promise`）。

所以 `waitForStoppedAsync()`、`Promise.all()`、`async stopSpin()` **全部可以原封不動保留**。

---

## 9. 逐檔移植對照

| Cocos 檔案 | 行數 | 移植難度 | 說明 |
|---|---|---|---|
| `Internal/BaseMovement.ts` | 334 | **零** | 純數值，一行不用改 |
| `Internal/ReelDataList.ts` | 167 | **零** | 純資料 |
| `Internal/ReelDataFlow.ts` | 452 | **零** | 純資料 |
| `Internal/ReelStopFlow.ts` | 390 | **零** | 純時間計算 |
| `Data/ReelSymbolRegistry.ts` | 79 | **零** | |
| `Data/SymbolData.ts` | 18 | **零** | |
| `Runtime/ReelState.ts`、`ReelStopPlan.ts` | 85 | **零** | |
| `Internal/ReelBounce.ts` | 231 | **零** | 自製 Easing，不依賴 cc.Tween |
| `Config/*.ts` | 182 | 小 | 把 `import type { Node, Prefab } from "cc"` 換成 Egret 型別；`ReelIconDirection` 的 `Enum()` 裝飾器刪掉 |
| `Core/Reel/BaseReelIcon.ts` | 142 | 中 | `Component` → `eui.Component`／`DisplayObjectContainer`；`applyLayout` 改寫（第 3、4 節） |
| `Core/Reel/Internal/ReelIconManager.ts` | 1029 | **高** | 方向常數反轉、`anchorOffset` 維護、`setChildIndex`、`instantiate` → `new`（第 3、4、5 節） |
| `Core/Reel/BaseReel.ts` | 1440 | 中 | 去掉 `Component`／`@property`／`update()`／`onDestroy()`；其餘流程不動 |
| `Core/BaseSlotMachine.ts` | 1047 | 中 | 去掉 `Component`；`scheduleOnce` → tick 累積（第 7 節）；新增唯一的 `startTick` 註冊 |
| `SprComp.ts`、`ReelTest/`、`SlotMachineTest/` | — | 重寫 | 測試場景改成 Egret 的 `Main.ts` + exml |

**真正要動腦的只有 `ReelIconManager`。** 它是唯一同時碰幾何與引擎 API 的檔案。

---

## 10. 建議移植順序

1. 建立 Egret 專案骨架（複製 `Eui_test` 的 `egretProperties.json` / `tsconfig.json`），掛 egret + eui + tween + promise 模組。
2. **先搬零修改的八個純 TS 檔**，用 `tsc --noEmit` 確認編得過。
3. 寫一個**不含任何顯示**的 `ReelIconManager` 數值版，把方向常數改成 Egret 的 Y-down，用純 TS 斷言驗證 1×1／1×2／1×3 混合的初始排列與 Handoff 幾何（Cocos 版當初的 Phase 4 verification 就是這樣做的，可以照抄那份測項）。
4. 再接 Egret 顯示：Icon 容器 + `anchorOffset` + `mask`。
5. `BaseReel` 改成非 Component 版，`updateMode` 只留 External。
6. `BaseSlotMachine` 加 `startTick`，錯開啟動改成累積時間。
7. 最後才做多軸場景與 Turbo 同步停輪驗證。

---

## 11. 尚未查證

以下這次沒有讀到，實作前要再查：

- **Egret 的資源載入**：`RES.getRes()` 與 `assetsmanager` 兩套並存，`SprComp.setSymbolId()` 對應要用哪一套還沒確認。
- **物件池**：egret-core 原始碼內**搜不到任何內建 Pool 類別**（`grep -rln "class.*Pool" src/` 無命中）。Symbol Prefab 池要自己寫，或找第三方。目前框架「不採用 Node Pool」的決定在 Egret 下同樣成立。
- **`egret.Bitmap` 的 `fillMode` / scale9** 對 1×N Symbol 拉伸的實際行為。
- ~~**Egret UI Editor 對自訂 `BaseReel` 的面板支援**~~ → 已於 [Egret-Slot-Exml-Editable-Surface.md](Egret-Slot-Exml-Editable-Surface.md) 查證完畢。結論：`BaseReel` 維持純 class，另外做一層 `ReelView extends eui.Group` 當可編輯的殼，Icon 掛在殼內的普通 `DisplayObjectContainer`，避開 `eui.Group` 的 `$childAdded` 失效（`UIComponent.ts:1858-1867`）。第 2.1 節的「方案 A」因此成立。
- **`nativeRender` 模式**下 `anchorOffset`、`mask`、`sortChildren` 的行為分支（本文引用的都是 web 非 native 路徑）。
- **背景分頁恢復後的第一個 deltaTime 實測值**，以及 deltaTime 鉗制上限要設多少。
