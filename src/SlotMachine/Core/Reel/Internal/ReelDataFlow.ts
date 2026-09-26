import { SymbolData } from "../Data/SymbolData";
import { ReelDataList } from "./ReelDataList";

export interface ReelConsumedData {
    readonly data: SymbolData;
    readonly resultSpinId?: number;
}

export interface ReelQuickStopSkipResult {
    readonly skippedDataCount: number;
    readonly skippedCellCount: number;
}

export type ReelCellSpanResolver = (
    data: SymbolData,
) => number;

export type ReelPerformanceDataProvider = () => SymbolData;

export type ReelDataValidator = (
    data: SymbolData,
    label: string,
) => void;

/**
 * 聚合單軸一輪內的資料流。
 *
 * BaseReel 只負責控制滾動流程；資料索引、表演牌循環、結果區段、
 * 輪次標記與依 Cell 預算保留資料的細節集中由此類別管理。
 */
export class ReelDataFlow {
    private readonly _dataList = new ReelDataList();
    private readonly _performanceDataBank: SymbolData[] = [];
    private readonly _committedResult: SymbolData[] = [];

    private _performanceDataReadIndex = 0;
    private _resultStartIndex = -1;
    private _resultEndIndex = -1;

    /**
     * 結果區段開頭那幾格「退場端截斷的墊格」。
     *
     * 它們比結果本體更早進場，但被併在 resultSegment 裡，所以
     * `_resultStartIndex` 指向的是墊格而不是結果本體。停輪行程要算到
     * 本體，因此得把這個數字記下來 —— 算完就丟的話，提交之後就再也
     * 問不出「還要先走幾格才輪到結果」。
     */
    private _resultExitPadCellCount = 0;
    private _spinId = 0;

    /** 保留既有 BaseReel.dataList 公開 API 所需的資料列表。 */
    public get dataList(): ReelDataList {
        return this._dataList;
    }

    public get committedResult(): SymbolData[] {
        return this._committedResult;
    }

    public get spinId(): number {
        return this._spinId;
    }

    public get resultCommitted(): boolean {
        return this._resultStartIndex >= 0;
    }

    /**
     * 結果區段開頭的**退場端墊格**數。
     *
     * 提交之後，strip 上帶本輪 `resultSpinId` 的格子裡，最靠退場端的
     * 就是這幾格 —— 減掉它們才是結果本體的第一格。
     */
    public get resultExitPadCellCount(): number {
        return this._resultExitPadCellCount;
    }

    /**
     * 還能不能在結果前面插表演格（決議 43）。
     *
     * 結果區段的第一格一旦被讀走，再從 `_resultStartIndex` 前面插格就會
     * 把結果切成兩段 —— 盤面永遠對不齊、這一軸停不下來。
     */
    public get canInsertBeforeResult(): boolean {
        return !this.resultCommitted
            || this._resultStartIndex >= this._dataList.readIndex;
    }

    /**
     * 取代表演牌庫，並清除上一輪尚未完成的結果區段。
     *
     * 牌庫本身以 **Symbol** 為單位（遊戲端照原本的方式定義牌庫）；
     * 進入資料列表時才由框架展開成 Cell。
     */
    public setPerformanceDataBank(
        data: SymbolData[],
        cellSpanResolver: ReelCellSpanResolver,
    ): void {
        this._dataList.reset();
        this._dataList.append(
            this.expandSymbolsToCells(data, cellSpanResolver),
        );
        this._performanceDataBank.length = 0;
        this._performanceDataBank.push(...data);
        this._performanceDataReadIndex = 0;
        this.clearResultSegment();
    }

    /** 正式結果尚未提交時，追加可循環使用的表演資料。 */
    public appendPerformanceData(
        data: SymbolData[],
        cellSpanResolver: ReelCellSpanResolver,
    ): void {
        if (this.resultCommitted) {
            throw new Error(
                "Performance data cannot be appended after the result is committed.",
            );
        }

        this._dataList.append(
            this.expandSymbolsToCells(data, cellSpanResolver),
        );
        this._performanceDataBank.push(...data);
    }

    /** 開始新輪次並建立新的結果辨識標記。 */
    public beginSpin(): void {
        this.clearResultSegment();
        this._spinId++;
    }

    /** 取得預設循環牌庫的下一張表演牌。 */
    public getNextPerformanceData(): SymbolData {
        const length = this._performanceDataBank.length;

        if (length === 0) {
            throw new Error(
                "Performance data bank is empty. "
                + "Call setPerformanceDataBank() or override "
                + "getNextPerformanceData().",
            );
        }

        const result =
            this._performanceDataBank[this._performanceDataReadIndex];
        this._performanceDataReadIndex =
            (this._performanceDataReadIndex + 1) % length;
        return result;
    }

    /**
     * 優先消耗已排定資料；結果尚未提交且列表已空時，
     * 才透過可覆寫的表演資料來源補入下一張。
     */
    public consumeNextData(
        performanceDataProvider: ReelPerformanceDataProvider,
        validator: ReelDataValidator,
        cellSpanResolver: ReelCellSpanResolver,
    ): ReelConsumedData | undefined {
        const readIndex = this._dataList.readIndex;
        const queuedData = this._dataList.consume();

        if (queuedData !== undefined) {
            const isCurrentResult =
                readIndex >= this._resultStartIndex
                && readIndex < this._resultEndIndex;

            return {
                data: queuedData,
                resultSpinId: isCurrentResult
                    ? this._spinId
                    : undefined,
            };
        }

        if (this.resultCommitted) {
            return undefined;
        }

        /*
         * 資料用完時動態補牌：整組展開成 Cell 一次入列，
         * 確保列表永遠以完整 group 結尾，group 邊界不會被切在中間。
         */
        const performanceData = performanceDataProvider();
        validator(
            performanceData,
            "getNextPerformanceData result",
        );
        this._dataList.append(
            this.expandSymbolsToCells(
                [performanceData],
                cellSpanResolver,
            ),
        );
        const consumedPerformanceData = this._dataList.consume();

        return consumedPerformanceData === undefined
            ? undefined
            : { data: consumedPerformanceData };
    }

    /**
     * 以「保留表演資料＋逐 Cell 結果＋群組收尾＋必要尾牌」替換未讀資料，
     * 並記錄本輪正式結果在完整資料列表中的區段。
     *
     * 資料列表一律以 **Cell** 為單位：1×N Symbol 會展開成 N 筆相同 id，
     * 由 ReelIconManager 在綁定時依「朝退場方向的鄰居」推導 groupOffset。
     *
     * 未提供 Cell 預算時保留全部未讀表演資料。
     *
     * `dissolvedEntryGroupCellCount` 是進場端那一組被拆掉後、仍留在
     * 佇列最前面的未讀格數（見 `ReelIconManager.dissolveIncompleteEntryGroup()`）。
     * 這幾格屬於一個已經不存在的 group，必須連同拆除一起丟掉；留著的話
     * 它們會在結果之前重新長出一個湊不滿的 group，結果的第一格照樣被吸走。
     *
     * 丟掉之後「結果之前的表演資料一定以完整 group 結尾」才成立，
     * `createGroupCompletionCells()` 的「第一格一律開新組」也才站得住。
     *
     * @returns 實際保留的表演 Cell 數
     */
    public commitResult(
        visibleResult: SymbolData[],
        requiredTail: SymbolData[],
        performanceCellBudget: number | undefined,
        reverseResultEntry: boolean,
        dissolvedEntryGroupCellCount: number,
        cellSpanResolver: ReelCellSpanResolver,
        performanceDataProvider: ReelPerformanceDataProvider,
        validator: ReelDataValidator,
    ): number {
        this._committedResult.length = 0;
        this._committedResult.push(...visibleResult);

        /*
         * Server 給的是畫面閱讀順序，先依方向轉成「退場端 → 進場端」。
         * 佇列的消耗順序就是進場順序，所以轉完直接依序入列即可。
         */
        const visibleResultEntryCells = this.toResultEntryCells(
            visibleResult,
            reverseResultEntry,
        );

        /*
         * 開頭：退場端那一組若被顯示區截斷，把「比結果更早進場」的那幾格
         * 墊回來。大 Symbol 出場時最後只剩 head 留在退場端可視格，
         * 身體已經在顯示區外 —— 那是滾動的必經狀態，不是特例。
         */
        const exitTruncationCells = this.createExitTruncationCells(
            visibleResultEntryCells,
            cellSpanResolver,
        );
        const resultEntryCells = [
            ...exitTruncationCells,
            ...visibleResultEntryCells,
        ];

        /*
         * 收尾：若最後一格所屬的 group 尚未湊滿，補上缺少的格數。
         * 這幾格會停在進場端 buffer，正是「被顯示區截斷的大 Symbol」
         * 那張圖的 head 所在。不是特例處理，是同一條規則跑到 offset 歸零。
         */
        const completionCells = this.createGroupCompletionCells(
            resultEntryCells,
            cellSpanResolver,
        );
        const remainingPerformanceData =
            this._dataList.remainingData;

        /*
         * 進場端那一組已經被拆成 1×1，它還沒讀的尾段就排在
         * remainingData 最前面（表演 Symbol 入列時整組展開成連續 Cell，
         * 而進場端最外格正是最後一個被消耗的 Cell）。整組都不存在了，
         * 這幾格也一起丟掉。
         */
        const survivingPerformanceData =
            remainingPerformanceData.slice(dissolvedEntryGroupCellCount);
        const retainedPerformanceCells =
            performanceCellBudget === undefined
                ? [...survivingPerformanceData]
                : this.takePerformanceCellsByBudget(
                    survivingPerformanceData,
                    performanceCellBudget,
                    cellSpanResolver,
                    performanceDataProvider,
                    validator,
                );
        const resultSegment = [
            ...resultEntryCells,
            ...completionCells,
        ];

        this._dataList.replaceRemaining([
            ...retainedPerformanceCells,
            ...resultSegment,
            ...requiredTail,
        ]);
        this._resultStartIndex =
            this._dataList.length
            - resultSegment.length
            - requiredTail.length;
        this._resultEndIndex =
            this._resultStartIndex + resultSegment.length;
        this._resultExitPadCellCount = exitTruncationCells.length;

        return retainedPerformanceCells.length;
    }

    /**
     * 向表演牌庫要一張 1×1 Symbol。
     *
     * 與 `insertPerformanceCellsBeforeResult()` 用同一條搜尋，差別只在
     * 取一張、而且**不進資料佇列** —— 這張是拿去改寫 strip 上已經進場、
     * 卻湊不滿的那組 Cell（見 `BaseReel.dissolveIncompleteEntryGroup()`）。
     */
    public takeSingleCellPerformanceSymbol(
        cellSpanResolver: ReelCellSpanResolver,
        performanceDataProvider: ReelPerformanceDataProvider,
        validator: ReelDataValidator,
    ): SymbolData | undefined {
        return this.takeNextPerformanceSymbol(
            (cellSpan) => cellSpan === 1,
            cellSpanResolver,
            performanceDataProvider,
            validator,
        );
    }

    /**
     * 略過正式結果前仍未消耗的表演資料。
     *
     * 資料列表以 Cell 為單位，所以不再需要 cellSpanResolver。
     */
    public pendingCellCountBeforeResult(): number {
        if (!this.resultCommitted) {
            return 0;
        }

        return Math.max(
            0,
            this._resultStartIndex - this._dataList.readIndex,
        );
    }

    /**
     * 還要消耗幾格才輪到**結果本體**的第一格。
     *
     * 與 `pendingCellCountBeforeResult()` 差在退場端的墊格：那幾格被併
     * 在 resultSegment 的開頭，所以 `_resultStartIndex` 指的是墊格而不是
     * 本體。停輪行程要算到本體，用這個；**砍除範圍不能用這個** ——
     * `skipPendingPerformanceData()` 只能砍到 `_resultStartIndex`，墊格
     * 砍掉盤面就壞了。兩個計數刻意分開，不要合併。
     */
    public pendingCellCountBeforeResultBody(): number {
        if (!this.resultCommitted) {
            return 0;
        }

        return Math.max(
            0,
            this._resultStartIndex
            + this._resultExitPadCellCount
            - this._dataList.readIndex,
        );
    }

    public skipPendingPerformanceData(): ReelQuickStopSkipResult {
        if (!this.resultCommitted) {
            return {
                skippedDataCount: 0,
                skippedCellCount: 0,
            };
        }

        const skipCount =
            this._resultStartIndex - this._dataList.readIndex;

        if (skipCount <= 0) {
            return {
                skippedDataCount: 0,
                skippedCellCount: 0,
            };
        }

        /* 資料列表以 Cell 為單位，筆數即 Cell 數。 */
        return {
            skippedDataCount: this._dataList.skip(skipCount),
            skippedCellCount: skipCount,
        };
    }

    /**
     * 在已排定的正式結果前補入指定 Cell 數的表演牌。
     *
     * Turbo QuickStop 會先略過原本的表演資料，再由多軸控制層依各軸
     * 當下真實相位補回差額，使所有軸使用相同 half-Cell 數到達結果。
     */
    public insertPerformanceCellsBeforeResult(
        cellCount: number,
        cellSpanResolver: ReelCellSpanResolver,
        performanceDataProvider: ReelPerformanceDataProvider,
        validator: ReelDataValidator,
    ): number {
        /*
         * 結果第一格（含退場端墊格）已進場就不能再補：補牌是插在「目前讀到
         * 的位置」前面，那時會落在結果中間，把結果切成兩段 —— 永遠對不齊、
         * 這一軸停不下來（實測 Turbo + stopTimings 結果先到後急停，5 軸只停 4 軸）。
         */
        if (
            !this.resultCommitted
            || cellCount <= 0
            || !this.canInsertBeforeResult
        ) {
            return 0;
        }

        /*
         * 補牌只用 1×1：每一格自成一個完整 group，任何數量都湊得出來。
         * 若改用多格 Symbol，補入 N 格就必須讓 N 能被該 Symbol 的
         * cellSpan 整除，否則會在結果前留下一個不完整的 group。
         */
        const padding: SymbolData[] = [];

        for (let index = 0; index < cellCount; index++) {
            const item = this.takeNextPerformanceSymbol(
                (cellSpan) => cellSpan === 1,
                cellSpanResolver,
                performanceDataProvider,
                validator,
            );

            if (item === undefined) {
                throw new Error(
                    "Turbo QuickStop synchronization requires "
                    + "at least one 1x1 performance Symbol.",
                );
            }

            padding.push(item);
        }

        this._dataList.replaceRemaining([
            ...padding,
            ...this._dataList.remainingData,
        ]);
        this._resultStartIndex += padding.length;
        this._resultEndIndex += padding.length;
        return padding.length;
    }

    /** 釋放全部輪次資料與內部讀取狀態。 */
    public cleanup(): void {
        this._dataList.reset();
        this._performanceDataBank.length = 0;
        this._performanceDataReadIndex = 0;
        this.clearResultSegment();
        this._spinId = 0;
    }

    private clearResultSegment(): void {
        this._committedResult.length = 0;
        this._resultStartIndex = -1;
        this._resultEndIndex = -1;
        this._resultExitPadCellCount = 0;
    }

    /**
     * 把以 Symbol 為單位的資料展開成逐 Cell。
     *
     * 1×N 會展開成 N 筆同一個 SymbolData 參考（不 clone）；
     * groupOffset 不在這裡決定，而是由 ReelIconManager 在綁定時
     * 依「朝退場方向的鄰居」推導，因為那才知道實際的相鄰關係。
     */
    private expandSymbolsToCells(
        data: SymbolData[],
        cellSpanResolver: ReelCellSpanResolver,
    ): SymbolData[] {
        const cells: SymbolData[] = [];

        for (const symbol of data) {
            const cellSpan = cellSpanResolver(symbol);

            for (let index = 0; index < cellSpan; index++) {
                cells.push(symbol);
            }
        }

        return cells;
    }

    /**
     * 依「退場端 → 進場端」掃描結果，算出進場端那一組還缺幾格，
     * 並產生補齊用的 Cell。
     *
     * 掃描規則與 ReelIconManager 綁定時用的完全相同：
     * 前一格同 id 且尚未湊滿就接續，否則開新組。
     *
     * 例：7 為三格 Symbol、盤面三格、Server 給 [7,7,1]。
     * 進場順序為 1 → 7 → 7，掃完最後一格的 offset 是 1，
     * 因此補一格 7；那一格就是這張被截斷的 1×3 的 head，
     * 停在進場端 buffer 內。
     *
     * 第一格一律開新組 —— 結果之前的表演資料永遠以完整 group 結尾
     * （表演 Symbol 入列時整組展開），所以邊界不會意外接在一起。
     */
    /** Server 的畫面閱讀順序 → 進場順序（退場端 → 進場端）。 */
    private toResultEntryCells(
        visibleResult: SymbolData[],
        reverseResultEntry: boolean,
    ): SymbolData[] {
        return reverseResultEntry
            ? [...visibleResult].reverse()
            : [...visibleResult];
    }

    /**
     * 退場端被截斷時，要墊在結果**前面**的格數。
     *
     * 供停輪規劃在提交前預估行程使用（那幾格比結果更早進場，
     * 會讓結果多走同樣的格數）。
     */
    public countExitTruncationCells(
        visibleResult: SymbolData[],
        reverseResultEntry: boolean,
        cellSpanResolver: ReelCellSpanResolver,
    ): number {
        return this.createExitTruncationCells(
            this.toResultEntryCells(visibleResult, reverseResultEntry),
            cellSpanResolver,
        ).length;
    }

    /**
     * 退場端截斷的補格，與 `createGroupCompletionCells()` 互為鏡像。
     *
     * head 恆在進場側，所以一張大 Symbol 出場時，最後留在可視區的是它的
     * **head**，身體已經落到顯示區外。這幾格比結果更早進場，因此要墊在
     * 結果**前面**（`resultEntryCells` 的開頭就是退場端）。
     *
     * 例：7 為三格 Symbol、盤面三格、Server 給 `[1,2,7]`（畫面上→下）。
     * 進場順序是 `7 → 2 → 1`，開頭那段 run 只有 1 格，離 cellSpan 3 還差
     * 2 格，因此墊 2 格 7。結果對齊後可視段是 `1:0 2:0 7:0`，最下面那格
     * 是 head，圖往顯示區外延伸兩格。
     *
     * **run 一路延伸到進場端時不處理**（整個盤面同一個 id）：缺口落在哪一
     * 端從盤面判斷不出來，維持既有約定交給 `createGroupCompletionCells()`
     * 補在進場端。`cellSpan <= visibleCellCount` 的前提下，這只會發生在
     * 盤面被單一 Symbol 填滿的情況。
     */
    private createExitTruncationCells(
        resultEntryCells: SymbolData[],
        cellSpanResolver: ReelCellSpanResolver,
    ): SymbolData[] {
        if (resultEntryCells.length === 0) {
            return [];
        }

        const exitCell = resultEntryCells[0];
        let runLength = 1;

        while (
            runLength < resultEntryCells.length
            && resultEntryCells[runLength].id === exitCell.id
        ) {
            runLength++;
        }

        if (runLength === resultEntryCells.length) {
            return [];
        }

        const cellSpan = cellSpanResolver(exitCell);
        const remainder = runLength % cellSpan;

        if (remainder === 0) {
            return [];
        }

        const cells: SymbolData[] = [];

        for (let index = 0; index < cellSpan - remainder; index++) {
            cells.push(exitCell);
        }

        return cells;
    }

    private createGroupCompletionCells(
        resultEntryCells: SymbolData[],
        cellSpanResolver: ReelCellSpanResolver,
    ): SymbolData[] {
        if (resultEntryCells.length === 0) {
            return [];
        }

        let previous: SymbolData | undefined;
        let offset = 0;

        for (const cell of resultEntryCells) {
            const continuesGroup =
                previous !== undefined
                && previous.id === cell.id
                && offset > 0;

            offset = continuesGroup
                ? offset - 1
                : cellSpanResolver(cell) - 1;
            previous = cell;
        }

        const lastCell = resultEntryCells[resultEntryCells.length - 1];
        const completion: SymbolData[] = [];

        for (let index = 0; index < offset; index++) {
            completion.push(lastCell);
        }

        return completion;
    }

    /**
     * 依 Cell 預算保留表演資料。
     *
     * 資料列表已是逐 Cell，所以預算就是筆數。既有未讀資料直接取用；
     * 不足時向表演資料來源要新的 Symbol 並整組展開成 Cell。
     *
     * 剩餘預算放不下一整組時改用 1×1 補滿 —— 這樣時間永遠精確，
     * 代價只是最後幾格的表演牌長相受限。牌庫因此至少要有一張 1×1。
     */
    private takePerformanceCellsByBudget(
        remainingCells: SymbolData[],
        cellBudget: number,
        cellSpanResolver: ReelCellSpanResolver,
        performanceDataProvider: ReelPerformanceDataProvider,
        validator: ReelDataValidator,
    ): SymbolData[] {
        const result: SymbolData[] = [];

        /*
         * 逐「組」取，不逐格取。
         *
         * remainingCells 必定從 group 邊界開始 —— 表演 Symbol 入列時整組
         * 展開成連續 Cell，而進場端那組沒讀完的尾段已由決議 30
         * （ReelIconManager.dissolveIncompleteEntryGroup()）先丟掉，
         * 所以每次前進一個 cellSpan 就正好落在下一組的開頭。
         *
         * 遇到第一個放不進預算的組就停，不切一半：切一半會在正式結果
         * 正前面留下一個湊不滿的 group，結果的第一格不是被它吸走
         * （同 id），就是讓它變成永遠等不到 head 的孤兒 follower。
         * 這就是主線 doc §3.5 的「塞到放不下為止」。
         */
        let index = 0;

        while (index < remainingCells.length) {
            const cell = remainingCells[index];
            const cellSpan = cellSpanResolver(cell);

            if (result.length + cellSpan > cellBudget) {
                break;
            }

            for (let offset = 0; offset < cellSpan; offset++) {
                result.push(cell);
            }

            index += cellSpan;
        }

        /* 零頭由牌庫補滿；一樣只收整組塞得進去的牌（「尾巴用 1×1 補滿」）。 */
        while (result.length < cellBudget) {
            const shortfall = cellBudget - result.length;
            const symbol = this.takeNextPerformanceSymbol(
                (cellSpan) => cellSpan <= shortfall,
                cellSpanResolver,
                performanceDataProvider,
                validator,
            );

            if (symbol === undefined) {
                break;
            }

            const cellSpan = cellSpanResolver(symbol);

            for (let index = 0; index < cellSpan; index++) {
                result.push(symbol);
            }
        }

        return result;
    }

    /**
     * 向表演資料來源要一張 `accepts()` 接受的 Symbol。
     *
     * 兩種用途共用同一條迴圈，只有判斷式不同：
     * 裝箱收尾要「塞得進剩餘預算」（`cellSpan <= shortfall`），
     * Turbo 同步補牌要「恰好一格」（`cellSpan === 1`）。
     *
     * 最多搜尋表演牌庫一輪，避免牌都過大時無限循環。
     */
    private takeNextPerformanceSymbol(
        accepts: (cellSpan: number) => boolean,
        cellSpanResolver: ReelCellSpanResolver,
        performanceDataProvider: ReelPerformanceDataProvider,
        validator: ReelDataValidator,
    ): SymbolData | undefined {
        const searchLimit = Math.max(
            1,
            this._performanceDataBank.length,
        );

        for (let index = 0; index < searchLimit; index++) {
            const item = performanceDataProvider();
            validator(
                item,
                "getNextPerformanceData result",
            );

            if (accepts(cellSpanResolver(item))) {
                return item;
            }
        }

        return undefined;
    }

}
