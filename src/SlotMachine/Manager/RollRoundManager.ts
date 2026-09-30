namespace slot_manager {
    /**
     * 滾輪型的 round 流程（§10.1）：滾輪可以不等資料就先起轉。
     *
     * - `startGame()` 一呼叫就起轉，接著等第一個 round 的資料；資料到了才走
     *   環節 1、2，環節 3 停輪（`stopSpin()` → `waitForSettledAsync()`）
     * - 後續 round（例如 FG）開始時滾輪沒在轉，環節 3 才起轉、接著停輪
     * - 有消除的 round 由掉落機台做消除（1024 這種先滾再掉的混合模式）
     *
     * 不另計最少滾動時間（§9 G8）：停輪時刻由滾輪機台的 `targetStopSeconds` 保證。
     */
    export class RollRoundManager extends BaseRoundManager {
        /**
         * 最近一次 `startSpin()` 的 Promise（全部軸已啟動才 resolve）。
         *
         * 在 `presentBoard()` 與 `stopSpin()` 一起等，出錯照樣往外丟；
         * 用過或 `cleanup()` 時清掉。
         */
        private _startSpinPromise: Promise<void> | null = null;

        /** 同 `BaseRoundManager.init()`；滾輪機台不可為 null。 */
        public init(
            roll: slot_core.ISlotMachine | null,
            drop: slot_drop.IDropSlotMachine | null,
        ): void {
            if (roll === null) {
                throw new Error(
                    "RollRoundManager requires a roll machine.",
                );
            }

            super.init(
                roll,
                drop,
            );
        }

        public cleanup(): void {
            this._startSpinPromise = null;
            super.cleanup();
        }

        /**
         * 起轉用哪個 SpinConfig 模式（例如 Turbo）；由遊戲決定。
         *
         * 一局的第一個 round 在資料到之前就起轉，那時 `round` 為 `null`。
         *
         * 留給繼承類別。框架不知道遊戲註冊了哪些模式，沒有合理的預設值，預設 throw。
         */
        protected getSpinMode(round: RoundData | null): slot_core.SpinMode {
            throw new Error(
                "RollRoundManager.getSpinMode() must be implemented by a subclass.",
            );
        }

        protected async beginGame(): Promise<void> {
            this.startSpinning(null);
        }

        protected async presentBoard(
            context: RoundStepContext,
        ): Promise<void> {
            const machine = this.requireRollMachine();

            if (!machine.spinning) {
                this.startSpinning(context.round);
            }

            /*
             * stopSpin() 先登記結果、再自己等起轉完成，所以照原時機呼叫，
             * 不先等起轉；起轉的 Promise 在這裡一起等，出錯不會被吞掉。
             */
            const started = this.takeStartSpinPromise();
            await Promise.all([
                started,
                machine.stopSpin(context.round.board),
            ]);
            await machine.waitForSettledAsync();
        }

        private startSpinning(round: RoundData | null): void {
            this._startSpinPromise = this.requireRollMachine().startSpin(
                this.getSpinMode(round),
            );
        }

        /** 取走最近一次起轉的 Promise；沒有（例如已經等過）時回已完成的 Promise。 */
        private takeStartSpinPromise(): Promise<void> {
            const started = this._startSpinPromise;
            this._startSpinPromise = null;

            if (started === null) {
                return Promise.resolve();
            }

            return started;
        }
    }
}
