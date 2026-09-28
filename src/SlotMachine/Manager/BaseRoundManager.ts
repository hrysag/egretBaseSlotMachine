import { BaseSlotMachine } from "../Core/BaseSlotMachine";
import { BaseDropSlotMachine } from "../Drop/BaseDropSlotMachine";
import {
    RoundData,
    RoundStage,
    RoundStepContext,
} from "./Data/RoundData";

/** 交給 manager 的機台；每個位置都可以不給（§9 G2）。 */
export interface RoundManagerMachines {
    readonly roll?: BaseSlotMachine;
    readonly drop?: BaseDropSlotMachine;
}

/**
 * 一局遊戲的 round 流程控制（骨架）。
 *
 * 依 doc/GameViewManager-Reference-Study.md §9、§10 的定案：
 *
 * - 以 round 為單位；一局內 round 接 round 由本類別負責，遊戲子類別實作
 *   `nextRound()` 回答下一個 round（回 `null` = 整局結束）（G3）
 * - 五個環節是可覆寫的 async 方法，依序 await；環節 2～4 在初始盤面與每一次
 *   消除各走一遍（G5）
 * - 不碰 UI 與網路：對外只有入口與通知回呼（G10）；自動旋轉歸上層 Controller（G11）
 * - 本身不等任何時間（G7、G8）；全程 await，出錯往外丟（G12）
 *
 * 「初始盤面怎麼出現」滾輪與掉落差很多（起轉可以早於資料，掉落要等資料），
 * 留給 `RollRoundManager` / `DropRoundManager`（§10.1）。
 *
 * @typeParam TState 遊戲自訂的 round 狀態，框架不解讀
 */
export abstract class BaseRoundManager<TState = unknown> {
    protected readonly rollMachine?: BaseSlotMachine;
    protected readonly dropMachine?: BaseDropSlotMachine;

    private _playing = false;
    private _currentStage?: RoundStage;
    private _currentContext?: RoundStepContext<TState>;

    /**
     * 五個環節各自進入時通知；不等（G10）。
     *
     * 給沒有繼承 manager 的外部物件（Controller、UI）。`RoundEnd` 同時代表
     * 「需要下一個 round 的資料」。
     */
    public onStageEnter?: (
        stage: RoundStage,
        context: RoundStepContext<TState>,
    ) => void;

    /** 整局結束時通知一次（相當於 1016 的 `SHOW_END`）；在 `startGame()` resolve 之前發出。 */
    public onGameEnd?: () => void;

    public constructor(machines: RoundManagerMachines) {
        this.rollMachine = machines.roll;
        this.dropMachine = machines.drop;
    }

    /** 是否正在跑一局。 */
    public get playing(): boolean {
        return this._playing;
    }

    /** 目前所在的環節；不在任何環節（例如等下一個 round 的資料）時為 undefined。 */
    public get currentStage(): RoundStage | undefined {
        return this._currentStage;
    }

    // ───────────────── 入口 ─────────────────

    /**
     * 開始一局，整局結束才 resolve（G12）。中間任何一步出錯 → 這一局停下、reject。
     *
     * 一局正在跑時再呼叫會 throw。
     */
    public startGame(): Promise<void> {
        if (this._playing) {
            throw new Error("startGame() cannot be called while a game is playing.");
        }

        this._playing = true;
        return this.playGame().then(
            () => {
                this.finishGame();
                if (this.onGameEnd !== undefined) {
                    this.onGameEnd();
                }
            },
            (error) => {
                this.finishGame();
                throw error;
            },
        );
    }

    /**
     * 玩家按 Stop（G6）：
     *
     * - 滾輪在轉 → `BaseSlotMachine.quickStop()`
     * - 掉落中 → `BaseDropSlotMachine.quickStop()`（直接到位）
     * - 表演中（某個環節還在跑）→ 呼叫 `onSkipRequested()`，由遊戲自己提前收尾，不強行砍
     *
     * 沒在跑一局時不做事。
     */
    public requestStop(): void {
        if (!this._playing) {
            return;
        }

        if (this.rollMachine !== undefined && this.rollMachine.spinning) {
            this.rollMachine.quickStop();
            return;
        }

        if (this.dropMachine !== undefined && this.dropMachine.dropping) {
            this.dropMachine.quickStop();
            return;
        }

        if (
            this._currentStage !== undefined
            && this._currentContext !== undefined
        ) {
            this.onSkipRequested(this._currentStage, this._currentContext);
        }
    }

    // ───────────────── 遊戲實作 ─────────────────

    /**
     * 下一個 round 是什麼；回 `null` = 整局結束（G3）。
     *
     * 第一個 round 也從這裡拿。可以等待：資料已在手上就立即給；要向伺服器要
     * 就等回來再給；中間要插挑戰遊戲、bonus 表演也在這裡等。
     */
    protected abstract nextRound(): Promise<RoundData<TState> | null>;

    /**
     * 環節 3 的機台動作：把初始盤面（第 0 步）帶到位。滾輪／掉落各自實作。
     *
     * resolve 時盤面必須完全到位（滾輪含停止效果播完）。
     */
    protected abstract presentBoard(
        context: RoundStepContext<TState>,
    ): Promise<void>;

    /** 一局開始、還沒拿到第一個 round 之前；滾輪在這裡起轉。預設不做事。 */
    protected beginGame(): Promise<void> {
        return Promise.resolve();
    }

    // ───────────────── 五個環節（遊戲覆寫；預設不做事） ─────────────────

    /** 環節 1：每一 round 開始前。 */
    protected onRoundStart(context: RoundStepContext<TState>): Promise<void> {
        return Promise.resolve();
    }

    /** 環節 2：旋轉前／掉入前／消除前。 */
    protected onBeforeStep(context: RoundStepContext<TState>): Promise<void> {
        return Promise.resolve();
    }

    /** 環節 3：旋轉中／掉入中／消除中；與機台動作同時跑，兩者都完成才往下。 */
    protected onStep(context: RoundStepContext<TState>): Promise<void> {
        return Promise.resolve();
    }

    /** 環節 4：旋轉結束／掉入結束／掉落結束。 */
    protected onAfterStep(context: RoundStepContext<TState>): Promise<void> {
        return Promise.resolve();
    }

    /** 環節 5：每一 round 結束。 */
    protected onRoundEnd(context: RoundStepContext<TState>): Promise<void> {
        return Promise.resolve();
    }

    /**
     * 表演中玩家按 Stop（G6）：通知目前所在的環節「玩家要跳過」，
     * 由遊戲自己提前收尾。預設不做事。
     */
    protected onSkipRequested(
        stage: RoundStage,
        context: RoundStepContext<TState>,
    ): void {
        // 留給繼承類別。
    }

    // ───────────────── 流程 ─────────────────

    private async playGame(): Promise<void> {
        await this.beginGame();

        let round = await this.nextRound();

        while (round !== null) {
            await this.playRound(round);
            round = await this.nextRound();
        }
    }

    private async playRound(round: RoundData<TState>): Promise<void> {
        const cascades = round.cascades !== undefined ? round.cascades : [];

        if (cascades.length > 0 && this.dropMachine === undefined) {
            throw new Error("A round with cascades requires a drop machine.");
        }

        const first: RoundStepContext<TState> = { round, stepIndex: 0 };

        await this.runStage(RoundStage.RoundStart, first, this.onRoundStart);
        await this.playStep(first, () => this.presentBoard(first));

        for (let index = 0; index < cascades.length; index++) {
            const cascade = cascades[index];
            const context: RoundStepContext<TState> = {
                round,
                stepIndex: index + 1,
            };

            await this.playStep(context, () =>
                (this.dropMachine as BaseDropSlotMachine).dropRefill(
                    cascade.removePositions,
                    cascade.refillCells,
                ));
        }

        const last: RoundStepContext<TState> = {
            round,
            stepIndex: cascades.length,
        };
        await this.runStage(RoundStage.RoundEnd, last, this.onRoundEnd);
    }

    /** 環節 2 → 3（機台動作與 `onStep()` 同時跑）→ 4。 */
    private async playStep(
        context: RoundStepContext<TState>,
        machineAction: () => Promise<void>,
    ): Promise<void> {
        await this.runStage(RoundStage.BeforeStep, context, this.onBeforeStep);

        this.enterStage(RoundStage.Step, context);
        await Promise.all([machineAction(), this.onStep(context)]);
        this.leaveStage();

        await this.runStage(RoundStage.AfterStep, context, this.onAfterStep);
    }

    private async runStage(
        stage: RoundStage,
        context: RoundStepContext<TState>,
        hook: (context: RoundStepContext<TState>) => Promise<void>,
    ): Promise<void> {
        this.enterStage(stage, context);
        await hook.call(this, context);
        this.leaveStage();
    }

    private enterStage(
        stage: RoundStage,
        context: RoundStepContext<TState>,
    ): void {
        this._currentStage = stage;
        this._currentContext = context;

        if (this.onStageEnter !== undefined) {
            this.onStageEnter(stage, context);
        }
    }

    private leaveStage(): void {
        this._currentStage = undefined;
        this._currentContext = undefined;
    }

    private finishGame(): void {
        this._playing = false;
        this.leaveStage();
    }

    // ───────────────── 零件 ─────────────────

    protected requireRollMachine(): BaseSlotMachine {
        if (this.rollMachine === undefined) {
            throw new Error("This round manager requires a roll machine.");
        }

        return this.rollMachine;
    }

    protected requireDropMachine(): BaseDropSlotMachine {
        if (this.dropMachine === undefined) {
            throw new Error("This round manager requires a drop machine.");
        }

        return this.dropMachine;
    }
}
