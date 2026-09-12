# ReelTemplate v3 原始碼研讀：Game1016 與 Game1024 的實際用法

> 來源：
> - `D:\Tools\project\Game1016\Web_Slot`（Cocos Creator，5 軸傳統滾輪）
> - `D:\Tools\project\Game1024`（Cocos Creator，7 軸巢狀掉落式）
> - 共用底層：`assets\Scripts\GameScripts\ReelTemplate\v3`
>
> 姊妹文件：[Cocos-To-Egret-Slot-Port-Map.md](Cocos-To-Egret-Slot-Port-Map.md)、[Egret-Slot-Exml-Editable-Surface.md](Egret-Slot-Exml-Editable-Surface.md)
> 本文所有行號皆以 `Game1024` 底下的 v3 為準（兩專案 v3 內容相同，見 §1）。

---

## 0. 一句話

v3 是一套**只有 3,654 行、且兩個專案一字未改**的共用底層；但它硬性假設「所有 Icon 等高」與「Icon 自己帶 Movement」，
導致 **Game1016 在遊戲層堆了 5,060 行、Game1024 堆了 2,451 行**去繞過這兩個假設 —— 而且兩家繞法完全不同、互不相容。

這正是新 Framework 要用 `cellSpan` 與「Reel 統一推進」取代的東西。

---

## 1. 兩個專案的 v3 完全相同

```bash
diff -r Game1016/Web_Slot/assets/Scripts/GameScripts/ReelTemplate/v3 \
        Game1024/assets/Scripts/GameScripts/ReelTemplate/v3 --brief
```

只有三個檔案「不同」，實際差異是：

| 檔案 | 差異 |
|---|---|
| `Scripts/UniReel.ts` | 第 388 行：1016 留了一行 `//console.log('check moveOutIndex', ...)`，1024 是空行 |
| `Scripts/UniReelView.ts` | 第 136 行：1016 多一個空行 |
| `Scripts/UniSlotMachine.ts` | 1016 的 `init()` 註解多一行 `//@ignore`；其餘整檔因換行符不同而整片 diff |

**結論：v3 是未經修改的共用模板。** 兩款遊戲的所有差異都在各自的 `Game1016/Script/Slot`、`Game1024/Script/Slot` 子類別裡。

`D:\Tools\project\NewDev0327` 底下也有同一份 v3（本次未細看）。

---

## 2. v3 的檔案結構

```text
v3/
├─ index.ts
├─ Scripts/
│  ├─ UniReel.ts               561   單軸核心
│  ├─ UniReelView.ts           306   多軸協調、聽牌
│  ├─ UniSlotMachine.ts        191   對外門面、滾動時間、急停旗標
│  ├─ UniIconBase.ts            65   Icon 載體（繼承 UniMovement）
│  ├─ Movement/UniMovement.ts  537   移動指令 Queue
│  ├─ Interface/{IReel,IDropReel,SymbolBase}.ts
│  └─ DropReel/                       掉落式變體（舊筆記沒提到）
│     ├─ UniDropReel.ts        183
│     ├─ UniDropReelView.ts     80
│     ├─ UniDropSlotMachine.ts  43
│     └─ UniDropIconBase.ts     26
└─ Example/                            1,400 行範例與測試場景腳本
```

正式底層只有約 2,250 行，其餘是 Example。

---

## 3. UniReel 的核心機制

### 3.1 Icon List 的五步循環

`UniReel.ts:36-88` 的 class 註解把整個滾動循環畫了出來，實作在 `moveOnce()`：

```ts
// Scripts/UniReel.ts:374-395
protected moveOnce(): void {
    this.onMoveOnceStart?.();

    let moveOutIndex = this.inverseDirection ? 0 : this.iconList.length - 1;

    for (let i = 0; i < this._iconList.length; ++i) {
        this._iconList[i].moveBy(this.deltaDis, this.moveInterval * 0.5);   // ① 前半格

        if (i === moveOutIndex) {
            this._iconList[i].moveTo(this.topPos, 0);                       // ② 出場的那張瞬移到頂
            this._iconList[i].addCallback(this.setIconData.bind(this));     // ③ 換資料
        }

        this._iconList[i].moveBy(this.deltaDis, this.moveInterval * 0.5);   // ④ 後半格

        if (i === moveOutIndex) {
            this._iconList[i].addCallback(this.moveOnceComplete.bind(this));
        }
    }
}
```

重點：

- **每張 Icon 各自被排入指令**（`for` 迴圈跑完全部 Icon），不是整軸推進一個數值。
- **出場的一定是陣列頭或尾**，由 `inverseDirection` 決定，**不做幾何判斷**。
- 換資料的時機**固定在半格**，沒有「完全離開顯示區才交接」的檢查。

### 3.2 `topPos` 是固定值 —— 這就是等高假設的來源

```ts
// Scripts/UniReel.ts:202-205
public get topPos(): Vec3 {
    let dir = this.inverseDirection ? -1 : 1;
    return this.iconDis.multiplyScalar(0.5 * this.iconList.length * dir);
}
```

```ts
// Scripts/UniReel.ts:556-561
protected initLayout(): void {
    for (let i = 0; i < this.iconList.length; i++) {
        let pos = this.iconDis.multiplyScalar(0.5 * (this.iconList.length - 1) - i);
        this.iconList[i].node.setPosition(pos);
    }
}
```

`iconDis` 來自單一的 `moveDis = iconSize + iconSpacing`（`UniReel.ts:172-176`）。
**整條軸只有一個尺寸**，排版與回收位置全部從它算出來 —— 任何非等高 Symbol 都會立刻破版。

### 3.3 停止判斷只在完整一格後、且只看三種條件

```ts
// Scripts/UniReel.ts:406-421
protected moveOnceComplete(move: UniMovement): void {
    this.reArrangeIcon();
    this.changeSibling(this._iconList);
    this.onMoveOnceComplete?.();

    if (this._stopType === StopType.Immediate ||
        (this._stopType === StopType.RunoutData && this.data.count === 0) ||
        (this._stopType === StopType.StopBySymbol && this.dequeueSymbol !== null && this.dequeueSymbol.stopSymbol)) {
        this.onStopRoll?.();
        this.waitForRollComplete?.();
    }
    else {
        this.moveOnce();
    }
}
```

**`RunoutData` 就是「Queue 空了就停」** —— 沒有任何「正式結果是否真的對齊可視區」的驗證。
盤面對不對，完全靠遊戲層把資料排對順序。這正是新 Framework 明確否決的那一條。

### 3.4 陣列輪轉與層級

```ts
// Scripts/UniReel.ts:483-490
protected reArrangeIcon(): void {
    if (this.inverseDirection) { let firstIcon = this._iconList.shift(); this._iconList.push(firstIcon); }
    else                       { let lastIcon  = this._iconList.pop();   this._iconList.unshift(lastIcon); }
}
```

```ts
// Scripts/UniReel.ts:506-511
protected changeSibling(icons: Icon[]): void {
    for (let index = 0; index < icons.length; index++) {
        icons[index].siblingIndex = index;      // UniIconBase.siblingIndex setter → node.setSiblingIndex()
    }
}
```

`siblingIndex` **直接等於陣列索引**，沒有 displayPriority 的概念。1016 為了讓大 Symbol 蓋住鄰居，只好整個 override（`UniReel1016.ts:1414 changeSibling`）並自己寫 `processSortIcons()`。

### 3.5 資料來源

```ts
// Scripts/UniReel.ts:461-471
protected getData(): S {
    if (this.data.count > 0) { this.dequeueSymbol = this.data.dequeue(); }
    else                     { this.dequeueSymbol = this.createRandomSymbol(); }
    return this.dequeueSymbol;
}
```

`data` 是 `Queue<S>`（`UniReel.ts:147`），`createRandomSymbol()` / `destroySymbol()` 是 abstract，強迫遊戲層實作物件池回收。

---

## 4. UniMovement 的 `_leftDeltaTime`

這是 v3 唯一值得原樣保留、也確實被新 Framework 保留下來的機制：

```ts
// Scripts/Movement/UniMovement.ts:377-398
private _updateMoveParams(): void {
    if (this._curParam !== null) {
        if (this._curParam.remainDuration > this._leftDeltaTime) {
            this._curParam.curTime += this._leftDeltaTime;
            this._leftDeltaTime = 0.0;
        } else {
            this._leftDeltaTime -= this._curParam.remainDuration;     // ← 沒吃完的時間留給下一個指令
            this._curParam.curTime = this._curParam.duration;
        }
        if (this._curParam.isDone) { this._onMoveComplete(); }
    }
    this._updateCurParam();
    if (this._curParam !== null && this._leftDeltaTime > 0.0) {
        this._updateMoveParams();                                     // ← 同一幀可完成多個指令
    }
}
```

指令完成時**精確校正到終點**，不累積浮點誤差：

```ts
// Scripts/Movement/UniMovement.ts:414-420
else if (this._curParam.isLocal) { this.node.setPosition(this._curParam.endPos); }
else                             { this.node.setWorldPosition(this._curParam.endPos); }
```

一個容易忽略的坑，v3 自己也踩到並留了 workaround：

```ts
// Scripts/Movement/UniMovement.ts:506-508
/** 在下一次開始滾動表演時，需要將剩餘的deltaTime清空 */
public clearLeftDeltaTime(): void { this._leftDeltaTime = 0.0; }
```

`UniReel.startRoll()`（`UniReel.ts:300-306`）必須先 `resetMovements()` 才能 `moveOnce()`，否則上一輪殘留的 `_leftDeltaTime` 會讓新一輪第一格瞬移。

> 新 Framework 的 `BaseMovement` 把這件事變成單一數值軸而非每個 Node 一份，所以只需要清一次。

---

## 5. UniReelView / UniSlotMachine 的多軸與停輪

### 5.1 錯開啟動是 `await` 一個 `scheduleOnce`

```ts
// Scripts/UniReelView.ts:121-133
public async startRoll(reelIDs: number[] = this._defaultRollingReelIDs): Promise<void> {
    this.reset();
    this._currentRollingReelIDs = reelIDs;
    for (let index = 0; index < this._currentRollingReelIDs.length; index++) {
        let reelID = this._currentRollingReelIDs[index];
        this.reelList[reelID].startRoll();
        if (this.startSpaceTime >= 0 && !this.isFastModeCallback()) {
            await this.waitStartSpace(this.startSpaceTime);           // scheduleOnce → UniReelView.ts:299
        }
    }
}
```

與新 Framework 的 `BaseSlotMachine.startReelsSequentially()` 幾乎一模一樣 —— 包含同一個隱患：**啟動時序與 Movement 時序是兩個不同的時間源**。

### 5.2 停輪順序完全由「資料長度」決定

`UniReelView.stopRoll()`（`UniReelView.ts:141-155`）對所有軸**同時**呼叫 `stopOneReel()`，
各軸何時真的停下來，只取決於各自 Queue 裡還有幾筆資料。v3 本身**沒有任何時間參數**。

### 5.3 聽牌只是「前一軸停了才檢查下一軸」

```ts
// Scripts/UniReelView.ts:271-281
protected oneReelRollEnd(reelID: number): void {
    this.checkHideReadyHand(reelID);
    let index = this.currentRollingReelIDs.indexOf(reelID);
    if (index + 1 < this.currentRollingReelIDs.length) {
        this.checkShowReadyHand(this.currentRollingReelIDs[index + 1]);
    }
}
```

聽牌**不影響停輪時間**，只負責開關特效。要讓聽牌軸多轉幾秒，得由遊戲層自己多塞資料。

### 5.4 `UniSlotMachine` 只管「最低滾動時間」

```ts
// Scripts/UniSlotMachine.ts:155-172
protected async canStopRoll(): Promise<void> {
    return new Promise<void>((resolve) => {
        let callback = () => {
            let standardTime: number = this.isFastMode() ? this._fastRollTime : this._normalRollTime;
            standardTime *= 1000;
            let fillTime: boolean = game.totalTime - this._startTime >= standardTime;
            let receiveData: boolean = this._iconResultData.length > 0;
            if (fillTime && receiveData && this._startRoll) {
                this.unschedule(callback); this._canStop = true; resolve();
            }
        };
        this.schedule(callback, 0, macro.REPEAT_FOREVER);
    });
}
```

門面層只保證「轉夠久」與「拿到結果」，**每軸停在第幾秒完全不管**。

---

## 6. v3 的四個硬性限制

| 限制 | 出處 | 後果 |
|---|---|---|
| 所有 Icon 必須等高 | `topPos`（`UniReel.ts:202`）、`initLayout`（`:556`）、`moveDis`（`:172`） | 無法原生支援 1×N |
| 出場 Icon 固定是陣列頭／尾 | `moveOnce`（`:376`） | 沒有幾何交接判斷 |
| 每張 Icon 自帶 Movement | `UniIconBase extends UniMovement`（`UniIconBase.ts:10`） | N 張 Icon × M 個指令的狀態要同步 |
| 停止＝Queue 空 | `moveOnceComplete`（`:412`） | 沒有結果對齊驗證，時間只能靠資料量反推 |

---

## 7. 兩款遊戲怎麼繞過去

### 7.1 程式量對比

| | v3 底層 | 遊戲層 Slot 資料夾 | 倍率 |
|---|---:|---:|---:|
| **Game1016** | 561（UniReel） | `UniReel1016` 2,043 + `UniReelView1016` 1,565 + `UniIcon1016` 831 + `UniSlotMachine1016` 621 = **5,060** | **9.0×** |
| **Game1024** | 561 | `UniReel1024` 618 + `UniDropReel1024` 746 + `UniReelView1024` 363 + `UniSlotMachine1024` 376 + `UniDropIcon1024` 348 = **2,451** | 4.4× |

### 7.2 Game1016：用「補牌」硬撐大 Symbol，用巨型公式算停輪時間

急停就是從 Queue 前端砍到只剩保護尾段：

```ts
// Game1016/Script/Slot/UniReel1016.ts:496-514
public override fastStopRoll(): void {
    if (this._flagForFastStop) return;
    this._flagForFastStop = true;
    let dataKeepCount = this._iconAmount + 1 + this._endCardCount;
    while (this.data.count > dataKeepCount) { this.data.dequeue(); }
}
```

註解自己說明了為什麼 `+1` 而不是 v3 原版的 `+2`：

> 因為在createIcon的時候多做了4個預備牌
> PS:(下面多3個+原本的預備牌1個=4)+1個上面預備牌=6張牌(包含上下兩個預備牌)

也就是說，**為了讓 Wild 這種跨格 Symbol 進得來，1016 直接把預備 Icon 從 2 張加到 5 張**，然後所有相關公式都要跟著改。

停輪時間的換算在 `UniReelView1016.calculateRandomDataLength()`（`UniReelView1016.ts:1273-1525`，**252 行**），一次要考慮：

```text
停軸順序 index、聽牌集合 readySet、GameState（NORMAL / RE_SPINE）、
每軸鎖定狀態 lockStatus、前面有幾軸鎖定 beforeNowLocks、前面有幾軸聽牌 prevReadyCount、
本輪進場補牌 extraCardsNumberEnd、上一輪留下的出場補牌 upConsecutiveExtraCardsData、
delayStopTime、readyHandTime、moveInterval
```

最後才換算成資料筆數：

```ts
// Game1016/Script/Slot/UniReelView1016.ts:1496
const dataLength = Math.ceil(totalTime / moveInterval);
```

檔案裡充滿被註解掉的前幾版公式與 `//--20251104-TODO-聽牌要再修過-補牌後有點超過一軸2秒`。
**這 252 行就是新 Framework「企劃給秒數、Framework 自己量化成 Cell」要取代的東西。**

### 7.3 Game1024：巢狀滾輪 + 用縮放假裝變高

1024 的拓樸完全不同 —— **外層 Reel 的每一張「Icon」其實是一整個掉落子盤**：

```ts
// Game1024/Script/Slot/Icon/UniIcon1024.ts:44-52
public override init(reelId?: number): void {
    super.init();
    const dropReelNode = instantiate(this._dropReel_poolPrefab);
    this.node.addChild(dropReelNode);
    this._dropReel = dropReelNode.getComponent(UniDropReel1024);
    this._dropReel.setInitData(reelId);
}
```

而且 `SymbolNumber1024.symbolID` 被拿來當作**子盤的長度**：

```ts
// Game1024/Script/Slot/Icon/UniIcon1024.ts:26-29, 100-104
public override set symbol(value: SymbolNumber1024) {
    this._symbol = value;
    this.setDropReelLength(value.symbolID);     // ← symbolID 就是格數
}
private setDropReelLength(length: number): void {
    this._dropReel.changeDropReelSize(length);
    this._dropReel.reSetReelContent();
    this._dropReel.reInitIconSymbol();
}
```

它怎麼處理「格數不同」？**不是讓外層變高，而是把子盤裡的每張 Icon 縮小**：

```ts
// Game1024/Script/Slot/Reel/UniDropReel1024.ts:131-138
public changeDropReelSize(sizeLen: number): void {
    this._iconAmount = sizeLen;
    const iconSize = this._sizeMap.get(sizeLen);
    if (iconSize) { this.iconSize = iconSize; }      // ← 查表換尺寸，總高度維持不變
}
```

因此 `UniReel1024` **完全不需要 override `initLayout` / `topPos`** —— 外層依然是等高的。
它只 override 了三個方法：`createIcon`（`:110`）、`setIconData`（`:198`）、`getData`（`:218`）。

急停也比 1016 乾淨得多：

```ts
// Game1024/Script/Slot/Reel/UniReel1024.ts:102-108
public clearRandomData(): void {
    while (this.data.count > this.iconAmount + 2) {   // 維持 v3 原本的 +2
        let data = this.data.dequeue();
        this.destroySymbol(data);
    }
}
```

### 7.4 最關鍵的一點：1024 **放棄**了 1016 的停輪時間算法

```ts
// Game1024/Script/Slot/UniReelView1024.ts:98-110
protected setReelData(reelID: number, data: number[]): void {
    this.reelList[reelID].setData(data, 0);          // ← randomDataLength 固定傳 0
    /*
    let length = 0;
    if (!this.isFastModeCallback()) {
        length = this.calculateRandomDataLength(reelID);
    }
    let symbolData = this.createSymbolData(data);
    this.reelList[reelID].setData(symbolData, length);
    */
}
```

`calculateRandomDataLength` 在 1024 裡**整段被註解掉**，聽牌的 `showReadyHand` / `hideReadyHand` 也是空的（`UniReelView1024.ts:112-127`）。
滾動時間退化成一個寫死的常數：

```ts
// Game1024/Script/Slot/UniSlotMachine1024.ts:205-216
protected override async canStopRoll(): Promise<void> {
    /*
    const timeList = GlobalAccessReader.getGlobalData(GameGlobalKeys.DelayTimeList);
    const timeBase = (this.isFastMode()) ? this._fastRollTime : timeList.get(cfg => cfg.roll?.totalRoll);
    */
    //--for test
    const timeBase = 2;
    ...
}
```

**1024 目前仍在開發中（git 只有一個 `Initial commit`），時間控制尚未接回。**
但可以確定的是：面對同一套 v3，下一款遊戲寧可先把 1016 那套 252 行公式整段拿掉，也不打算沿用。

---

## 8. DropReel：v3 內建、舊筆記沒記到的第二種拓樸

`v3/Scripts/DropReel/` 提供了完整的掉落式滾輪，介面是：

```ts
// Scripts/Interface/IDropReel.ts
export interface IDropReel extends IReel {
    startDropOut(idList: number[]): void;      // 中獎的掉出去
    startDropIn(idList: number[]): void;       // 新的掉進來
    startDropRefill(removeIdList: number[]): void;  // 上方遞補
    ... 對應的 Async 版本與三個 Callback
}
```

核心是把「掉幾格」換算成一次 `moveBy`：

```ts
// Scripts/DropReel/UniDropReel.ts:64-75
protected drop(ease: EaseType = EaseType.Linear, easedValueCustom: RealCurve = null): void {
    const dropIcons = this._iconList.filter(icon => icon.dropType !== DropType.NoDrop);
    for (let i = 0; i < dropIcons.length; ++i) {
        const dropCount = this.getDropCount(dropIcons[i]);
        const dropDis = this.moveDir.clone().multiplyScalar(this.moveDis * dropCount);
        const dropTime = this.moveInterval * dropCount;
        dropIcons[i].moveBy(dropDis, dropTime, ease, easedValueCustom);
        dropIcons[i].addCallback(() => { this.dropComplete(dropIcons[i]); });
    }
}
```

`moveInterval` 在這裡是**每格時間**，掉 N 格就是 N 倍時間 —— 與新 Framework 的 Cell 時間模型一致。

新 Framework 目前完全沒有掉落式的設計。若未來要支援，這是既有、可直接參考的實作。

---

## 9. 對新 Framework 的驗證與啟示

### 9.1 被實際程式碼驗證為正確的決策

| 新 Framework 的決策 | v3 現場證據 |
|---|---|
| `cellSpan` 當一等公民 | 1016 靠加預備牌 + 補牌繞（`UniReel1016.ts:503` 註解）、1024 靠查表縮放繞（`UniDropReel1024.ts:134`）。**兩家繞法互不相容** |
| 停止必須驗證結果對齊 | v3 只有 `data.count === 0`（`UniReel.ts:412`），盤面正確性完全外包給遊戲層 |
| 企劃給秒數、Framework 量化 Cell | 1016 的 252 行 `calculateRandomDataLength` 是反例；1024 直接棄用 |
| Reel 統一推進，Icon 不帶 Movement | v3 每張 Icon 都是 `UniMovement`，`moveOnce()` 要對 N 張各排 4 個指令 |
| `displayPriority` 獨立於陣列索引 | v3 的 `siblingIndex = index`（`UniReel.ts:508`），1016 被迫整個 override |
| 保留 `_leftDeltaTime` 跨指令傳遞 | v3 唯一值得照抄的機制（`UniMovement.ts:377-398`） |
| `layoutType` + `inverseDirection` 兩個設定 | v3 原本就是這樣（`UniReel.ts:97-103`），新框架沿用是對的 |

### 9.2 新 Framework 還沒有、但 v3 有的東西

1. **DropReel 掉落式拓樸**（§8）。
2. **`StopBySymbol` 停止模式** —— 由資料裡的 `stopSymbol` 旗標決定停在哪（`UniReel.ts:414`）。新框架只有 `ResultAligned` 與 `Immediate`。
3. **`UniReel.interrupt()`** —— 不等當前格走完，直接硬停（`UniReel.ts:249-256`）。新框架的 `Immediate` 一定要走完整格。

### 9.3 移植到 Egret 時要注意的

- v3 的 `moveOnce()` 對每張 Icon 呼叫 `moveBy(Vec3, ...)`。Egret 沒有 `Vec3`，而新 Framework 的 `BaseMovement<number>` 本來就是單一數值軸 —— **這一步新框架已經先做對了**，移植時不需要處理 N 份 Movement。
- v3 的 `changeSibling` → `node.setSiblingIndex()`，在 Egret 是 `container.setChildIndex()`；但如 [Exml 文件 §3.1](Egret-Slot-Exml-Editable-Surface.md) 所述，若容器是 `eui.Group` 會觸發兩次失效，必須放在普通 `DisplayObjectContainer` 內。
- v3 的 `scheduleOnce` 錯開啟動（`UniReelView.ts:299`）在 Egret 沒有對應物，與新框架 `BaseSlotMachine.waitSeconds()` 的問題相同，一併改成 tick 累積。

---

## 10. 尚未查證

- `D:\Tools\project\NewDev0327` 底下的第三份 v3 是否真的與這兩份相同（只確認了目錄存在）。
- `D:\Tools\project\old_1016`、`new_1024`、`Web_Slot_018`、`Fishing1` 的關係與差異。
- 1016 的 `SymbolAniHandoffManager`（422 行）與 1024 的 `ICrossSystemSymbolAniService` 兩套動畫交接機制的實際差異 —— 新 Framework 目前把這塊完全排除在外，但遲早要面對。
- 1024 的 `UniDropReel1024._sizeMap` 實際內容（幾格對應多大），以及它在 Egret 下是否還需要（新框架用 `cellSpan` 就不必縮放）。
- 1016 `UniReel1016.getEndBouncePromise()` / `_endBouncePromise: Promise<number>` 的停止後表演時序，與新框架 `ReelBounce` 的差異。
- BigWings（`D:\Tools\project\BIG_wings`）這次沒讀；舊筆記的物理位移模型描述尚未在新路徑下複查。
