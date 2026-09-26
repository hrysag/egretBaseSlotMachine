import { BaseReelIcon } from "../SlotMachine/Core/Reel/BaseReelIcon";
import { ReelIconCell } from "../SlotMachine/Core/Reel/Data/ReelData";
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
 * `ReelIconLayout` 只帶 `x` / `y` / `index`，**不帶方向** ——
 * 框架刻意讓 Icon 不必知道 Reel 是垂直或水平、正向或反向。
 * 但 head 的大圖必須「往退場方向」延伸，這件事 Icon 自己算不出來，
 * 所以由建立它的那一方（知道 Reel 設定的 factory）在建構時告知。
 *
 * 這是移植後才浮現的缺口，記在這裡而不是繞過去。
 *
 * ## 尺寸為什麼放在 onCellChanged()
 *
 * 大圖的尺寸與偏移只有這一格換人時才會變，位置卻每幀都在變。
 * 框架把兩件事拆成 `onCellChanged()`（換人才觸發）與
 * `onLayoutChanged()`（每幀觸發），所以昂貴的計算放前者。
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

    /** 換資料時只換圖，尺寸與偏移交給 onCellChanged()。 */
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
     *
     * cellSpan 由框架從 ReelSymbolRegistry 取來一併帶進，
     * 不必再查 TestSymbolTable。
     */
    protected onCellChanged(cell: ReelIconCell): void {
        const art = this._art;

        if (art === undefined) {
            return;
        }

        if (cell.groupOffset !== 0) {
            art.visible = false;
            return;
        }

        const pitch = this.cellPitch;
        const axisLength = cell.cellSpan * pitch;

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
            /*
             * egret 的 d.ts 把 Bitmap.texture 宣告成 Texture（少了 | null），
             * 但執行期吃 null 就是清圖。null! 的型別是 never，可指派給任何
             * 型別，行為一個位元都不變。
             */
            this._art.texture = null!;
            this._art.visible = false;
        }
    }
}
