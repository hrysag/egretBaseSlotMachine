import { ReelTimingConfig } from "../Config/ReelTimingConfig";
import { SymbolData } from "../Data/SymbolData";
import {
    ReelExpediteReason,
    ReelStopPlan,
} from "../Runtime/ReelStopPlan";
import {
    ReelCellSpanResolver,
    ReelDataFlow,
    ReelDataValidator,
    ReelPerformanceDataProvider,
} from "./ReelDataFlow";

export interface ReelQuickStopSkip {
    skippedDataCount: number;
    skippedCellCount: number;
}

interface ReelResultEntryPlan {
    directResultStopTime: number;
    selectedStopTime: number;
    retainedPerformanceCellCount: number;
}

/** 管理單軸結果進場、QuickStop、ServerLate 與停止時間規劃。 */
export class ReelStopFlow {
    private _targetStopTime?: number;
    private _lastStopPlan?: ReelStopPlan;
    private _elapsedRollTime = 0;
    private _quickStopRequested = false;
    private _resultReceivedTime?: number;
    private _resultReceivedMovementTime = 0;
    private _visibleResult?: SymbolData[];
    private _requiredTail: SymbolData[] = [];
    private _reverseResultEntry = false;
    private _quickStopPerformanceCellBudget?: number;

    public constructor(
        private readonly _dataFlow: ReelDataFlow,
        private readonly _cellSpanResolver: ReelCellSpanResolver,
        private readonly _performanceDataProvider:
            ReelPerformanceDataProvider,
        private readonly _dataValidator: ReelDataValidator,
    ) {}

    public get elapsedRollTime(): number {
        return this._elapsedRollTime;
    }

    public get lastStopPlan(): ReelStopPlan | undefined {
        return this._lastStopPlan;
    }

    public get resultEntryPending(): boolean {
        return this._visibleResult !== undefined;
    }

    /**
     * 尚未提交的結果會在自己前面墊幾格（退場端截斷的鏡像補格）。
     *
     * Turbo 同步補牌在 `BaseSlotMachine.stopSpin()` 內、`commitResult()`
     * 之後立刻決定，但那時 `commitResult()` 只把結果記進本類別，**一格
     * 資料都還沒寫進佇列** —— 真正墊格要等到下一個 Cell 邊界的
     * `tryCommitResultAtHandoff()`。所以補牌決策看不到這幾格，各軸墊的
     * 數量不同時就會失步（實測 360 組，誤差精確等於墊格數）。
     *
     * 這裡先算出來給 `BaseReel.calculateQuickStopHalfCellCount()` 用，
     * 走的是與 `tryCommitResultAtHandoff()` **同一個**
     * `countExitTruncationCells()`，不會產生第二份推導。
     *
     * 進場端截斷的補格**不算** —— 那幾格接在結果後面，盤面對齊之後才
     * 進場，不影響停輪時間（實測 `[7,7,1]`／`[7,1,1]` 皆無延遲）。
     */
    public get pendingExitTruncationCellCount(): number {
        const visibleResult = this._visibleResult;

        if (visibleResult === undefined) {
            return 0;
        }

        return this._dataFlow.countExitTruncationCells(
            visibleResult,
            this._reverseResultEntry,
            this._cellSpanResolver,
        );
    }

    public get targetStopTime(): number | undefined {
        return this._targetStopTime;
    }

    public setTiming(config: ReelTimingConfig): void {
        this._targetStopTime = config.targetStopTime;
    }

    public setTargetStopTime(targetStopTime: number): void {
        if (this._targetStopTime !== undefined) {
            this._targetStopTime = targetStopTime;
        }
    }

    public beginSpin(): void {
        this._lastStopPlan = undefined;
        this._elapsedRollTime = 0;
        this._quickStopRequested = false;
        this._resultReceivedTime = undefined;
        this._resultReceivedMovementTime = 0;
        this._quickStopPerformanceCellBudget = undefined;
        this.clearResultEntry();
    }

    public updateElapsed(deltaTime: number): void {
        this._elapsedRollTime += deltaTime;
    }

    public receiveResult(
        result: SymbolData[],
        requiredTail: SymbolData[],
        currentMovementTime: number,
        reverseResultEntry: boolean,
    ): void {
        this._visibleResult = [...result];
        this._requiredTail = [...requiredTail];
        this._resultReceivedTime = this._elapsedRollTime;
        this._resultReceivedMovementTime = currentMovementTime;
        this._reverseResultEntry = reverseResultEntry;
        this._lastStopPlan = undefined;
    }

    /**
     * 在真實退場端 Handoff 將剩餘時間量化成完整 Cell。
     *
     * 停輪規劃只使用時間與資料的 cellSpan，不讀取 Icon 位置，
     * 也不預演未來 Movement。算出的 Cell 預算直接交給 DataFlow。
     */
    public tryCommitResultAtHandoff(
        moveInterval: number,
        resultEntryHalfCellCount: number,
        dissolvedEntryGroupCellCount: number,
    ): boolean {
        const visibleResult = this._visibleResult;
        const targetStopTime = this._targetStopTime;

        if (
            visibleResult === undefined
            || targetStopTime === undefined
        ) {
            return false;
        }

        /*
         * 退場端截斷時要墊在結果前面的格數（ReelDataFlow 的鏡像補格）。
         * 那幾格比結果更早進場，結果因此多走同樣的格數，行程要先算進來，
         * 否則停輪時間會短算。
         */
        const exitTruncationCellCount =
            this._dataFlow.countExitTruncationCells(
                visibleResult,
                this._reverseResultEntry,
                this._cellSpanResolver,
            );
        const totalResultEntryHalfCellCount =
            resultEntryHalfCellCount + exitTruncationCellCount * 2;

        /*
         * 每格等寬之後相位恆定：提交固定發生在第二個半格結束，
         * 剩餘半格數必為偶數，1×N 時代的奇偶修正已不需要。
         */
        const halfCellDuration = moveInterval * 0.5;
        const targetRemainingHalfCellCount = Math.max(
            0,
            Math.floor(
                (targetStopTime - this._elapsedRollTime)
                / halfCellDuration,
            ),
        );

        const directResultStopTime =
            this._elapsedRollTime
            + totalResultEntryHalfCellCount * halfCellDuration;
        const performanceCellBudget =
            this._quickStopRequested
                ? (this._quickStopPerformanceCellBudget !== undefined
                    ? this._quickStopPerformanceCellBudget
                    : 0)
                : Math.max(
                    0,
                    Math.floor(
                        (
                            targetRemainingHalfCellCount
                            - totalResultEntryHalfCellCount
                        ) / 2,
                    ),
                );
        const retainedPerformanceCellCount =
            this._dataFlow.commitResult(
                visibleResult,
                this._requiredTail,
                performanceCellBudget,
                this._reverseResultEntry,
                dissolvedEntryGroupCellCount,
                this._cellSpanResolver,
                this._performanceDataProvider,
                this._dataValidator,
            );
        const selectedStopTime =
            directResultStopTime
            + retainedPerformanceCellCount * moveInterval;

        this.confirmResultEntryPlan({
            directResultStopTime,
            selectedStopTime,
            retainedPerformanceCellCount,
        });
        this.clearResultEntry();
        return true;
    }

    /**
     * 結果尚未真正交給 DataFlow 時，暫存 Turbo 同步所需的補牌 Cell。
     * 實際資料仍只會在下一個真實 Handoff 一次建立。
     */
    public setQuickStopPerformanceCellBudget(
        cellCount: number,
    ): void {
        this._quickStopPerformanceCellBudget = cellCount;
    }

    public requestQuickStop(): boolean {
        if (this._quickStopRequested) {
            return false;
        }

        this._quickStopRequested = true;
        return true;
    }

    public applyQuickStopSkip(
        skip: ReelQuickStopSkip,
        moveInterval: number,
    ): void {
        if (this._lastStopPlan === undefined) {
            return;
        }

        const updatedPerformanceCellCount = Math.max(
            0,
            this._lastStopPlan.performanceCellCount
            - skip.skippedCellCount,
        );
        const updatedStopTime =
            skip.skippedCellCount === 0
                ? this._lastStopPlan.actualStopTime
                : Math.max(
                    this._elapsedRollTime,
                    this._lastStopPlan.actualStopTime
                    - skip.skippedCellCount
                    * moveInterval,
                );

        this._lastStopPlan = {
            ...this._lastStopPlan,
            actualStopTime: updatedStopTime,
            performanceCellCount: updatedPerformanceCellCount,
            quickStopSkippedDataCount:
                this._lastStopPlan.quickStopSkippedDataCount
                + skip.skippedDataCount,
            quickStopSkippedCellCount:
                this._lastStopPlan.quickStopSkippedCellCount
                + skip.skippedCellCount,
            expediteReason: ReelExpediteReason.QuickStop,
        };
    }

    /** 將 Turbo 同步補回的表演 Cell 反映到除錯用 StopPlan。 */
    public applyQuickStopPadding(
        cellCount: number,
        moveInterval: number,
    ): void {
        if (
            this._lastStopPlan === undefined
            || cellCount <= 0
        ) {
            return;
        }

        this._lastStopPlan = {
            ...this._lastStopPlan,
            actualStopTime:
                this._lastStopPlan.actualStopTime
                + cellCount * moveInterval,
            performanceCellCount:
                this._lastStopPlan.performanceCellCount
                + cellCount,
        };
    }

    public cleanup(): void {
        this._targetStopTime = undefined;
        this.beginSpin();
    }

    private confirmResultEntryPlan(plan: ReelResultEntryPlan): void {
        if (
            this._targetStopTime === undefined
            || this._resultReceivedTime === undefined
        ) {
            return;
        }

        let expediteReason = ReelExpediteReason.None;

        if (this._quickStopRequested) {
            expediteReason = ReelExpediteReason.QuickStop;
        } else if (
            plan.directResultStopTime
            >= this._targetStopTime
        ) {
            expediteReason = ReelExpediteReason.ServerLate;
        }

        this._lastStopPlan = {
            resultReceivedTime: this._resultReceivedTime,
            requestedStopTime: this._targetStopTime,
            currentMovementTime:
                this._resultReceivedMovementTime,
            minimumResultTravelTime:
                plan.directResultStopTime
                - this._resultReceivedTime,
            earliestStopTime: plan.directResultStopTime,
            actualStopTime: plan.selectedStopTime,
            performanceCellCount:
                plan.retainedPerformanceCellCount,
            quickStopSkippedDataCount: 0,
            quickStopSkippedCellCount: 0,
            lateBy: Math.max(
                0,
                plan.directResultStopTime
                - this._targetStopTime,
            ),
            expediteReason,
        };
    }

    private clearResultEntry(): void {
        this._visibleResult = undefined;
        this._requiredTail = [];
        this._reverseResultEntry = false;
        this._quickStopPerformanceCellBudget = undefined;
    }

}
