/**
 * 純 TS 測試用的最小 egret／eui 替身。
 *
 * Core 自階段 6 起會 import Egret（`BaseReelIcon extends eui.Component`），
 * 因此在 node 下執行測試時必須先把這兩個全域補上，否則載入模組的當下
 * 就會因為 `eui.Component` 不存在而爆掉。
 *
 * 只實作測試會碰到的成員 —— 位置、尺寸、錨點與子項管理。
 * 型別檢查仍然使用 libs/ 底下真正的 egret.d.ts / eui.d.ts，
 * 所以這裡少實作的成員不會被誤用而無聲通過。
 *
 * 對照：Cocos 版當初也是用同樣手法，只是 stub 的對象是 `cc`。
 *
 * 必須是測試檔的**第一個** import —— `class X extends eui.Component`
 * 會在模組載入當下就求值。
 */

class StubDisplayObject {
    public x = 0;
    public y = 0;
    public width = 0;
    public height = 0;
    public anchorOffsetX = 0;
    public anchorOffsetY = 0;
    public visible = true;
    public parent: StubDisplayObjectContainer | null = null;
}

class StubDisplayObjectContainer extends StubDisplayObject {
    private readonly _children: StubDisplayObject[] = [];

    public get numChildren(): number {
        return this._children.length;
    }

    public addChild(child: StubDisplayObject): StubDisplayObject {
        child.parent = this;
        this._children.push(child);
        return child;
    }

    public removeChild(child: StubDisplayObject): StubDisplayObject {
        const index = this._children.indexOf(child);

        if (index >= 0) {
            this._children.splice(index, 1);
        }

        child.parent = null;
        return child;
    }

    public getChildAt(index: number): StubDisplayObject {
        return this._children[index];
    }

    public getChildIndex(child: StubDisplayObject): number {
        return this._children.indexOf(child);
    }

    public setChildIndex(
        child: StubDisplayObject,
        index: number,
    ): void {
        const current = this._children.indexOf(child);

        if (current < 0) {
            return;
        }

        this._children.splice(current, 1);
        this._children.splice(index, 0, child);
    }
}

class StubRectangle {
    public constructor(
        public x = 0,
        public y = 0,
        public width = 0,
        public height = 0,
    ) {}
}

/*
 * 用 Function 取得全域物件，而不是 globalThis ——
 * globalThis 是 TS 3.4／ES2020 才有的東西，而本專案的語法基準是
 * 引擎自帶編譯器 typescript-plus 2.4.2（egret clean 會用到）。
 * 雖然 tests/ 不在 tsconfig 的 include 裡、不會被 egret 編到，
 * 但整個專案只維持一套語法標準，才不會有人不小心把它加進來就炸掉。
 */
const globalScope: { egret?: any; eui?: any } =
    (new Function("return this"))();

globalScope.egret = {
    DisplayObject: StubDisplayObject,
    DisplayObjectContainer: StubDisplayObjectContainer,
    Rectangle: StubRectangle,
};

globalScope.eui = {
    Component: StubDisplayObjectContainer,
};

export {};
