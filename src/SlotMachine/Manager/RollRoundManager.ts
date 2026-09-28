import { SpinMode } from "../Core/SlotMachine/Config/SlotMachineSpinConfig";
import {
    BaseRoundManager,
    RoundManagerMachines,
} from "./BaseRoundManager";
import { RoundData, RoundStepContext } from "./Data/RoundData";

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
export abstract class RollRoundManager<TState = unknown>
    extends BaseRoundManager<TState> {
    public constructor(machines: RoundManagerMachines) {
        super(machines);

        if (machines.roll === undefined) {
            throw new Error("RollRoundManager requires a roll machine.");
        }
    }

    /**
     * 起轉用哪個 SpinConfig 模式（例如 Turbo）；由遊戲決定。
     *
     * 一局的第一個 round 在資料到之前就起轉，那時 `round` 為 `null`。
     */
    protected abstract getSpinMode(round: RoundData<TState> | null): SpinMode;

    protected beginGame(): Promise<void> {
        this.startSpinning(null);
        return Promise.resolve();
    }

    protected async presentBoard(
        context: RoundStepContext<TState>,
    ): Promise<void> {
        const machine = this.requireRollMachine();

        if (!machine.spinning) {
            this.startSpinning(context.round);
        }

        await machine.stopSpin(context.round.board);
        await machine.waitForSettledAsync();
    }

    private startSpinning(round: RoundData<TState> | null): void {
        /* startSpin() 的 Promise 只表示「全部軸已啟動」，stopSpin() 內部會等它。 */
        void this.requireRollMachine().startSpin(this.getSpinMode(round));
    }
}
