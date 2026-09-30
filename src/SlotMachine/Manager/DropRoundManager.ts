namespace slot_manager {
    /**
     * 掉落型的 round 流程（§10.1）：資料到了才能開始。
     *
     * 環節 3：畫面上還有盤面就先掉出，再掉入這個 round 的初始盤面。
     * 要用淡出等其他方式清掉上一盤的遊戲，覆寫 `presentBoard()`。
     */
    export class DropRoundManager extends BaseRoundManager {
        /** 同 `BaseRoundManager.init()`；掉落機台不可為 null。 */
        public init(
            roll: slot_core.ISlotMachine | null,
            drop: slot_drop.IDropSlotMachine | null,
        ): void {
            if (drop === null) {
                throw new Error(
                    "DropRoundManager requires a drop machine.",
                );
            }

            super.init(
                roll,
                drop,
            );
        }

        /** 掉出、掉入是否不等軸間隔（Turbo）。留給繼承類別；預設否。 */
        protected isFastDrop(round: RoundData): boolean {
            return false;
        }

        protected async presentBoard(
            context: RoundStepContext,
        ): Promise<void> {
            const machine = this.requireDropMachine();
            const fast = this.isFastDrop(context.round);

            if (!machine.allReelsDroppedOut) {
                await machine.dropOut(fast);
            }

            await machine.dropIn(
                context.round.board,
                fast,
            );
        }
    }
}
