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

    /** 取代表演牌庫，並清除上一輪尚未完成的結果區段。 */
    public setPerformanceDataBank(
        data: SymbolData[],
    ): void {
        this._dataList.reset();
        this._dataList.append(data);
        this._performanceDataBank.length = 0;
        this._performanceDataBank.push(...data);
        this._performanceDataReadIndex = 0;
        this.clearResultSegment();
    }

    /** 正式結果尚未提交時，追加可循環使用的表演資料。 */
    public appendPerformanceData(
        data: SymbolData[],
    ): void {
        if (this.resultCommitted) {
            throw new Error(
                "Performance data cannot be appended after the result is committed.",
            );
        }

        this._dataList.append(data);
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

        const performanceData = performanceDataProvider();
        validator(
            performanceData,
            "getNextPerformanceData result",
        );
        this._dataList.append([performanceData]);
        const consumedPerformanceData = this._dataList.consume();

        return consumedPerformanceData === undefined
            ? undefined
            : { data: consumedPerformanceData };
    }

    /**
     * 以「保留表演資料＋反向進場結果＋必要尾牌」替換未讀資料，
     * 並記錄本輪正式結果在完整資料列表中的區段。
     *
     * 未提供 Cell 預算時保留全部未讀表演資料。
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

        const resultIconData = this.collapseResultCellData(
            visibleResult,
            cellSpanResolver,
        );
        const remainingPerformanceData =
            this._dataList.remainingData;
        const retainedPerformanceData =
            performanceCellBudget === undefined
                ? [...remainingPerformanceData]
                : this.takeDataByCellBudget(
                    remainingPerformanceData,
                    performanceCellBudget,
                    cellSpanResolver,
                    performanceDataProvider,
                    validator,
                );
        const resultEntryData = reverseResultEntry
            ? [...resultIconData].reverse()
            : [...resultIconData];

        this._dataList.replaceRemaining([
            ...retainedPerformanceData,
            ...resultEntryData,
            ...requiredTail,
        ]);
        this._resultStartIndex =
            this._dataList.length
            - resultIconData.length
            - requiredTail.length;
        this._resultEndIndex =
            this._resultStartIndex + resultIconData.length;

        return this.countCells(
            retainedPerformanceData,
            cellSpanResolver,
        );
    }

    /** 略過正式結果前仍未消耗的表演資料。 */
    public skipPendingPerformanceData(
        cellSpanResolver: ReelCellSpanResolver,
    ): ReelQuickStopSkipResult {
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

        const skippedData = this._dataList.preview(skipCount);
        const skippedCellCount = this.countCells(
            skippedData,
            cellSpanResolver,
        );

        return {
            skippedDataCount: this._dataList.skip(skipCount),
            skippedCellCount,
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

        const padding: SymbolData[] = [];

        for (let index = 0; index < cellCount; index++) {
            const item = this.takeNextSingleCellPerformanceData(
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
        const retainedCellCount = this.countCells(
            padding,
            cellSpanResolver,
        );

        if (retainedCellCount !== cellCount) {
            throw new Error(
                "Performance data bank cannot provide the required "
                + `${cellCount} synchronization Cells.`,
            );
        }

        this._dataList.replaceRemaining([
            ...padding,
            ...this._dataList.remainingData,
        ]);
        this._resultStartIndex += padding.length;
        this._resultEndIndex += padding.length;
        return retainedCellCount;
    }

    public countCells(
        data: SymbolData[],
        cellSpanResolver: ReelCellSpanResolver,
    ): number {
        let total = 0;

        for (const item of data) {
            total += cellSpanResolver(item);
        }

        return total;
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
     * 將 Server 的逐 Cell 結果還原成需要進場的完整 Icon 資料。
     *
     * 例如 7 為三格 Symbol 時，[7,7,1] 代表一個部分可見的 7
     * 與一個 1，不會建立成兩個三格高的 7。
     */
    private collapseResultCellData(
        resultCells: SymbolData[],
        cellSpanResolver: ReelCellSpanResolver,
    ): SymbolData[] {
        const result: SymbolData[] = [];
        let index = 0;

        while (index < resultCells.length) {
            const data = resultCells[index];
            const cellSpan = cellSpanResolver(data);
            let repeatedCells = 1;

            while (
                repeatedCells < cellSpan
                && index + repeatedCells < resultCells.length
                && resultCells[index + repeatedCells].id === data.id
            ) {
                repeatedCells++;
            }

            result.push(data);
            index += repeatedCells;
        }

        return result;
    }

    private takeDataByCellBudget(
        data: SymbolData[],
        cellBudget: number,
        cellSpanResolver: ReelCellSpanResolver,
        performanceDataProvider: ReelPerformanceDataProvider,
        validator: ReelDataValidator,
    ): SymbolData[] {
        const result: SymbolData[] = [];
        let retainedCells = 0;

        for (const item of data) {
            if (retainedCells >= cellBudget) {
                break;
            }

            const cellSpan = cellSpanResolver(item);

            if (retainedCells + cellSpan > cellBudget) {
                continue;
            }

            result.push(item);
            retainedCells += cellSpan;
        }

        while (retainedCells < cellBudget) {
            const item = this.takeNextPerformanceDataThatFits(
                cellBudget - retainedCells,
                cellSpanResolver,
                performanceDataProvider,
                validator,
            );

            if (item === undefined) {
                break;
            }

            result.push(item);
            retainedCells += cellSpanResolver(item);
        }

        return result;
    }

    /** 最多搜尋表演牌庫一輪，避免牌都過大時無限循環。 */
    private takeNextPerformanceDataThatFits(
        remainingCells: number,
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

            if (cellSpanResolver(item) <= remainingCells) {
                return item;
            }
        }

        return undefined;
    }

    /** Turbo 同步補牌只能使用 1×1，避免多格 Symbol 改變 Handoff 相位。 */
    private takeNextSingleCellPerformanceData(
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

            if (cellSpanResolver(item) === 1) {
                return item;
            }
        }

        return undefined;
    }

}
