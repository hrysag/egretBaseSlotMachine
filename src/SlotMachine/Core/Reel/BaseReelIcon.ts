import { ReelIconLayout } from "./Data/ReelData";
import { SymbolData } from "./Data/SymbolData";
import {
    assertFiniteNumber,
} from "../Internal/NumberAssert";

/**
 * Reel 上單一 Cell 的最低限度載體。
 *
 * 繼承 eui.Component 有兩個理由：它是唯一吃得下 `skinName` 的類別
 * （exml skin 是 Cocos Prefab 的替代品），也是能出現在 Egret UI Editor
 * 「Custom」面板的前提。
 *
 * ## 尺寸與錨點恆定
 *
 * 載體**永遠是 1×1**，`anchorOffset` 永遠是 `cellPitch / 2` —— 不隨資料變動。
 * 大於一格的 Symbol 不是把載體撐大，而是由 group 的 head 在自己的子物件上
 * 畫一張 `cellSpan × cellPitch` 的圖，往退場方向偏移 `(cellSpan - 1) / 2` 格。
 *
 * 這樣「Runtime 是 1×1」一路貫徹到顯示層，也讓 Egret 的
 * `anchorOffset` 變成常數，沒有東西可以忘記重設。
 *
 * ## 本類別不做的事
 *
 * Movement、資料消耗、停止判斷、Sprite／Spine 建立、物件池。
 * 需要換圖或動畫時由遊戲類別繼承並覆寫 Hook。
 */
export class BaseReelIcon extends eui.Component {
    private _data?: SymbolData;
    private _layout?: ReelIconLayout;
    private _cellPitch = 0;

    /** Icon 目前綁定的原始 SymbolData 參考。 */
    public get data(): SymbolData | undefined {
        return this._data;
    }

    /** 最近一次套用的局部座標與 group 歸屬。 */
    public get layout(): ReelIconLayout | undefined {
        return this._layout;
    }

    /** 一個 1×1 Cell 的軸向長度。 */
    public get cellPitch(): number {
        return this._cellPitch;
    }

    /** 本格是否為 group 的 head（負責顯示整張圖）。 */
    public get isGroupHead(): boolean {
        return this._layout !== undefined
            && this._layout.groupOffset === 0;
    }

    /**
     * 由 ReelIconManager 在建立時呼叫一次。
     *
     * 尺寸與錨點在此定案，之後不再變動 —— 載體恆為 1×1。
     */
    public setupCell(cellPitch: number): void {
        if (!Number.isFinite(cellPitch) || cellPitch <= 0) {
            throw new Error(
                "cellPitch must be a positive finite number.",
            );
        }

        this._cellPitch = cellPitch;
        this.width = cellPitch;
        this.height = cellPitch;
        this.anchorOffsetX = cellPitch * 0.5;
        this.anchorOffsetY = cellPitch * 0.5;
        this.onCellSetup(cellPitch);
    }

    /**
     * 綁定一筆 SymbolData。
     *
     * 不 clone 資料，也不假設 Icon 使用 Bitmap 或 Spine。
     */
    public setData(data: SymbolData): void {
        if (data === null || data === undefined) {
            throw new Error("BaseReelIcon.setData() requires SymbolData.");
        }

        const previousData = this._data;
        this._data = data;
        this.onDataChanged(data, previousData);
    }

    /**
     * 套用由 ReelIconManager 完成方向映射後的局部座標。
     *
     * `groupOffset` 一併帶進來，遊戲類別據此決定要畫整張圖（head）
     * 還是什麼都不畫（follower）。
     */
    public applyLayout(layout: ReelIconLayout): void {
        this.validateLayout(layout);
        this._layout = layout;
        this.x = layout.x;
        this.y = layout.y;
        this.onLayoutChanged(layout);
    }

    /** 清除本輪綁定資料。 */
    public resetIcon(): void {
        const previousData = this._data;
        this._data = undefined;
        this._layout = undefined;
        this.onResetIcon(previousData);
    }

    /**
     * 尺寸定案 Hook。
     *
     * 遊戲類別可在此建立子物件（Bitmap、Spine 容器…）。
     * 建議在這裡建好、之後只換內容，不要每次換資料都重建。
     */
    protected onCellSetup(cellPitch: number): void {
        // 基礎載體不建立任何顯示物件。
    }

    /**
     * SymbolData 變更 Hook。
     *
     * 注意：此時 `layout` 可能還是上一次的值。需要同時依據資料與
     * group 歸屬決定外觀時，請在 onLayoutChanged() 內處理。
     */
    protected onDataChanged(
        data: SymbolData,
        previousData?: SymbolData,
    ): void {
        // 基礎載體不假設實際顯示方式。
    }

    /**
     * 座標與 group 歸屬套用完成 Hook。
     *
     * 典型的遊戲實作：
     * ```ts
     * protected onLayoutChanged(layout: ReelIconLayout): void {
     *     if (layout.groupOffset !== 0) {
     *         this.art.visible = false;      // follower 不畫
     *         return;
     *     }
     *     const span = registry.getCellSpan(this.data.id);
     *     this.art.visible = true;
     *     this.art.height = span * this.cellPitch;
     *     this.art.y = (span - 1) * this.cellPitch * 0.5;  // 往退場方向偏移
     * }
     * ```
     */
    protected onLayoutChanged(layout: ReelIconLayout): void {
        // 基礎載體已完成自身的位置更新。
    }

    /** 遊戲類別清理 Bitmap、Spine、Tween 或內部節點的 Hook。 */
    protected onResetIcon(previousData?: SymbolData): void {
        // 基礎載體沒有額外顯示資源需要清理。
    }

    private validateLayout(layout: ReelIconLayout): void {
        if (layout === null || layout === undefined) {
            throw new Error(
                "BaseReelIcon.applyLayout() requires ReelIconLayout.",
            );
        }

        assertFiniteNumber(layout.x, "ReelIconLayout.x");
        assertFiniteNumber(layout.y, "ReelIconLayout.y");

        if (
            !Number.isInteger(layout.groupOffset)
            || layout.groupOffset < 0
        ) {
            throw new Error(
                "ReelIconLayout.groupOffset must be a non-negative integer.",
            );
        }
    }
}
