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
    private _timing?: ReelTimingConfig;
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

    public get quickStopRequested(): boolean {
        return this._quickStopRequested;
    }

    public get resultEntryPending(): boolean {
        return this._visibleResult !== undefined;
    }

    public get pendingVisibleResult(): SymbolData[] {
        return this._visibleResult ?? [];
    }

    public get pendingRequiredTail(): SymbolData[] {
        return this._requiredTail;
    }

    public get targetStopTime(): number | undefined {
        return this._timing?.targetStopTime;
    }

    public get moveInterval(): number {
        return this._timing?.moveInterval ?? 0;
    }

    public setTiming(config: ReelTimingConfig): void {
        this._timing = {
            targetStopTime: config.targetStopTime,
            moveInterval: config.moveInterval,
        };
    }

    public setTargetStopTime(targetStopTime: number): void {
        if (this._timing !== undefined) {
            this._timing.targetStopTime = targetStopTime;
        }
    }

    public setMoveInterval(moveInterval: number): void {
        if (this._timing !== undefined) {
            this._timing.moveInterval = moveInterval;
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
        completedHalfCellCount: number,
        resultEntryHalfCellCount: number,
    ): boolean {
        const visibleResult = this._visibleResult;
        const targetStopTime = this._timing?.targetStopTime;

        if (
            visibleResult === undefined
            || targetStopTime === undefined
        ) {
            return false;
        }

        const halfCellDuration = moveInterval * 0.5;
        let targetRemainingHalfCellCount = Math.max(
            0,
            Math.floor(
                (targetStopTime - this._elapsedRollTime)
                / halfCellDuration,
            ),
        );
        const requiredRemainingParity =
            completedHalfCellCount % 2;

        if (
            targetRemainingHalfCellCount % 2
            !== requiredRemainingParity
        ) {
            targetRemainingHalfCellCount = Math.max(
                0,
                targetRemainingHalfCellCount - 1,
            );
        }

        const directResultStopTime =
            this._elapsedRollTime
            + resultEntryHalfCellCount * halfCellDuration;
        const performanceCellBudget =
            this._quickStopRequested
                ? this._quickStopPerformanceCellBudget ?? 0
                : Math.max(
                    0,
                    Math.floor(
                        (
                            targetRemainingHalfCellCount
                            - resultEntryHalfCellCount
                        ) / 2,
                    ),
                );
        const retainedPerformanceCellCount =
            this._dataFlow.commitResult(
                visibleResult,
                this._requiredTail,
                performanceCellBudget,
                this._reverseResultEntry,
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

    public applyQuickStopSkip(skip: ReelQuickStopSkip): void {
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
                    * this.getMoveInterval(),
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
    public applyQuickStopPadding(cellCount: number): void {
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
                + cellCount * this.getMoveInterval(),
            performanceCellCount:
                this._lastStopPlan.performanceCellCount
                + cellCount,
        };
    }

    public cleanup(): void {
        this._timing = undefined;
        this.beginSpin();
    }

    private confirmResultEntryPlan(plan: ReelResultEntryPlan): void {
        if (
            this._timing === undefined
            || this._resultReceivedTime === undefined
        ) {
            return;
        }

        let expediteReason = ReelExpediteReason.None;

        if (this._quickStopRequested) {
            expediteReason = ReelExpediteReason.QuickStop;
        } else if (
            plan.directResultStopTime
            >= this._timing.targetStopTime
        ) {
            expediteReason = ReelExpediteReason.ServerLate;
        }

        this._lastStopPlan = {
            resultReceivedTime: this._resultReceivedTime,
            requestedStopTime: this._timing.targetStopTime,
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
                - this._timing.targetStopTime,
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

    /**
     * Server 結果本身是逐 Cell 資料；兩端各有一格 Buffer，
     * 因此從第一張結果進場到完整對齊，固定需要可視 Cell 加兩格。
     *
     * 這裡仍逐筆取得 cellSpan，確認重複 ID 代表同一張 1×N
     * Symbol 的可視 Cell，而不是把每筆都誤當成完整 Icon。
     */
    private getResultTravelCellCount(
        visibleResult: SymbolData[],
    ): number {
        const currentExitMissingCellCount =
            this.getExitMissingCellCount(visibleResult);

        /*
         * 一格用於結果從進場 Buffer 交接到 Display；
         * 頭尾缺口只保存 Cell 數，不反查 Icon Runtime 或未來位置。
         */
        return Math.max(
            0,
            visibleResult.length
            + 1
            + currentExitMissingCellCount
            - 0,
        );
    }

    private getExitMissingCellCount(
        visibleResult: SymbolData[],
    ): number {
        const exitIndex = this._reverseResultEntry
            ? visibleResult.length - 1
            : 0;
        const step = this._reverseResultEntry ? -1 : 1;
        const exitData = visibleResult[exitIndex];
        const cellSpan = this._cellSpanResolver(exitData);
        let visibleConsecutiveCellCount = 0;

        for (
            let index = exitIndex;
            index >= 0 && index < visibleResult.length;
            index += step
        ) {
            if (visibleResult[index].id !== exitData.id) {
                break;
            }

            visibleConsecutiveCellCount++;
        }

        return Math.max(
            0,
            cellSpan - visibleConsecutiveCellCount,
        );
    }

    private getMoveInterval(): number {
        return this._timing?.moveInterval ?? 0;
    }
}
