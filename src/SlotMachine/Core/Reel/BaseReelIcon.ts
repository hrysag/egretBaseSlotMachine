namespace slot_core {
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
     * 畫一張 `cellSpan × cellPitch` 的圖，往退場方向延伸。
     *
     * 這樣「Runtime 是 1×1」一路貫徹到顯示層，也讓 Egret 的
     * `anchorOffset` 變成常數，沒有東西可以忘記重設。
     *
     * ## 兩個 Hook 的分工
     *
     * ```text
     * onCellChanged(cell)     我是什麼：head/follower、這組多長、第幾層
     *                         只有這格換人才觸發     ← 換圖、改尺寸放這裡
     *
     * onLayoutChanged(layout) 我在哪：x / y / index
     *                         每一幀都觸發           ← 基底已設完 x/y，通常不必覆寫
     * ```
     *
     * 同步順序固定為 `setData()` → `applyCell()` → `applyLayout()`，
     * 所以 `onCellChanged()` 內讀 `this.data` 拿到的一定是本格當下的資料。
     *
     * ## 本類別不做的事
     *
     * Movement、資料消耗、停止判斷、Sprite／Spine 建立、物件池。
     * 需要換圖或動畫時由遊戲類別繼承並覆寫 Hook。
     */
    export class BaseReelIcon extends eui.Component {
        private _data?: SymbolData;
        private _layout?: ReelIconLayout;
        private _cell?: ReelIconCell;
        private _cellPitch = 0;
        private _exitTowardPositiveAxis = true;
        private _vertical = true;

        /** Icon 目前綁定的原始 SymbolData 參考。 */
        public get data(): SymbolData | undefined {
            return this._data;
        }

        /** 最近一次套用的局部座標與 strip 索引。 */
        public get layout(): ReelIconLayout | undefined {
            return this._layout;
        }

        /** 最近一次套用的 group 歸屬與顯示屬性。 */
        public get cell(): ReelIconCell | undefined {
            return this._cell;
        }

        /** 一個 1×1 Cell 的軸向長度。 */
        public get cellPitch(): number {
            return this._cellPitch;
        }

        /**
         * 退場方向是否為局部座標的正向（垂直正滾「上進下出」為 true）。
         *
         * head 的大圖要往退場方向延伸時讀它；由框架在 `setupCell()` 給，
         * 不要自己從 Reel 的設定推導。
         */
        public get exitTowardPositiveAxis(): boolean {
            return this._exitTowardPositiveAxis;
        }

        /** Reel 是否垂直排列；大圖的長邊擺在哪一軸由它決定。由框架在 `setupCell()` 給。 */
        public get vertical(): boolean {
            return this._vertical;
        }

        /** 本格是否為 group 的 head（負責顯示整張圖）。 */
        public get isGroupHead(): boolean {
            return this._cell !== undefined
                && this._cell.groupOffset === 0;
        }

        /**
         * 由 ReelIconManager 在建立時呼叫一次。
         *
         * 尺寸與錨點在此定案，之後不再變動 —— 載體恆為 1×1。
         * 方向一併記下，`onCellSetup()` 之後即可讀 `exitTowardPositiveAxis`、`vertical`。
         */
        public setupCell(
            cellPitch: number,
            exitTowardPositiveAxis: boolean,
            vertical: boolean,
        ): void {
            if (!Number.isFinite(cellPitch) || cellPitch <= 0) {
                throw new Error(
                    "cellPitch must be a positive finite number.",
                );
            }

            this._cellPitch = cellPitch;
            this._exitTowardPositiveAxis = exitTowardPositiveAxis;
            this._vertical = vertical;
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
         * 套用本格的 group 歸屬與顯示屬性。
         *
         * ReelIconManager 只在值真的變了才呼叫，所以覆寫
         * `onCellChanged()` 做換圖、改尺寸這類昂貴的事是安全的。
         */
        public applyCell(cell: ReelIconCell): void {
            this.validateCell(cell);
            this._cell = cell;
            this.onCellChanged(cell);
        }

        /**
         * 套用由 ReelIconManager 完成方向映射後的局部座標。
         *
         * 每一幀都會被呼叫；只設位置，不碰尺寸與內容。
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
            this._cell = undefined;
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
         * 注意：此時 `cell` 與 `layout` 都還是上一次的值。需要同時依據
         * 資料與 group 歸屬決定外觀時，請在 onCellChanged() 內處理。
         */
        protected onDataChanged(
            data: SymbolData,
            previousData?: SymbolData,
        ): void {
            // 基礎載體不假設實際顯示方式。
        }

        /**
         * group 歸屬或顯示屬性變更 Hook。
         *
         * 只有這一格換人才觸發，`this.data` 此時已是新資料。
         * 典型的遊戲實作：
         * ```ts
         * protected onCellChanged(cell: ReelIconCell): void {
         *     if (cell.groupOffset !== 0) {
         *         this.art.visible = false;      // follower 不畫
         *         return;
         *     }
         *     this.art.visible = true;
         *     this.art.height = cell.cellSpan * this.cellPitch;   // 往退場方向延伸
         * }
         * ```
         */
        protected onCellChanged(cell: ReelIconCell): void {
            // 基礎載體不假設實際顯示方式。
        }

        /**
         * 座標套用完成 Hook。
         *
         * 每一幀觸發，基底類別已經設完 `x` / `y`，一般不需要覆寫。
         * 需要依位置做額外表現（例如進出場淡入）時才用得上。
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

            if (!Number.isInteger(layout.index) || layout.index < 0) {
                throw new Error(
                    "ReelIconLayout.index must be a non-negative integer.",
                );
            }
        }

        private validateCell(cell: ReelIconCell): void {
            if (cell === null || cell === undefined) {
                throw new Error(
                    "BaseReelIcon.applyCell() requires ReelIconCell.",
                );
            }

            if (!Number.isInteger(cell.groupOffset) || cell.groupOffset < 0) {
                throw new Error(
                    "ReelIconCell.groupOffset must be a non-negative integer.",
                );
            }

            if (!Number.isInteger(cell.cellSpan) || cell.cellSpan <= 0) {
                throw new Error(
                    "ReelIconCell.cellSpan must be a positive integer.",
                );
            }

            if (!Number.isInteger(cell.displayPriority)) {
                throw new Error(
                    "ReelIconCell.displayPriority must be an integer.",
                );
            }
        }
    }
}
