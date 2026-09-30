namespace slot_core {
    export interface ReelQuickStopSkip {
        skippedDataCount: number;
        skippedCellCount: number;
    }

    interface ReelResultEntryPlan {
        directResultStopTime: number;
        selectedStopTime: number;
        retainedPerformanceCellCount: number;
    }

    /**
     * `ReelStopFlow.init()` 收下的相依：同一軸（`BaseReel`）的資料佇列與三個查詢。
     *
     * 四者都是 `BaseReel` 自己持有、整個生命週期不變的物件。
     */
    interface ReelStopFlowDependencies {
        readonly dataFlow: ReelDataFlow;
        readonly cellSpanResolver: ReelCellSpanResolver;
        readonly performanceDataProvider: ReelPerformanceDataProvider;
        readonly dataValidator: ReelDataValidator;
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

        /** `init()` 之前為 null；`cleanup()` 不清（相依的生命週期與 `BaseReel` 相同）。 */
        private _dependencies: ReelStopFlowDependencies | null = null;

        /** 收下同一軸（`BaseReel`）的資料佇列與三個查詢；已 init 過時不做事。 */
        public init(
            dataFlow: ReelDataFlow,
            cellSpanResolver: ReelCellSpanResolver,
            performanceDataProvider: ReelPerformanceDataProvider,
            dataValidator: ReelDataValidator,
        ): void {
            if (this._dependencies !== null) {
                return;
            }

            this._dependencies = {
                dataFlow,
                cellSpanResolver,
                performanceDataProvider,
                dataValidator,
            };
        }

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

            const dependencies = this.dependencies;
            return dependencies.dataFlow.countExitTruncationCells(
                visibleResult,
                this._reverseResultEntry,
                dependencies.cellSpanResolver,
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
         *
         * `now` 是這個 Cell 邊界的**連續時間**（本軸逐格累加），不是
         * `elapsedRollTime` —— 後者每幀開頭就吃掉整幀，最多領先邊界一幀。
         * `availableCellCount` 是到目標為止放得下的完整 Cell 數，由 BaseReel
         * 依聽牌切速分段算好（決議 45）。
         *
         * @returns 從本邊界起到停輪還要走的 Cell 數；本次沒有提交時為 undefined
         */
        public tryCommitResultAtHandoff(
            moveInterval: number,
            resultEntryHalfCellCount: number,
            dissolvedEntryGroupCellCount: number,
            now: number,
            availableCellCount: number,
        ): number | undefined {
            const visibleResult = this._visibleResult;
            const targetStopTime = this._targetStopTime;

            if (
                visibleResult === undefined
                || targetStopTime === undefined
            ) {
                return undefined;
            }

            const dependencies = this.dependencies;

            /*
             * 退場端截斷時要墊在結果前面的格數（ReelDataFlow 的鏡像補格）。
             * 那幾格比結果更早進場，結果因此多走同樣的格數，行程要先算進來，
             * 否則停輪時間會短算。
             */
            const exitTruncationCellCount =
                dependencies.dataFlow.countExitTruncationCells(
                    visibleResult,
                    this._reverseResultEntry,
                    dependencies.cellSpanResolver,
                );
            const totalResultEntryHalfCellCount =
                resultEntryHalfCellCount + exitTruncationCellCount * 2;

            /*
             * 每格等寬之後相位恆定：提交固定發生在第二個半格結束，
             * 剩餘半格數必為偶數，1×N 時代的奇偶修正已不需要。
             */
            const halfCellDuration = moveInterval * 0.5;
            const resultEntryCellCount = totalResultEntryHalfCellCount / 2;

            const directResultStopTime =
                now + totalResultEntryHalfCellCount * halfCellDuration;
            const performanceCellBudget =
                this._quickStopRequested
                    ? (this._quickStopPerformanceCellBudget !== undefined
                        ? this._quickStopPerformanceCellBudget
                        : 0)
                    : Math.max(0, availableCellCount - resultEntryCellCount);
            const retainedPerformanceCellCount =
                dependencies.dataFlow.commitResult(
                    visibleResult,
                    this._requiredTail,
                    performanceCellBudget,
                    this._reverseResultEntry,
                    dissolvedEntryGroupCellCount,
                    dependencies.cellSpanResolver,
                    dependencies.performanceDataProvider,
                    dependencies.dataValidator,
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
            return resultEntryCellCount + retainedPerformanceCellCount;
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

        public get quickStopRequested(): boolean {
            return this._quickStopRequested;
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

        /**
         * 停輪計畫中 `switchAtSeconds` 之後的時間乘上 `ratio`（聽牌切速，決議 42）。
         *
         * 切速讓之後每格變成 `1 / m` 倍，計畫卻是以原速換算格數的，所以要把
         * 切速點之後那一段縮回真實時間；急停取消預定切速時再用 `m` 放回去。
         * 僅供除錯讀取，不影響停輪。
         */
        public rescaleStopPlanAfter(
            switchAtSeconds: number,
            ratio: number,
        ): void {
            const plan = this._lastStopPlan;

            if (plan === undefined || plan.actualStopTime <= switchAtSeconds) {
                return;
            }

            this._lastStopPlan = {
                ...plan,
                actualStopTime: switchAtSeconds
                    + (plan.actualStopTime - switchAtSeconds) * ratio,
            };
        }

        /**
         * 以每格自我修正預計達到的停輪時刻改寫計畫（決議 45）。
         *
         * 提交時算的是「每格都走原速」的格線時刻；修正會把格子稍微拉長，
         * 讓停輪落在目標上。僅供除錯讀取，不影響停輪。
         */
        public retimeStopPlan(actualStopTime: number): void {
            const plan = this._lastStopPlan;

            if (plan === undefined) {
                return;
            }

            this._lastStopPlan = {
                ...plan,
                actualStopTime,
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

        // ───────────────── 相依（init() 之後才有） ─────────────────

        private get dependencies(): ReelStopFlowDependencies {
            if (this._dependencies === null) {
                throw new Error(
                    "ReelStopFlow.init() must be called first.",
                );
            }

            return this._dependencies;
        }
    }
}
