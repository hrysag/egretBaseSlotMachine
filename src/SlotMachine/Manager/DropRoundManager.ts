import {
    BaseRoundManager,
    RoundManagerMachines,
} from "./BaseRoundManager";
import { RoundData, RoundStepContext } from "./Data/RoundData";

/**
 * 掉落型的 round 流程（§10.1）：資料到了才能開始。
 *
 * 環節 3：畫面上還有盤面就先掉出，再掉入這個 round 的初始盤面。
 * 要用淡出等其他方式清掉上一盤的遊戲，覆寫 `presentBoard()`。
 */
export abstract class DropRoundManager<TState = unknown>
    extends BaseRoundManager<TState> {
    public constructor(machines: RoundManagerMachines) {
        super(machines);

        if (machines.drop === undefined) {
            throw new Error("DropRoundManager requires a drop machine.");
        }
    }

    /** 掉出、掉入是否不等軸間隔（Turbo）；預設否，由遊戲覆寫。 */
    protected isFastDrop(round: RoundData<TState>): boolean {
        return false;
    }

    protected async presentBoard(
        context: RoundStepContext<TState>,
    ): Promise<void> {
        const machine = this.requireDropMachine();
        const fast = this.isFastDrop(context.round);

        if (!machine.reelList.every((reel) => reel.droppedOut)) {
            await machine.dropOut(fast);
        }

        await machine.dropIn(context.round.board, fast);
    }
}
