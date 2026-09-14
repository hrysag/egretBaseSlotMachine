import { BaseReelIcon } from "../SlotMachine/Core/Reel/BaseReelIcon";
import { ReelIconLayout } from "../SlotMachine/Core/Reel/Data/ReelData";
import { SymbolData } from "../SlotMachine/Core/Reel/Data/SymbolData";
import {
    getTestSymbol,
    TEST_COLUMN_WIDTH,
} from "./TestSymbolTable";

/**
 * 測試場景用的 Icon 載體。
 *
 * 載體本身恆為 1×1（由 BaseReelIcon 在 setupCell() 定案，尺寸與
 * anchorOffset 都是 cellPitch 的常數倍），大圖是它的**子物件**。
 *
 * ## 為什麼要傳 exitTowardPositiveAxis
 *
 * `ReelIconLayout` 只帶 `x` / `y` / `groupOffset`，**不帶方向** ——
 * 框架刻意讓 Icon 不必知道 Reel 是垂直或水平、正向或反向。
 * 但 head 的大圖必須「往退場方向」延伸，這件事 Icon 自己算不出來，
 * 所以由建立它的那一方（知道 Reel 設定的 factory）在建構時告知。
 *
 * 這是移植後才浮現的缺口，記在這裡而不是繞過去。
 */
export class TestReelIcon extends BaseReelIcon {

    private _art?: egret.Bitmap;

    /**
     * @param exitTowardPositiveAxis
     *        退場方向是否為局部座標的正向。垂直正滾（上進下出）為 true，
     *        反向（下進上出）為 false。
     */
    public constructor(
        private readonly _exitTowardPositiveAxis: boolean,
        private readonly _vertical: boolean,
    ) {
        super();
    }

    /** 尺寸定案時建好 Bitmap，之後只換 texture 與高度，不重建。 */
    protected onCellSetup(cellPitch: number): void {
        const art = new egret.Bitmap();
        art.fillMode = egret.BitmapFillMode.SCALE;
        this.addChild(art);
        this._art = art;
    }

    /** 換資料時只換圖，尺寸與偏移交給 onLayoutChanged()。 */
    protected onDataChanged(
        data: SymbolData,
        previousData?: SymbolData,
    ): void {
        if (this._art === undefined) {
            return;
        }

        this._art.texture = RES.getRes(getTestSymbol(data.id).resKey);
    }

    /**
     * follower 不畫；head 畫一張 cellSpan × cellPitch 的圖，
     * 從自己這一格起往退場方向延伸。
     */
    protected onLayoutChanged(layout: ReelIconLayout): void {
        const art = this._art;
        const data = this.data;

        if (art === undefined || data === undefined) {
            return;
        }

        if (layout.groupOffset !== 0) {
            art.visible = false;
            return;
        }

        const span = getTestSymbol(data.id).cellSpan;
        const pitch = this.cellPitch;
        const axisLength = span * pitch;

        art.visible = true;

        if (this._vertical) {
            art.width = TEST_COLUMN_WIDTH;
            art.height = axisLength;
            art.x = (pitch - TEST_COLUMN_WIDTH) * 0.5;
            art.y = this._exitTowardPositiveAxis
                ? 0
                : pitch - axisLength;
        } else {
            art.width = axisLength;
            art.height = TEST_COLUMN_WIDTH;
            art.y = (pitch - TEST_COLUMN_WIDTH) * 0.5;
            art.x = this._exitTowardPositiveAxis
                ? 0
                : pitch - axisLength;
        }
    }

    protected onResetIcon(previousData?: SymbolData): void {
        if (this._art !== undefined) {
            this._art.texture = null;
            this._art.visible = false;
        }
    }
}
