namespace slot_test {
    /**
     * 測試場景用的 Icon 載體。
     *
     * 載體本身恆為 1×1（由 BaseReelIcon 在 setupCell() 定案，尺寸與
     * anchorOffset 都是 cellPitch 的常數倍），大圖是它的**子物件**。
     *
     * ## 方向從哪來
     *
     * `ReelIconLayout` 只帶 `x` / `y` / `index`，**不帶方向**。
     * 但 head 的大圖必須「往退場方向」延伸，這件事 Icon 自己算不出來，
     * 所以由框架在 `setupCell()` 一併告知，本類別讀基底的
     * `exitTowardPositiveAxis`、`vertical`，不自己從 Reel 設定推導。
     *
     * ## 尺寸為什麼放在 onCellChanged()
     *
     * 大圖的尺寸與偏移只有這一格換人時才會變，位置卻每幀都在變。
     * 框架把兩件事拆成 `onCellChanged()`（換人才觸發）與
     * `onLayoutChanged()`（每幀觸發），所以昂貴的計算放前者。
     */
    export class TestReelIcon extends slot_core.BaseReelIcon {

        private _art?: egret.Bitmap;

        /** 尺寸定案時建好 Bitmap，之後只換 texture 與高度，不重建。 */
        protected onCellSetup(cellPitch: number): void {
            const art = new egret.Bitmap();
            art.fillMode = egret.BitmapFillMode.SCALE;
            this.addChild(art);
            this._art = art;
        }

        /** 換資料時只換圖，尺寸與偏移交給 onCellChanged()。 */
        protected onDataChanged(
            data: slot_core.SymbolData,
            previousData?: slot_core.SymbolData,
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
        protected onCellChanged(cell: slot_core.ReelIconCell): void {
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

            if (this.vertical) {
                art.width = TEST_COLUMN_WIDTH;
                art.height = axisLength;
                art.x = (pitch - TEST_COLUMN_WIDTH) * 0.5;
                art.y = this.exitTowardPositiveAxis
                    ? 0
                    : pitch - axisLength;
            } else {
                art.width = axisLength;
                art.height = TEST_COLUMN_WIDTH;
                art.y = (pitch - TEST_COLUMN_WIDTH) * 0.5;
                art.x = this.exitTowardPositiveAxis
                    ? 0
                    : pitch - axisLength;
            }
        }

        protected onResetIcon(previousData?: slot_core.SymbolData): void {
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
}
