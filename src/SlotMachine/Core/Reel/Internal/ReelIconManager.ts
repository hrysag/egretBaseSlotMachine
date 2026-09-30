namespace slot_core {
    /**
     * 單軸 Cell Strip 的幾何與資料綁定。
     *
     * 本階段只處理純數值：排列、位移、交接、group 推導與結果對齊判定。
     * Icon 載體、mask 與座標軸映射屬於顯示層，於後續階段接上。
     *
     * ## 位置模型
     *
     * 每個 Runtime 恆為一格，位置不逐格保存，而是由索引算出來：
     *
     * ```text
     * 位置(k) = axis(k) + stripOffset + cellOffset[k] + visualAxisOffset
     *
     * axis(k) = (k - maxCellSpan - visibleCellCount / 2 + 0.5) * cellPitch
     * ```
     *
     * - `k` 由進場端數起，`0` 是進場端最外格，`L - 1` 是退場端最外格
     * - 軸向座標一律「往退場方向遞增」，方向正負號留到顯示層才套用
     * - 顯示區固定是 `±visibleCellCount * cellPitch / 2`，與 buffer 大小無關
     *
     * `stripOffset` 不累加，直接由 Movement 的值取模得到，因此沒有累積誤差；
     * 交接由「已走完幾個完整 Cell」的計數器驅動，不做幾何比較。
     */
    export class ReelIconManager {
        private readonly _symbols: ReelSymbolRuntime[] = [];

        private _visibleCellCount = 0;
        private _maxCellSpan = 1;
        private _cellSize = 0;
        private _cellSpacing = 0;
        private _alignmentEpsilon = 0.0001;
        private _symbolRegistry?: ReelSymbolRegistry;

        /** 整軸位移，恆在 [0, cellPitch) 內。 */
        private _stripOffset = 0;

        /** 已經完成交接的完整 Cell 數，用來判斷還欠幾次交接。 */
        private _handedOffCellCount = 0;

        /** 依最近一次 applyMovementValue() 算出的已走完完整 Cell 數。 */
        private _travelledCellCount = 0;

        /** 啟動效果與停止效果的整軸顯示偏移，不影響幾何判定。 */
        private _visualAxisOffset = 0;

        /** 顯示層：與 _symbols 永久同索引配對的 Icon 載體。 */
        private readonly _icons: BaseReelIcon[] = [];
        private _iconContainer?: egret.DisplayObjectContainer;

        /**
         * `sortIconDisplayLayers()` 的比較：displayPriority 小的在下；
         * 同權重以目前的繪製順序為次要鍵，避免每次重排都洗牌。
         */
        private readonly _iconLayerComparator = (
            first: BaseReelIcon,
            second: BaseReelIcon,
        ): number => {
            const firstPriority = first.cell === undefined
                ? 0
                : first.cell.displayPriority;
            const secondPriority = second.cell === undefined
                ? 0
                : second.cell.displayPriority;

            if (firstPriority !== secondPriority) {
                return firstPriority - secondPriority;
            }

            const container = this._iconContainer;

            if (container === undefined) {
                return 0;
            }

            return container.getChildIndex(first)
                - container.getChildIndex(second);
        };
        private _layoutType = ReelIconDirection.Vertical;
        private _inverseDirection = false;

        /** 內部陣列固定為「進場端 → 退場端」。 */
        public get symbols(): ReelSymbolRuntime[] {
            return this._symbols;
        }

        public get visibleCellCount(): number {
            return this._visibleCellCount;
        }

        public get maxCellSpan(): number {
            return this._maxCellSpan;
        }

        public get cellPitch(): number {
            return this._cellSize + this._cellSpacing;
        }

        public get alignmentEpsilon(): number {
            return this._alignmentEpsilon;
        }

        /** Strip 總格數 = 兩端 buffer 加上顯示區。 */
        public get stripCellCount(): number {
            return this._visibleCellCount + this._maxCellSpan * 2;
        }

        public get stripOffset(): number {
            return this._stripOffset;
        }

        /** 顯示區第一格在內部陣列中的索引。 */
        public get firstVisibleIndex(): number {
            return this._maxCellSpan;
        }

        public configure(
            visibleCellCount: number,
            cellSize: number,
            cellSpacing: number,
            alignmentEpsilon: number,
            maxCellSpan: number,
            symbolRegistry: ReelSymbolRegistry,
        ): void {
            this._visibleCellCount = visibleCellCount;
            this._cellSize = cellSize;
            this._cellSpacing = cellSpacing;
            this._alignmentEpsilon = alignmentEpsilon;
            this._maxCellSpan = maxCellSpan;
            this._symbolRegistry = symbolRegistry;
        }

        /**
         * 套用初始盤面。
         *
         * 三段都以**資料流方向**（進場端 → 退場端）排列，並各自展開成 Cell 後
         * 驗證格數：entryBuffer 與 exitBuffer 各為 maxCellSpan、visible 為
         * visibleCellCount。
         *
         * 手寫盤面不允許 group 跨越 buffer 與顯示區的邊界，因此三段可以
         * 獨立驗證；被截斷的盤面只會由上一輪滾動自然產生。
         */
        public initialize(source: ReelLayoutSource): void {
            const entryCells = this.expandSection(
                source.entryBuffer,
                this._maxCellSpan,
                "entryBuffer",
            );
            const visibleCells = this.expandSection(
                source.visible,
                this._visibleCellCount,
                "visible",
            );
            const exitCells = this.expandSection(
                source.exitBuffer,
                this._maxCellSpan,
                "exitBuffer",
            );

            this._symbols.length = 0;
            this._symbols.push(
                ...entryCells,
                ...visibleCells,
                ...exitCells,
            );
            this.resetMovement();
        }

        /** 清除本輪位移狀態；每輪開始與重置 Movement 時呼叫。 */
        public resetMovement(): void {
            this._stripOffset = 0;
            this._handedOffCellCount = 0;
            this._travelledCellCount = 0;
        }

        /**
         * 套用 Movement 的目前值，回傳尚欠幾次交接。
         *
         * `value` 是本輪累積的行進距離（永遠往退場方向遞增，不帶方向正負號）。
         * stripOffset 由取模得到而非逐次累加，因此不會有浮點漂移；
         * 交接次數也直接由整除部分決定，不需要任何幾何比較或容差。
         */
        public applyMovementValue(value: number): number {
            const travelled = Math.max(0, value);
            const cellPitch = this.cellPitch;

            this._travelledCellCount = Math.floor(travelled / cellPitch);
            this._stripOffset =
                travelled - this._travelledCellCount * cellPitch;

            return this.pendingHandoffCount;
        }

        /**
         * 尚欠幾次交接。
         *
         * 位置每幀都要更新，但交接只在完整 Cell 邊界執行，所以兩者分開：
         * `applyMovementValue()` 負責位置，呼叫端在完整 Cell 邊界才依此
         * 數值把欠的交接補完。
         */
        public get pendingHandoffCount(): number {
            return Math.max(
                0,
                this._travelledCellCount - this._handedOffCellCount,
            );
        }

        /**
         * 把退場端最外格搬回進場端並綁定新資料。
         *
         * group 歸屬以 O(1) 的鄰居規則推導：朝退場方向的隔壁若是同一個
         * Symbol 且該 group 尚未湊滿，就接續；否則開新組。head 因此落在
         * group 的進場側，是整組中最後進場的一格。
         */
        public recycleExitedCell(
            nextData: SymbolData,
            resultSpinId?: number,
        ): {
            runtime: ReelSymbolRuntime;
            previousData: SymbolData;
        } {
            this.validateData(nextData, "nextData");

            if (this._symbols.length < 2) {
                throw new Error(
                    "BaseReel requires at least two runtime cells.",
                );
            }

            const runtime = this._symbols.pop() as ReelSymbolRuntime;
            const previousData = runtime.data;
            const neighbourTowardExit = this._symbols[0];

            runtime.data = nextData;
            runtime.groupOffset = this.resolveGroupOffset(
                nextData,
                neighbourTowardExit,
            );
            runtime.resultSpinId = resultSpinId;
            runtime.cellOffset = 0;
            this._symbols.unshift(runtime);
            this.rotateExitedIconToEntry();
            this._handedOffCellCount++;

            return { runtime, previousData };
        }

        /**
         * 牌跟著空殼走：退場端最外面那個空殼搬回進場端。
         *
         * 與 Cocos 版相同 —— 圖與動畫掛在空殼上，空殼一路帶著同一張牌移動，
         * 走出畫面後才被搬到進場預備區換上新資料。若只轉 `_symbols`，每過
         * 一格每個空殼都會跳回原位、換成別張牌，掛在上面的動畫也跟著跳。
         */
        private rotateExitedIconToEntry(): void {
            const icon = this._icons.pop();

            if (icon !== undefined) {
                this._icons.unshift(icon);
            }
        }

        /**
         * 資料與空殼照同一個順序重排（掉落用；Drop-Module-Readiness §7.4 Q5）。
         *
         * `order[新索引] = 舊索引`，必須是 0～L-1 的排列。牌掛在空殼上、跟著
         * 空殼走，所以兩條陣列一起動，配對不變；位置由索引重算，呼叫端要自己
         * 用 `cellOffset` 補回畫面上的原位。
         */
        public reorderCells(order: number[]): void {
            const length = this._symbols.length;

            if (order.length !== length) {
                throw new Error(
                    `reorderCells() requires ${length} indexes; received ${order.length}.`,
                );
            }

            const seen: boolean[] = [];

            for (const index of order) {
                if (!Number.isInteger(index) || index < 0 || index >= length || seen[index]) {
                    throw new Error(
                        "reorderCells() requires a permutation of the current indexes.",
                    );
                }

                seen[index] = true;
            }

            const symbols: ReelSymbolRuntime[] = [];

            for (const index of order) {
                symbols.push(this._symbols[index]);
            }

            this._symbols.length = 0;
            this._symbols.push(...symbols);

            if (this._icons.length === length) {
                const icons: BaseReelIcon[] = [];

                for (const index of order) {
                    icons.push(this._icons[index]);
                }

                this._icons.length = 0;
                this._icons.push(...icons);
            }
        }

        /**
         * 沒有下一筆資料時，仍把已出場的載體搬回進場端。
         *
         * 只整理 strip 結構，不更換資料 —— 否則退場端會堆積，
         * 下一輪也會缺少進場 buffer。
         */
        public recycleExitedCellKeepingData(): ReelSymbolRuntime {
            if (this._symbols.length < 2) {
                throw new Error(
                    "BaseReel requires at least two runtime cells.",
                );
            }

            const runtime = this._symbols.pop() as ReelSymbolRuntime;
            const neighbourTowardExit = this._symbols[0];

            runtime.groupOffset = this.resolveGroupOffset(
                runtime.data,
                neighbourTowardExit,
            );
            runtime.cellOffset = 0;
            this._symbols.unshift(runtime);
            this.rotateExitedIconToEntry();
            this._handedOffCellCount++;

            return runtime;
        }

        /**
         * 進場端那一組還差幾格才湊滿。
         *
         * 進場端最外格是最後一個綁到資料的 Cell；它的 `groupOffset` 若還
         * 大於 0，代表這一組只進了一部分，head 還沒進場。這個數字同時也是
         * 該組**尚未讀取**的 Cell 數 —— 表演 Symbol 入列時整組展開成連續
         * Cell，所以缺的那幾格就排在資料佇列最前面。
         *
         * 0 表示邊界是乾淨的（上一組已經湊滿）。
         */
        public get incompleteEntryGroupPendingCellCount(): number {
            const entryRuntime = this._symbols[0];

            return entryRuntime === undefined
                ? 0
                : entryRuntime.groupOffset;
        }

        /**
         * 把進場端那組沒湊滿的 Cell 就地拆成各自獨立的 1×1。
         *
         * **為什麼要拆**：正式結果的第一格入列時，`resolveGroupOffset()`
         * 只看「朝退場方向的鄰居是不是同 id 且 offset > 0」。若邊界留著一組
         * 沒湊滿的 Symbol，而結果剛好是同一張牌，結果的第一格就會被接進那組
         * 裡，整批 offset 跟著錯位。拆成 1×1 之後每格 offset 都是 0，結果
         * 一定開新組。
         *
         * **為什麼可以就地改寫**：group 的 span 最多 `maxCellSpan`，進場
         * buffer 也正好是 `maxCellSpan` 格，所以已進場的部分最多
         * `maxCellSpan - 1` 格，必定整批還在 buffer 內、還沒進顯示區 ——
         * 玩家從來沒看過它們。
         *
         * @param fillerData 用來取代的 1×1 Symbol
         * @returns 實際改寫的 Cell 數
         */
        public dissolveIncompleteEntryGroup(fillerData: SymbolData): number {
            const pendingCellCount =
                this.incompleteEntryGroupPendingCellCount;

            if (pendingCellCount === 0) {
                return 0;
            }

            this.validateData(fillerData, "fillerData");

            if (this.getCellSpan(fillerData) !== 1) {
                throw new Error(
                    "Incomplete entry group can only be dissolved "
                    + "into 1x1 Symbols.",
                );
            }

            const entryRuntime = this._symbols[0];
            const enteredCellCount =
                this.getCellSpan(entryRuntime.data) - pendingCellCount;

            for (let index = 0; index < enteredCellCount; index++) {
                const runtime = this._symbols[index];

                if (runtime === undefined) {
                    break;
                }

                runtime.data = fillerData;
                runtime.groupOffset = 0;
                runtime.resultSpinId = undefined;
            }

            return enteredCellCount;
        }

        /**
         * 把上一輪留在進場 buffer 的 Runtime 改綁新一輪資料。
         *
         * 只有**整組都在 buffer 內**的格子可以換；跨越 buffer 與顯示區
         * 邊界的 group 必須整組保留，否則會把仍在顯示區的 follower
         * 變成沒有 head 的孤兒，那張圖會直接消失。
         *
         * 回傳順序為進場端由外往內。
         */
        public getReplaceableEntryRuntimes(): ReelSymbolRuntime[] {
            const result: ReelSymbolRuntime[] = [];
            const lastBufferIndex = this._maxCellSpan - 1;

            for (let index = 0; index <= lastBufferIndex; index++) {
                const runtime = this._symbols[index];

                if (runtime === undefined) {
                    break;
                }

                if (runtime.groupOffset === 0) {
                    const span = this.getCellSpan(runtime.data);

                    if (index + span - 1 > lastBufferIndex) {
                        break;
                    }
                }

                result.push(runtime);
            }

            return result;
        }

        /** 依鄰居重新推導 group 歸屬並換上新資料。 */
        public rebindEntryRuntime(
            runtime: ReelSymbolRuntime,
            nextData: SymbolData,
        ): SymbolData {
            this.validateData(nextData, "nextData");

            const index = this._symbols.indexOf(runtime);

            if (index < 0 || index >= this._symbols.length - 1) {
                throw new Error(
                    "Carryover runtime must be inside the entry buffer.",
                );
            }

            const previousData = runtime.data;
            runtime.data = nextData;
            runtime.groupOffset = this.resolveGroupOffset(
                nextData,
                this._symbols[index + 1],
            );
            runtime.resultSpinId = undefined;
            runtime.cellOffset = 0;
            return previousData;
        }

        /**
         * 取得顯示區逐 Cell 的 Symbol ID，依畫面閱讀順序之前的內部順序
         * （進場端 → 退場端）排列。方向轉換由呼叫端負責。
         */
        public getVisibleCellSymbolIds(): number[] {
            const result: number[] = [];
            const start = this.firstVisibleIndex;

            for (let offset = 0; offset < this._visibleCellCount; offset++) {
                const runtime = this._symbols[start + offset];

                if (runtime === undefined) {
                    break;
                }

                result.push(runtime.data.id);
            }

            return result;
        }

        /** 取得完整落在顯示區內的 Runtime。 */
        public getVisibleRuntimes(): ReelSymbolRuntime[] {
            const start = this.firstVisibleIndex;
            return this._symbols.slice(
                start,
                start + this._visibleCellCount,
            );
        }

        /**
         * 判斷本輪正式結果是否已經完整對齊顯示區。
         *
         * 只在完整 Cell 邊界成立（stripOffset 回到 0），此時顯示格就是
         * 固定的索引區間，因此純粹比對 id 與輪次標記，不碰任何幾何。
         *
         * @param result 依內部順序（進場端 → 退場端）排列的逐 Cell 結果
         */
        public isAligned(
            result: SymbolData[],
            requiredResultSpinId?: number,
        ): boolean {
            if (
                result.length === 0
                || result.length !== this._visibleCellCount
            ) {
                return false;
            }

            if (this._stripOffset > this._alignmentEpsilon) {
                return false;
            }

            const start = this.firstVisibleIndex;

            for (let offset = 0; offset < result.length; offset++) {
                const runtime = this._symbols[start + offset];

                if (runtime === undefined) {
                    return false;
                }

                if (runtime.data.id !== result[offset].id) {
                    return false;
                }

                if (
                    requiredResultSpinId !== undefined
                    && runtime.resultSpinId !== requiredResultSpinId
                ) {
                    return false;
                }
            }

            return true;
        }

        /**
         * 第 k 格的軸向位置。
         *
         * 座標往退場方向遞增、顯示區中心為 0；方向正負號與軸向映射
         * 由顯示層處理。
         */
        public getAxisPosition(index: number): number {
            const runtime = this._symbols[index];
            const cellOffset = runtime === undefined
                ? 0
                : runtime.cellOffset;

            return this.getBaseAxisPosition(index)
                + this._stripOffset
                + cellOffset
                + this._visualAxisOffset;
        }

        /** 套用整軸顯示偏移（啟動效果與停止效果）。 */
        public setVisualAxisOffset(value: number): void {
            if (!Number.isFinite(value)) {
                throw new Error(
                    "visualAxisOffset must be a finite number.",
                );
            }

            this._visualAxisOffset = value;
        }

        /** 驗證 Server 逐 Cell 結果；筆數必須等於顯示區 Cell 數。 */
        public validateResultData(data: SymbolData[]): void {
            if (data.length === 0) {
                throw new Error("Result SymbolData cannot be empty.");
            }

            if (data.length !== this._visibleCellCount) {
                throw new Error(
                    "Result SymbolData must contain exactly "
                    + `${this._visibleCellCount} visible cells; `
                    + `received ${data.length}.`,
                );
            }

            for (const item of data) {
                this.validateData(item, "result SymbolData");
            }
        }

        public validateData(data: SymbolData, label: string): void {
            if (data === null || data === undefined) {
                throw new Error(`${label} is required.`);
            }

            this.getCellSpan(data);

            if (data.visualSize !== undefined) {
                assertPositiveFiniteNumber(
                    data.visualSize.width,
                    `${label}.visualSize.width`,
                );
                assertPositiveFiniteNumber(
                    data.visualSize.height,
                    `${label}.visualSize.height`,
                );
            }
        }

        public getCellSpan(data: SymbolData): number {
            if (this._symbolRegistry === undefined) {
                throw new Error(
                    "ReelIconManager requires a ReelSymbolRegistry.",
                );
            }

            return this._symbolRegistry.getCellSpan(data.id);
        }

        // ───────────────── 顯示層 ─────────────────

        /** 由 BaseReel 建立並綁定的 Icon，與 _symbols 永久同索引配對。 */
        public get icons(): BaseReelIcon[] {
            return this._icons;
        }

        /**
         * 取得**圖有出現在顯示區**的 Icon，依進場端 → 退場端排列。
         *
         * 與「可視段的每一格」不是同一件事，截斷盤面上兩者會分岔：
         *
         * ```text
         * 可視 [73, 73, 1]，73 是 1×3
         *  idx2 │ 73:0 │ ← head 在進場 buffer，圖往下蓋三格
         *  ═════╪══════╡ ← 顯示區上緣
         *  idx3 │ 73:1 │ ← follower，自己不畫
         *  idx4 │ 73:2 │ ← follower，自己不畫
         *  idx5 │  1:0 │
         *  ═════╧══════╡
         *
         * 可視段的每一格 → icons[3..5]，其中兩格什麼都沒畫
         * 本方法         → icons[2]（73 的 head）與 icons[5]
         * ```
         *
         * 判準是**「該 group 在可視段裡至少擁有一格」**，回傳那一組的 head
         * —— 圖正好等於 head 起算 `cellSpan` 格，所以這個條件與「圖與顯示區
         * 有交集」等價，而且是純索引算術，不需要幾何比較或容差。
         * 一個 group 只回傳一個載體（head），不會因為占三格就出現三次。
         *
         * 滾動中（`stripOffset > 0`）整條 strip 往退場方向滑了不到一格，
         * 進場側再外面那一格會有一部分露進顯示區，因此一併列入；
         * 對齊時（`stripOffset === 0`）它的邊緣正好貼齊上緣，交集為零，排除。
         */
        public getVisibleIcons(): BaseReelIcon[] {
            const result: BaseReelIcon[] = [];
            const last = this.firstVisibleIndex + this._visibleCellCount - 1;
            const first = this._stripOffset > 0
                ? this.firstVisibleIndex - 1
                : this.firstVisibleIndex;
            let previousHeadIndex = -1;

            for (let index = first; index <= last; index++) {
                const runtime = this._symbols[index];

                if (runtime === undefined) {
                    continue;
                }

                const headIndex = index - runtime.groupOffset;

                /* 索引遞增且同組連續，所以比對前一個就足以去重。 */
                if (headIndex < 0 || headIndex === previousHeadIndex) {
                    continue;
                }

                previousHeadIndex = headIndex;
                const icon = this._icons[headIndex];

                if (icon !== undefined) {
                    result.push(icon);
                }
            }

            return result;
        }

        /**
         * 取得與指定 Runtime 同組的全部 Icon，依進場端 → 退場端排列。
         *
         * 決議 9：不存引用。回收會就地改綁資料，任何存下來的同組引用
         * 下一次交接就變髒，所以一律即時走訪，回傳新陣列。
         *
         * ## 為什麼走鄰居而不是用 cellSpan 算
         *
         * `headIndex = index - groupOffset` 加 `cellSpan` 可以一步算出範圍，
         * 但那個範圍可能落在 strip 之外：一個 group 進場時 head 還沒進來、
         * 出場時 follower 已經被回收，兩端都會有格子不在陣列上。改走鄰居
         * （id 相同且 groupOffset 連續）就自然停在 strip 邊界，也不受
         * `reconfigureStoppedLayout()` 重新註冊 cellSpan 的影響。
         *
         * 因此**回傳的格數可能少於 `cellSpan`**，那是進出場途中的正常狀態。
         */
        public getGroupIcons(
            runtime: ReelSymbolRuntime,
        ): BaseReelIcon[] {
            const index = this._symbols.indexOf(runtime);

            if (index < 0) {
                throw new Error(
                    "getGroupIcons() requires a runtime that is currently "
                    + "on the strip.",
                );
            }

            const range = this.getGroupIndexRange(index);
            return this._icons.slice(range.start, range.end + 1);
        }

        /**
         * 同組在 strip 上的索引區間（兩端皆含）。
         *
         * 判斷條件只有「id 相同」與「groupOffset 連續」，因此相鄰的
         * 兩個同 id group 不會被黏成一組 —— 後一組的 head 是 0，
         * 不等於前一格的 offset + 1。
         */
        private getGroupIndexRange(
            index: number,
        ): { start: number; end: number } {
            const symbols = this._symbols;
            let start = index;
            let end = index;

            while (start > 0) {
                const previous = symbols[start - 1];

                if (
                    previous.data.id !== symbols[start].data.id
                    || previous.groupOffset !== symbols[start].groupOffset - 1
                ) {
                    break;
                }

                start--;
            }

            while (end < symbols.length - 1) {
                const next = symbols[end + 1];

                if (
                    next.data.id !== symbols[end].data.id
                    || next.groupOffset !== symbols[end].groupOffset + 1
                ) {
                    break;
                }

                end++;
            }

            return { start, end };
        }

        /**
         * 退場方向是否為局部座標的正向。
         *
         * **整個框架唯一的方向慣例來源。** `mapAxisToLocal()` 依它決定
         * 正負號，遊戲端的 Icon 也依它決定 head 的大圖往哪邊延伸。
         *
         * 遊戲端不要自己從 `inverseDirection` 推導 —— 那等於把這條慣例
         * 複製一份出去，慣例一改就靜默失效。`inverseDirection` 因此
         * 刻意不對外暴露。
         */
        public get exitTowardPositiveAxis(): boolean {
            return !this._inverseDirection;
        }

        /** 排列軸向；Icon 要靠它決定大圖的長邊擺在哪一軸。 */
        public get layoutType(): ReelIconDirection {
            return this._layoutType;
        }

        /**
         * 正式結果是否由畫面閱讀順序的開頭側進場。
         *
         * 與 `exitTowardPositiveAxis` **同值**，因為兩個軸的閱讀順序都是
         * 從座標小的一端開始（Egret 的 y 往下、x 往右）：垂直由上而下、
         * 水平由左而右。所以「退場在正向」⟺「進場在座標小的那端」
         * ⟺「進場在閱讀順序的開頭」。
         *
         * 保留獨立名稱是因為呼叫端問的是不同的問題，但**實作只有一份**。
         *
         * > 這裡原本是從 Cocos 版一字不改搬過來的
         * > `Vertical ? !inverse : inverse`。Cocos 的水平正向是右→左
         * > （`movementSign = inverse ? 1 : -1`），移植時 `mapAxisToLocal()`
         * > 重新推導成左→右，這條卻沒跟著改，於是 Horizontal 整個反掉。
         * > 因為四方向從沒被執行過，一直沒露面。
         */
        public get resultEntryAtDisplayStart(): boolean {
            return this.exitTowardPositiveAxis;
        }

        /**
         * 設定軸向映射。
         *
         * 幾何運算完全不含方向，方向只在這裡把「軸向數值」轉成
         * Egret 的 x 或 y，以及決定正負號。
         *
         * 傳 undefined 代表沿用目前值 —— 重複 init() 時的預設行為。
         */
        public configureDisplay(
            layoutType?: ReelIconDirection,
            inverseDirection?: boolean,
        ): void {
            this._layoutType = layoutType !== undefined
                ? layoutType
                : this._layoutType;
            this._inverseDirection = inverseDirection !== undefined
                ? inverseDirection
                : this._inverseDirection;

            if (this._icons.length > 0) {
                this.syncAllIcons();
            }
        }

        /**
         * 依目前 strip 長度建立 Icon 載體。
         *
         * 載體數量固定為 stripCellCount（由 maxCellSpan 決定），建立之後
         * 滾動期間不再增刪 —— 換的是載體裡的美術內容，不是載體本身。
         * 容器由 BaseReel 傳入自己（BaseReel 本身就是 eui.Component）；
         * 載體類別與外觀由 `iconClass`／`iconSkinName` 決定，對應 Cocos 版的
         * 載體 Prefab。方向由本類別一併交給載體（`setupCell()`），載體不必
         * 自己推導。
         *
         * 類別不合法時在清掉現有載體**之前** throw，現有載體不受影響。
         */
        public initializeIcons(
            container: egret.DisplayObjectContainer,
            iconClass: string,
            iconSkinName: string,
        ): void {
            const iconType = this.resolveIconClass(iconClass);
            const vertical = this._layoutType === ReelIconDirection.Vertical;

            this.clearIcons();
            this._iconContainer = container;

            for (let index = 0; index < this._symbols.length; index++) {
                const icon = new iconType();

                if (iconSkinName !== "") {
                    icon.skinName = iconSkinName;
                }

                icon.setupCell(
                    this.cellPitch,
                    this.exitTowardPositiveAxis,
                    vertical,
                );
                container.addChild(icon);
                this._icons.push(icon);
            }

            this.syncAllIcons();
        }

        /**
         * 以完整名稱取得載體類別；空字串 = `BaseReelIcon`。
         *
         * 找不到、或不是 `BaseReelIcon` 本身／子類別 → throw，不默默改用基底。
         */
        private resolveIconClass(iconClass: string): typeof BaseReelIcon {
            if (iconClass === "") {
                return BaseReelIcon;
            }

            const definition = egret.getDefinitionByName(iconClass);

            if (
                typeof definition !== "function"
                || (
                    definition !== BaseReelIcon
                    && !(definition.prototype instanceof BaseReelIcon)
                )
            ) {
                throw new Error(
                    "Reel icon class \"" + iconClass
                    + "\" was not found or is not a BaseReelIcon.",
                );
            }

            return definition;
        }

        /** 把目前全部排列同步到 Icon。 */
        public syncAllIcons(): void {
            let displayPriorityChanged = false;

            for (let index = 0; index < this._icons.length; index++) {
                if (this.syncIcon(index)) {
                    displayPriorityChanged = true;
                }
            }

            if (displayPriorityChanged) {
                this.sortIconDisplayLayers();
            }
        }

        /** 產生顯示區的裁切矩形；交由呼叫端指定給容器的 mask。 */
        public createDisplayMaskRect(crossSize: number): egret.Rectangle {
            const axisLength = this._visibleCellCount * this.cellPitch;
            const isVertical =
                this._layoutType === ReelIconDirection.Vertical;
            const width = isVertical ? crossSize : axisLength;
            const height = isVertical ? axisLength : crossSize;

            return new egret.Rectangle(
                -width * 0.5,
                -height * 0.5,
                width,
                height,
            );
        }

        /** 移除本類別建立的 Icon，保留純數值 strip。 */
        public clearIcons(): void {
            for (const icon of this._icons) {
                icon.resetIcon();

                if (icon.parent !== null) {
                    icon.parent.removeChild(icon);
                }
            }

            this._icons.length = 0;
            this._iconContainer = undefined;
        }

        public cleanup(): void {
            this.clearIcons();
            this._symbols.length = 0;
            this._stripOffset = 0;
            this._handedOffCellCount = 0;
            this._travelledCellCount = 0;
            this._visualAxisOffset = 0;
        }

        /**
         * 把第 index 格同步到對應 Icon。
         *
         * @returns 資料是否變更（變更時需要重排顯示層級）
         */
        private syncIcon(index: number): boolean {
            const icon = this._icons[index];
            const runtime = this._symbols[index];

            if (icon === undefined || runtime === undefined) {
                return false;
            }

            const dataChanged = icon.data !== runtime.data;

            if (dataChanged) {
                icon.setData(runtime.data);
            }

            this.syncIconCell(icon, runtime);

            const axis = this.getAxisPosition(index);
            const mapped = this.mapAxisToLocal(axis);

            icon.applyLayout({
                x: mapped.x,
                y: mapped.y,
                index,
            });

            return dataChanged;
        }

        /**
         * 「我是什麼」只有換人才變，所以先比對再決定要不要通知。
         *
         * 每幀比對三個數字的成本遠低於讓遊戲端每幀重算尺寸與美術；
         * 而且值一律現查 Registry，registry 被重新註冊時會自動跟上。
         */
        private syncIconCell(
            icon: BaseReelIcon,
            runtime: ReelSymbolRuntime,
        ): void {
            const registry = this._symbolRegistry;

            if (registry === undefined) {
                return;
            }

            const groupOffset = runtime.groupOffset;
            const cellSpan = registry.getCellSpan(runtime.data.id);
            const displayPriority =
                registry.getDisplayPriority(runtime.data.id);
            const current = icon.cell;

            if (
                current !== undefined
                && current.groupOffset === groupOffset
                && current.cellSpan === cellSpan
                && current.displayPriority === displayPriority
            ) {
                return;
            }

            icon.applyCell({ groupOffset, cellSpan, displayPriority });
        }

        /**
         * 軸向數值 → Egret 局部座標。
         *
         * 軸向一律往退場方向遞增；Egret 的 y 也是往下遞增，因此垂直
         * 正向（上進下出）可以直接對應，反向才需要翻號。
         */
        private mapAxisToLocal(axis: number): { x: number; y: number } {
            const directed = this._inverseDirection ? -axis : axis;

            return this._layoutType === ReelIconDirection.Vertical
                ? { x: 0, y: directed }
                : { x: directed, y: 0 };
        }

        /**
         * 依 displayPriority 重排 Icon 的繪製順序。
         *
         * 用 setChildIndex 而非 zIndex：zIndex 會實際重排容器的 $children
         * 陣列，之後 getChildIndex() 的結果就與本類別維護的索引脫節。
         * 同權重時以目前順序為次要鍵，避免每次重排都洗牌。
         */
        private sortIconDisplayLayers(): void {
            const container = this._iconContainer;

            if (container === undefined) {
                return;
            }

            const sorted = this._icons.slice();
            sorted.sort(this._iconLayerComparator);

            for (let index = 0; index < sorted.length; index++) {
                container.setChildIndex(sorted[index], index);
            }
        }

        /** 不含任何位移的基準位置。 */
        private getBaseAxisPosition(index: number): number {
            return (
                index
                - this._maxCellSpan
                - this._visibleCellCount * 0.5
                + 0.5
            ) * this.cellPitch;
        }

        /**
         * group 歸屬的 O(1) 規則。
         *
         * 朝退場方向的隔壁若是同一個 Symbol 且該 group 尚未湊滿
         * （groupOffset > 0），本格就是它的下一格；否則開新組，
         * 從 cellSpan - 1 起算。
         */
        private resolveGroupOffset(
            data: SymbolData,
            neighbourTowardExit?: ReelSymbolRuntime,
        ): number {
            if (
                neighbourTowardExit !== undefined
                && neighbourTowardExit.data.id === data.id
                && neighbourTowardExit.groupOffset > 0
            ) {
                return neighbourTowardExit.groupOffset - 1;
            }

            return this.getCellSpan(data) - 1;
        }

        /**
         * 把一段以 Symbol 為單位的資料展開成 Cell，並驗證總格數。
         *
         * 每個 Symbol 都展開成完整的一組，所以段落之間的邊界永遠落在
         * group 邊界上，不會出現跨段的半組。
         */
        private expandSection(
            data: SymbolData[],
            expectedCellCount: number,
            label: string,
        ): ReelSymbolRuntime[] {
            if (!Array.isArray(data) || data.length === 0) {
                throw new Error(`${label} SymbolData cannot be empty.`);
            }

            const cells: ReelSymbolRuntime[] = [];

            for (const symbol of data) {
                this.validateData(symbol, `${label} SymbolData`);
                const cellSpan = this.getCellSpan(symbol);

                /*
                 * head 在 group 的進場側，內部陣列又是進場端 → 退場端，
                 * 所以 groupOffset 沿陣列方向遞增：0（head）, 1, 2 …
                 * 與 resolveGroupOffset() 的「鄰居 - 1」方向一致。
                 */
                for (let offset = 0; offset < cellSpan; offset++) {
                    cells.push({
                        data: symbol,
                        groupOffset: offset,
                        cellOffset: 0,
                    });
                }
            }

            if (cells.length !== expectedCellCount) {
                throw new Error(
                    `${label} must expand to exactly ${expectedCellCount} `
                    + `cells; received ${cells.length}.`,
                );
            }

            return cells;
        }
    }
}
