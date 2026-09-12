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
     * @returns 實際保留的表演 Cell 數
     */
    public commitResult(
        visibleResult: SymbolData[],
        requiredTail: SymbolData[],
        performanceCellBudget: number | undefined,
        reverseResultEntry: boolean,
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
        const resultEntryCells = reverseResultEntry
            ? [...visibleResult].reverse()
            : [...visibleResult];

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
        const retainedPerformanceCells =
            performanceCellBudget === undefined
                ? [...remainingPerformanceData]
                : this.takePerformanceCellsByBudget(
                    remainingPerformanceData,
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

        return retainedPerformanceCells.length;
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
        if (!this.resultCommitted || cellCount <= 0) {
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
        const result = remainingCells.slice(0, cellBudget);

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
