namespace slot_manager {
    /**
     * 一局遊戲的 round 流程控制（骨架）。
     *
     * 依 doc/GameViewManager-Reference-Study.md §9、§10 的定案：
     *
     * - 以 round 為單位；一局內 round 接 round 由本類別負責，遊戲子類別覆寫
     *   `nextRound()` 回答下一個 round（回 `null` = 整局結束）（G3）
     * - 五個環節是可覆寫的 async 方法，依序 await；環節 2～4 在初始盤面與每一次
     *   消除各走一遍（G5）
     * - 不碰 UI 與網路：對外只有入口與 `RoundEvent` 通知（G10）；自動旋轉歸上層 Controller（G11）
     * - 本身不等任何時間（G7、G8）；全程 await，出錯往外丟（G12）
     * - 本類別監聽機台的逐軸事件（`SlotMachineEvent` 的 `REEL_STARTED`、`REEL_STOPPED`、
     *   `LISTEN_START`、`LISTEN_END`；`DropEvent` 的 `REEL_DROP_STARTED`、
     *   `REEL_DROP_COMPLETED`），直接呼叫可覆寫的 `onReel…` / `onListen…` 方法；
     *   方法回傳的 Promise 在環節 3 結束、進環節 4 之前等完（§10.5）。遊戲要逐軸事件
     *   就覆寫這些方法，不要另外監聽機台
     *
     * 「初始盤面怎麼出現」滾輪與掉落差很多（起轉可以早於資料，掉落要等資料），
     * 留給 `RollRoundManager` / `DropRoundManager`（§10.1）。
     *
     * ## 生命週期
     *
     * `init(roll, drop)` 收機台（以介面注入，各自可給 null，§9 G2）並開始監聽；
     * `cleanup()` 移除監聽、放掉機台參照，之後可再 `init()`。
     */
    export class BaseRoundManager extends egret.EventDispatcher {
        /** 收下的機台只在 init()／cleanup() 改；子類別經 requireRollMachine()／requireDropMachine() 取用。 */
        private _rollMachine: slot_core.ISlotMachine | null = null;
        private _dropMachine: slot_drop.IDropSlotMachine | null = null;

        private _inited = false;
        private _playing = false;
        private _currentStage?: RoundStage;
        private _currentContext?: RoundStepContext;

        /** 逐軸事件方法回傳、還沒等過的 Promise（§10.5）。 */
        private _reelEventWork: Promise<void>[] = [];

        /** 資料還沒到時逐軸事件附帶的 context；固定一份，不每次新建。 */
        private readonly _pendingReelEventContext: RoundReelEventContext = {
            round: null,
            stepIndex: RoundDataConst.PENDING_STEP_INDEX,
        };

        // ───────────────── 內部 handler（§10.5：機台的逐軸事件） ─────────────────
        //
        // 每個 handler 直接呼叫遊戲覆寫的同名方法，收下它回傳的 Promise，
        // 在環節 3 結束、進環節 4 之前等完（`waitReelEventWork()`）。
        // 先掛一個不做事的 catch：reject 早於 manager 去等時，瀏覽器不會先印
        // 「Uncaught (in promise)」；等的時候照樣丟錯。

        private readonly _reelStartedHandler = (
            event: slot_core.SlotMachineEvent,
        ): void => {
            const work = this.onReelStarted(
                event.reelIndex,
                this.eventReelOf(event),
                this.currentReelEventContext(),
            );
            work.catch(this._ignoreRejectionHandler);
            this._reelEventWork.push(work);
        };

        private readonly _reelStoppedHandler = (
            event: slot_core.SlotMachineEvent,
        ): void => {
            const work = this.onReelStopped(
                event.reelIndex,
                this.eventReelOf(event),
                event.stopMode,
                this.currentReelEventContext(),
            );
            work.catch(this._ignoreRejectionHandler);
            this._reelEventWork.push(work);
        };

        private readonly _listenStartHandler = (
            event: slot_core.SlotMachineEvent,
        ): void => {
            const work = this.onListenStart(
                event.reelIndex,
                this.eventReelOf(event),
                this.currentReelEventContext(),
            );
            work.catch(this._ignoreRejectionHandler);
            this._reelEventWork.push(work);
        };

        private readonly _listenEndHandler = (
            event: slot_core.SlotMachineEvent,
        ): void => {
            const work = this.onListenEnd(
                event.reelIndex,
                this.eventReelOf(event),
                this.currentReelEventContext(),
            );
            work.catch(this._ignoreRejectionHandler);
            this._reelEventWork.push(work);
        };

        private readonly _reelDropStartedHandler = (
            event: slot_drop.DropEvent,
        ): void => {
            const work = this.onReelDropStarted(
                event.reelIndex,
                this.dropEventReelOf(event),
                this.currentReelEventContext(),
            );
            work.catch(this._ignoreRejectionHandler);
            this._reelEventWork.push(work);
        };

        private readonly _reelDropCompletedHandler = (
            event: slot_drop.DropEvent,
        ): void => {
            const work = this.onReelDropCompleted(
                event.reelIndex,
                this.dropEventReelOf(event),
                this.currentReelEventContext(),
            );
            work.catch(this._ignoreRejectionHandler);
            this._reelEventWork.push(work);
        };

        private readonly _ignoreRejectionHandler = (): void => {
            // 不做事：錯誤在 waitReelEventWork() 等的時候照樣丟出。
        };

        public get inited(): boolean {
            return this._inited;
        }

        /** 是否正在跑一局。 */
        public get playing(): boolean {
            return this._playing;
        }

        /** 目前所在的環節；不在任何環節（例如等下一個 round 的資料）時為 undefined。 */
        public get currentStage(): RoundStage | undefined {
            return this._currentStage;
        }

        // ───────────────── 初始化 ─────────────────

        /**
         * 收下機台並開始監聽它們的逐軸事件。
         *
         * 流程走到要用的那台卻是 null 時 throw（§9 G2）。重複呼叫會 throw；
         * 要換機台先 `cleanup()`。
         *
         * @param roll 滾輪機台；沒有就給 null
         * @param drop 掉落機台；沒有就給 null
         */
        public init(
            roll: slot_core.ISlotMachine | null,
            drop: slot_drop.IDropSlotMachine | null,
        ): void {
            if (this._inited) {
                throw new Error(
                    "BaseRoundManager.init() has already been called; call cleanup() first.",
                );
            }

            this._rollMachine = roll;
            this._dropMachine = drop;
            this.addMachineListeners();
            this._inited = true;
        }

        /**
         * 移除對機台的全部監聽、放掉還沒等過的逐軸 Promise 與機台參照。
         *
         * 一局還在跑時呼叫，流程下一次用到機台就會 throw，`startGame()` 隨之 reject。
         * 呼叫後可再 `init()`。
         */
        public cleanup(): void {
            this.removeMachineListeners();
            this._rollMachine = null;
            this._dropMachine = null;
            this._reelEventWork = [];
            this._playing = false;
            this.leaveStage();
            this._inited = false;
        }

        // ───────────────── 入口 ─────────────────

        /**
         * 開始一局，整局結束才 resolve（G12）。中間任何一步出錯 → 這一局停下、reject。
         *
         * 一局正在跑時再呼叫會 throw。
         */
        public startGame(): Promise<void> {
            this.assertInitialized();

            if (this._playing) {
                throw new Error(
                    "startGame() cannot be called while a game is playing.",
                );
            }

            this._playing = true;
            this._reelEventWork = [];
            return this.playGame();
        }

        /**
         * 玩家按 Stop（G6）：
         *
         * - 滾輪在轉 → `ISlotMachine.quickStop()`
         * - 掉落中 → `IDropSlotMachine.quickStop()`（直接到位）
         * - 表演中（某個環節還在跑）→ 呼叫 `onSkipRequested()`，由遊戲自己提前收尾，不強行砍
         *
         * 還沒 init()、或沒在跑一局時不做事（Stop 按鈕隨時可能被按）。
         */
        public requestStop(): void {
            if (!this._inited || !this._playing) {
                return;
            }

            if (this._rollMachine !== null && this._rollMachine.spinning) {
                this._rollMachine.quickStop();
                return;
            }

            if (this._dropMachine !== null && this._dropMachine.dropping) {
                this._dropMachine.quickStop();
                return;
            }

            if (
                this._currentStage !== undefined
                && this._currentContext !== undefined
            ) {
                this.onSkipRequested(
                    this._currentStage,
                    this._currentContext,
                );
            }
        }

        // ───────────────── 遊戲實作（留給繼承類別） ─────────────────

        /**
         * 下一個 round 是什麼；回 `null` = 整局結束（G3）。
         *
         * 第一個 round 也從這裡拿。可以等待：資料已在手上就立即給；要向伺服器要
         * 就等回來再給；中間要插挑戰遊戲、bonus 表演也在這裡等。
         *
         * 留給繼承類別。預設回 `null`（沒有任何 round，一局直接結束）。
         */
        protected async nextRound(): Promise<RoundData | null> {
            return null;
        }

        /**
         * 環節 3 的機台動作：把初始盤面（第 0 步）帶到位。
         *
         * resolve 時盤面必須完全到位（滾輪含停止效果播完）。
         * 由 `RollRoundManager` / `DropRoundManager` 實作；基底不知道怎麼出盤面，預設 throw。
         */
        protected async presentBoard(
            context: RoundStepContext,
        ): Promise<void> {
            throw new Error(
                "BaseRoundManager.presentBoard() must be implemented by a subclass.",
            );
        }

        /** 一局開始、還沒拿到第一個 round 之前；滾輪在這裡起轉。留給繼承類別。 */
        protected async beginGame(): Promise<void> {
            // 留給繼承類別。
        }

        // ───────────────── 五個環節（留給繼承類別；預設不做事） ─────────────────

        /** 環節 1：每一 round 開始前。 */
        protected async onRoundStart(context: RoundStepContext): Promise<void> {
            // 留給繼承類別。
        }

        /** 環節 2：旋轉前／掉入前／消除前。 */
        protected async onBeforeStep(context: RoundStepContext): Promise<void> {
            // 留給繼承類別。
        }

        /** 環節 3：旋轉中／掉入中／消除中；與機台動作同時跑，兩者都完成才往下。 */
        protected async onStep(context: RoundStepContext): Promise<void> {
            // 留給繼承類別。
        }

        /** 環節 4：旋轉結束／掉入結束／掉落結束。 */
        protected async onAfterStep(context: RoundStepContext): Promise<void> {
            // 留給繼承類別。
        }

        /** 環節 5：每一 round 結束。 */
        protected async onRoundEnd(context: RoundStepContext): Promise<void> {
            // 留給繼承類別。
        }

        /**
         * 表演中玩家按 Stop（G6）：通知目前所在的環節「玩家要跳過」，
         * 由遊戲自己提前收尾。預設不做事。
         */
        protected onSkipRequested(
            stage: RoundStage,
            context: RoundStepContext,
        ): void {
            // 留給繼承類別。
        }

        // ───────────────── 逐軸事件（§10.5；留給繼承類別；預設不做事） ─────────────────
        //
        // 由機台的逐軸事件轉來。機台不看回傳值；manager 在環節 3 結束、進環節 4
        // 之前等回傳的 Promise 全部完成。滾輪一局的第一個 round 在資料到之前就起轉，
        // 那時的 context 是 `{ round: null, stepIndex: RoundDataConst.PENDING_STEP_INDEX }`，
        // 它們的 Promise 併入第一個 round 的環節 3 一起等。
        //
        // 要丟錯請回傳 reject 的 Promise（寫成 async，裡面 throw 即可）：這一局會
        // reject，機台照常跑完。方法不是 async 又直接 throw，錯誤會丟進機台的每幀
        // 推進、讓機台停在半路，框架不擋。

        /** 滾輪：某軸起轉。 */
        protected async onReelStarted(
            reelIndex: number,
            reel: slot_core.BaseReel,
            context: RoundReelEventContext,
        ): Promise<void> {
            // 留給繼承類別。
        }

        /** 滾輪：某軸停下（對齊結果那一刻，停止效果才要開始播）。 */
        protected async onReelStopped(
            reelIndex: number,
            reel: slot_core.BaseReel,
            mode: slot_core.ReelStopMode,
            context: RoundReelEventContext,
        ): Promise<void> {
            // 留給繼承類別。
        }

        /** 滾輪：某軸開始聽牌。 */
        protected async onListenStart(
            reelIndex: number,
            reel: slot_core.BaseReel,
            context: RoundReelEventContext,
        ): Promise<void> {
            // 留給繼承類別。
        }

        /** 滾輪：某軸聽牌結束。 */
        protected async onListenEnd(
            reelIndex: number,
            reel: slot_core.BaseReel,
            context: RoundReelEventContext,
        ): Promise<void> {
            // 留給繼承類別。
        }

        /** 掉落：某軸開始掉。 */
        protected async onReelDropStarted(
            reelIndex: number,
            reel: slot_drop.BaseDropReel,
            context: RoundReelEventContext,
        ): Promise<void> {
            // 留給繼承類別。
        }

        /** 掉落：某軸掉完（包含急停直接到位）。 */
        protected async onReelDropCompleted(
            reelIndex: number,
            reel: slot_drop.BaseDropReel,
            context: RoundReelEventContext,
        ): Promise<void> {
            // 留給繼承類別。
        }

        // ───────────────── 流程 ─────────────────

        private async playGame(): Promise<void> {
            try {
                await this.beginGame();

                let round = await this.nextRound();

                while (round !== null) {
                    await this.playRound(round);
                    round = await this.nextRound();
                }
            } catch (error) {
                this.finishGame();
                throw error;
            }

            this.finishGame();
            this.dispatchGameEnd();
        }

        /** 環節 1 → 每一步（初始盤面、每次消除）→ 環節 5。 */
        private async playRound(round: RoundData): Promise<void> {
            const cascadeCount = round.cascades !== undefined
                ? round.cascades.length
                : 0;

            if (cascadeCount > 0 && this._dropMachine === null) {
                throw new Error(
                    "A round with cascades requires a drop machine.",
                );
            }

            const first: RoundStepContext = {
                round,
                stepIndex: 0,
            };

            this.enterStage(
                RoundStage.RoundStart,
                first,
            );
            await this.onRoundStart(first);
            this.leaveStage();

            await this.playStep(first);

            for (let stepIndex = 1; stepIndex <= cascadeCount; stepIndex++) {
                await this.playStep({
                    round,
                    stepIndex,
                });
            }

            const last: RoundStepContext = {
                round,
                stepIndex: cascadeCount,
            };

            this.enterStage(
                RoundStage.RoundEnd,
                last,
            );
            await this.onRoundEnd(last);
            this.leaveStage();
        }

        /** 環節 2 → 3（機台動作與 `onStep()` 同時跑，再等逐軸事件的表演）→ 4。 */
        private async playStep(context: RoundStepContext): Promise<void> {
            this.enterStage(
                RoundStage.BeforeStep,
                context,
            );
            await this.onBeforeStep(context);
            this.leaveStage();

            this.enterStage(
                RoundStage.Step,
                context,
            );
            await Promise.all([
                this.playStepMachine(context),
                this.onStep(context),
            ]);
            await this.waitReelEventWork();
            this.leaveStage();

            this.enterStage(
                RoundStage.AfterStep,
                context,
            );
            await this.onAfterStep(context);
            this.leaveStage();
        }

        /** 環節 3 的機台動作：第 0 步把初始盤面帶到位；第 k 步做第 k 次消除。 */
        private playStepMachine(context: RoundStepContext): Promise<void> {
            if (context.stepIndex === 0) {
                return this.presentBoard(context);
            }

            const cascades = context.round.cascades;

            if (cascades === undefined) {
                throw new Error(
                    "Cascade step " + context.stepIndex + " requires round.cascades.",
                );
            }

            const cascade = cascades[context.stepIndex - 1];
            return this.requireDropMachine().dropRefill(
                cascade.removePositions,
                cascade.refillCells,
            );
        }

        private enterStage(
            stage: RoundStage,
            context: RoundStepContext,
        ): void {
            this._currentStage = stage;
            this._currentContext = context;

            this.dispatchStageEnter(
                stage,
                context,
            );
        }

        private leaveStage(): void {
            this._currentStage = undefined;
            this._currentContext = undefined;
        }

        private finishGame(): void {
            this._playing = false;
            this._reelEventWork = [];
            this.leaveStage();
        }

        // ───────────────── 對外通知（G10；不等） ─────────────────

        /** 發出 `RoundEvent.STAGE_ENTER`；沒人聽就不建立事件物件。 */
        private dispatchStageEnter(
            stage: RoundStage,
            context: RoundStepContext,
        ): void {
            if (!this.hasEventListener(RoundEvent.STAGE_ENTER)) {
                return;
            }

            const event = new RoundEvent(RoundEvent.STAGE_ENTER);
            event.stage = stage;
            event.context = context;
            this.dispatchEvent(event);
        }

        /** 發出 `RoundEvent.GAME_END`；沒人聽就不建立事件物件。 */
        private dispatchGameEnd(): void {
            if (!this.hasEventListener(RoundEvent.GAME_END)) {
                return;
            }

            this.dispatchEvent(new RoundEvent(RoundEvent.GAME_END));
        }

        // ───────────────── 逐軸事件轉手（§10.5） ─────────────────

        private addMachineListeners(): void {
            const roll = this._rollMachine;
            if (roll !== null) {
                roll.addEventListener(
                    slot_core.SlotMachineEvent.REEL_STARTED,
                    this._reelStartedHandler,
                    this,
                );
                roll.addEventListener(
                    slot_core.SlotMachineEvent.REEL_STOPPED,
                    this._reelStoppedHandler,
                    this,
                );
                roll.addEventListener(
                    slot_core.SlotMachineEvent.LISTEN_START,
                    this._listenStartHandler,
                    this,
                );
                roll.addEventListener(
                    slot_core.SlotMachineEvent.LISTEN_END,
                    this._listenEndHandler,
                    this,
                );
            }

            const drop = this._dropMachine;
            if (drop !== null) {
                drop.addEventListener(
                    slot_drop.DropEvent.REEL_DROP_STARTED,
                    this._reelDropStartedHandler,
                    this,
                );
                drop.addEventListener(
                    slot_drop.DropEvent.REEL_DROP_COMPLETED,
                    this._reelDropCompletedHandler,
                    this,
                );
            }
        }

        /** 與 `addMachineListeners()` 成對，參數相同。 */
        private removeMachineListeners(): void {
            const roll = this._rollMachine;
            if (roll !== null) {
                roll.removeEventListener(
                    slot_core.SlotMachineEvent.REEL_STARTED,
                    this._reelStartedHandler,
                    this,
                );
                roll.removeEventListener(
                    slot_core.SlotMachineEvent.REEL_STOPPED,
                    this._reelStoppedHandler,
                    this,
                );
                roll.removeEventListener(
                    slot_core.SlotMachineEvent.LISTEN_START,
                    this._listenStartHandler,
                    this,
                );
                roll.removeEventListener(
                    slot_core.SlotMachineEvent.LISTEN_END,
                    this._listenEndHandler,
                    this,
                );
            }

            const drop = this._dropMachine;
            if (drop !== null) {
                drop.removeEventListener(
                    slot_drop.DropEvent.REEL_DROP_STARTED,
                    this._reelDropStartedHandler,
                    this,
                );
                drop.removeEventListener(
                    slot_drop.DropEvent.REEL_DROP_COMPLETED,
                    this._reelDropCompletedHandler,
                    this,
                );
            }
        }

        /**
         * 逐軸事件附帶的所在位置：在環節中就是目前的 context；
         * 不在任何環節（資料還沒到）時是固定的 pending context。
         */
        private currentReelEventContext(): RoundReelEventContext {
            if (this._currentContext !== undefined) {
                return this._currentContext;
            }

            return this._pendingReelEventContext;
        }

        /** 等逐軸事件的 Promise 全部完成；等的期間又收到新的也一起等。 */
        private async waitReelEventWork(): Promise<void> {
            while (this._reelEventWork.length > 0) {
                const batch = this._reelEventWork;
                this._reelEventWork = [];
                await Promise.all(batch);
            }
        }

        // ───────────────── 零件 ─────────────────

        private assertInitialized(): void {
            if (!this._inited) {
                throw new Error(
                    "BaseRoundManager.init() must be called first.",
                );
            }
        }

        /** 逐軸的 `SlotMachineEvent` 一定帶著軸；沒有就是機台發錯了。 */
        private eventReelOf(event: slot_core.SlotMachineEvent): slot_core.BaseReel {
            if (event.reel === null) {
                throw new Error(
                    "SlotMachineEvent." + event.type + " must carry a reel.",
                );
            }

            return event.reel;
        }

        /** 逐軸的 `DropEvent` 一定帶著軸；沒有就是機台發錯了。 */
        private dropEventReelOf(event: slot_drop.DropEvent): slot_drop.BaseDropReel {
            if (event.reel === null) {
                throw new Error(
                    "DropEvent." + event.type + " must carry a reel.",
                );
            }

            return event.reel;
        }

        protected requireRollMachine(): slot_core.ISlotMachine {
            if (this._rollMachine === null) {
                throw new Error(
                    "This round manager requires a roll machine.",
                );
            }

            return this._rollMachine;
        }

        protected requireDropMachine(): slot_drop.IDropSlotMachine {
            if (this._dropMachine === null) {
                throw new Error(
                    "This round manager requires a drop machine.",
                );
            }

            return this._dropMachine;
        }
    }
}
