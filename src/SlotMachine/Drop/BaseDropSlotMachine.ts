namespace slot_drop {
    /** 一批掉落是哪一種指令。 */
    enum DropBatchKind {
        Out,
        In,
        Refill,
    }

    /** 一批掉落中，一軸幾秒時開始；開始時由 `startReelDrop()` 依這批的種類呼叫單軸。 */
    interface PendingDropStart {
        readonly reelIndex: number;
        readonly startAt: number;
    }

    /**
     * 多軸掉落（雛形）。與滾動的 `BaseSlotMachine` 同形：
     *
     * - 顯示物件，`init()` 預設把掉落軸收成子項；內嵌用法設 `adoptReels: false`（Q11，暫定）
     * - 推進抽在 `update(deltaTime)`，預設自帶 `egret.startTick` 心跳；
     *   遊戲要自己驅動時覆寫 `startTicking()`（Q10）
     * - 軸間隔用同一個時間累積器排程，不用 setTimeout
     *
     * 三個入口對應 v3 `UniDropSlotMachine`；「消 → 判獎 → 補 → 再判」的連消迴圈
     * 屬於遊戲流程層，框架只給單步入口（Drop-Module-Readiness §7.2）。
     */
    export class BaseDropSlotMachine extends eui.Component implements IDropSlotMachine {
        /** 與 BaseSlotMachine.MAX_DELTA_TIME 相同。 */
        public static readonly MAX_DELTA_TIME = 0.1;

        private _inited = false;
        private _reels: BaseDropReel[] = [];
        private _dropOutInterval = 0;
        private _dropInInterval = 0;

        private _running = false;
        private _elapsed = 0;
        private _pendingStarts: PendingDropStart[] = [];
        private _resolveRun?: () => void;

        /**
         * 目前這批的種類與逐軸資料（`run()` 通過檢查後才寫入，這批結束時清空）。
         *
         * 沒用到的種類留空陣列；`startReelDrop()` 依種類取第 i 軸那一份。
         */
        private _batchKind = DropBatchKind.Out;
        private _batchBoards: slot_core.SymbolData[][] = [];
        private _batchRemovePositions: number[][] = [];
        private _batchRefillCells: slot_core.SymbolData[][] = [];

        /** 已發 `REEL_DROP_STARTED`、還沒發 `REEL_DROP_COMPLETED` 的軸（依軸號）。 */
        private _completionPending: boolean[] = [];

        /**
         * 單軸掉落 Promise resolve 後呼叫：把「已開始、已不在掉、還沒轉發」的軸
         * 依軸號發 `REEL_DROP_COMPLETED`。
         *
         * 時機與原本相同 —— 單軸 Promise resolve 後的第一個 microtask，早於這批
         * Promise 的等待者；同一幀到位的多軸依軸號發出（`update()` 也是依軸號推進）。
         */
        private readonly _reelDropSettledHandler = (): void => {
            for (let index = 0; index < this._reels.length; index++) {
                const reel = this._reels[index];

                if (this._completionPending[index] === true && !reel.dropping) {
                    this._completionPending[index] = false;
                    this.dispatchReelDropEvent(
                        DropEvent.REEL_DROP_COMPLETED,
                        index,
                        reel,
                    );
                }
            }
        };

        /** 一批掉落的 Promise 的 executor：記下 resolve，這批結束時呼叫。 */
        private readonly _runPromiseExecutor = (
            resolve: () => void,
        ): void => {
            this._resolveRun = resolve;
        };

        private _ticking = false;
        private _lastTimeStamp = 0;

        public get inited(): boolean {
            return this._inited;
        }

        public get reelList(): BaseDropReel[] {
            return this._reels;
        }

        /** 本機台是否有掉落指令還沒結束。 */
        public get dropping(): boolean {
            return this._running;
        }

        /** 是否全部軸都已掉出（可視區是空的）；沒有軸時為 true。 */
        public get allReelsDroppedOut(): boolean {
            for (const reel of this._reels) {
                if (!reel.droppedOut) {
                    return false;
                }
            }

            return true;
        }

        // ───────────────── 初始化 ─────────────────

        public init(
            reels: BaseDropReel[],
            config: DropSlotMachineConfig = {},
        ): void {
            if (this._inited) {
                return;
            }

            if (reels.length === 0) {
                throw new Error("BaseDropSlotMachine requires at least one reel.");
            }

            const dropOutInterval = config.dropOutIntervalSeconds !== undefined
                ? config.dropOutIntervalSeconds
                : 0;
            const dropInInterval = config.dropInIntervalSeconds !== undefined
                ? config.dropInIntervalSeconds
                : 0;

            slot_core.assertNonNegativeFiniteNumber(dropOutInterval, "dropOutIntervalSeconds");
            slot_core.assertNonNegativeFiniteNumber(dropInInterval, "dropInIntervalSeconds");

            this._reels = [...reels];
            this._dropOutInterval = dropOutInterval;
            this._dropInInterval = dropInInterval;

            if (config.adoptReels !== false) {
                for (const reel of this._reels) {
                    if (reel.parent !== this) {
                        this.addChild(reel);
                    }
                }
            }

            try {
                this.registerInitialReelData();
                this.applyInitialLayout();
                this._inited = true;
            } catch (error) {
                this._reels = [];
                throw error;
            }

            this.startTicking();
        }

        /** 遊戲可覆寫：各軸 registerSymbolCells()、init()、configureIconDisplay()。 */
        protected registerInitialReelData(): void {
            // 留給繼承類別。
        }

        /** 遊戲可覆寫：各軸 setInitialLayout()。 */
        protected applyInitialLayout(): void {
            // 留給繼承類別。
        }

        /** 整台顯示區的裁切矩形；各軸幾何須一致。 */
        public createDisplayMaskRect(crossSize: number): egret.Rectangle {
            this.assertInitialized();
            return this._reels[0].createDisplayMaskRect(crossSize);
        }

        // ───────────────── 掉落 ─────────────────

        /**
         * 全軸掉出畫面；相鄰兩軸間隔 `dropOutIntervalSeconds`，Turbo 時不等。
         */
        public dropOut(fastMode = false): Promise<void> {
            const interval = fastMode ? 0 : this._dropOutInterval;
            return this.run(
                DropBatchKind.Out,
                interval,
                [],
                [],
                [],
            );
        }

        /**
         * 全軸掉入新盤面；相鄰兩軸間隔 `dropInIntervalSeconds`，Turbo 時不等。
         *
         * @param boards 每軸一份，畫面閱讀順序的逐格結果
         */
        public dropIn(boards: slot_core.SymbolData[][], fastMode = false): Promise<void> {
            this.assertOnePerReel(boards, "dropIn()");
            const interval = fastMode ? 0 : this._dropInInterval;
            return this.run(
                DropBatchKind.In,
                interval,
                boards,
                [],
                [],
            );
        }

        /**
         * 全軸同時消除並補牌（v3 `startDropRefill()`）。沒有要消的軸直接略過。
         *
         * @param removePositions 每軸的消除格子位置（畫面閱讀順序）
         * @param refillCells 每軸補進來的新牌（畫面閱讀順序），張數 = 該軸消掉的格數
         */
        public dropRefill(
            removePositions: number[][],
            refillCells: slot_core.SymbolData[][],
        ): Promise<void> {
            this.assertOnePerReel(removePositions, "dropRefill()");
            this.assertOnePerReel(refillCells, "dropRefill()");
            return this.run(
                DropBatchKind.Refill,
                0,
                [],
                removePositions,
                refillCells,
            );
        }

        /**
         * 急停：這批掉落直接到位（GameViewManager-Reference-Study §9 G6）。
         *
         * 還在等軸間隔的軸立刻開始，再讓全部軸直接放到終點；這批的 Promise
         * 照常 resolve，後續流程不變。沒在掉落時不做事。
         */
        public quickStop(): void {
            if (!this._running) {
                return;
            }

            while (this._pendingStarts.length > 0) {
                this.startOneReel(this._pendingStarts.shift() as PendingDropStart);
            }

            for (const reel of this._reels) {
                reel.quickStop();
            }

            this.tryFinishRun();
        }

        // ───────────────── 心跳 ─────────────────

        private readonly _tickHandler = (timeStamp: number): boolean => {
            const rawDelta = (timeStamp - this._lastTimeStamp) / 1000;
            this._lastTimeStamp = timeStamp;
            this.update(Math.min(rawDelta, BaseDropSlotMachine.MAX_DELTA_TIME));
            return false;
        };

        /** 推進一幀（秒）；上限鉗制由呼叫端負責，與 BaseSlotMachine.update() 相同。 */
        public update(deltaTime: number): void {
            if (!(deltaTime > 0)) {
                return;
            }

            if (this._running) {
                this._elapsed += deltaTime;
                this.startDueReels();
            }

            for (const reel of this._reels) {
                if (reel.inited) {
                    reel.update(deltaTime);
                }
            }

            this.tryFinishRun();
        }

        protected startTicking(): void {
            if (this._ticking) {
                return;
            }

            this._ticking = true;
            this._lastTimeStamp = egret.getTimer();
            egret.startTick(this._tickHandler, this);
        }

        protected stopTicking(): void {
            if (!this._ticking) {
                return;
            }

            this._ticking = false;
            egret.stopTick(this._tickHandler, this);
        }

        /** 外部對本機台的 `DropEvent` 監聽由監聽者自己移除。 */
        public cleanup(): void {
            this.stopTicking();

            for (const reel of this._reels) {
                reel.cleanup();
            }

            this._reels = [];
            this._completionPending = [];
            this.clearBatch();
            this._running = false;
            this._pendingStarts = [];
            this._resolveRun = undefined;
            this._elapsed = 0;
            this._inited = false;
        }

        // ───────────────── 內部 ─────────────────

        /**
         * 排程一批掉落：時間 0 的軸當場開始，其餘由 update() 依時間開始；
         * 全部開始、也全部掉完才 resolve。途中再下指令 → throw（Q6）；
         * 要提早結束用 `quickStop()`。
         */
        private run(
            kind: DropBatchKind,
            interval: number,
            boards: slot_core.SymbolData[][],
            removePositions: number[][],
            refillCells: slot_core.SymbolData[][],
        ): Promise<void> {
            this.assertInitialized();

            if (this._running) {
                throw new Error(
                    "A drop command cannot start while the previous one is still running.",
                );
            }

            /* 通過上面的檢查才寫入，不會蓋掉還在跑的那一批。 */
            this._batchKind = kind;
            this._batchBoards = boards;
            this._batchRemovePositions = removePositions;
            this._batchRefillCells = refillCells;

            this._running = true;
            this._elapsed = 0;
            this._pendingStarts = this.createPendingStarts(interval).sort(
                BaseDropSlotMachine.compareStartAt,
            );

            const promise = new Promise<void>(this._runPromiseExecutor);

            try {
                this.startDueReels();
            } catch (error) {
                this._running = false;
                this._pendingStarts = [];
                this._resolveRun = undefined;
                this.clearBatch();
                throw error;
            }

            this.tryFinishRun();
            return promise;
        }

        private startDueReels(): void {
            while (
                this._pendingStarts.length > 0
                && this._pendingStarts[0].startAt <= this._elapsed + 1e-9
            ) {
                this.startOneReel(this._pendingStarts.shift() as PendingDropStart);
            }
        }

        /**
         * 開始一軸並轉發它的開始／到位通知。
         *
         * 到位用單軸掉落的 Promise 得知：它先於這批的 Promise resolve，
         * 所以逐軸到位的通知一定在整批結束之前（`_reelDropSettledHandler`）。
         */
        private startOneReel(pending: PendingDropStart): void {
            const reel = this._reels[pending.reelIndex];
            const dropped = this.startReelDrop(
                reel,
                pending.reelIndex,
            );

            if (!reel.dropping) {
                return;
            }

            this._completionPending[pending.reelIndex] = true;
            this.dispatchReelDropEvent(
                DropEvent.REEL_DROP_STARTED,
                pending.reelIndex,
                reel,
            );

            /* 單軸 Promise 一定會 resolve（到位或急停），只有 cleanup 時可能懸著。 */
            void dropped.then(this._reelDropSettledHandler);
        }

        /** 依這批的種類開始第 `reelIndex` 軸的掉落。 */
        private startReelDrop(
            reel: BaseDropReel,
            reelIndex: number,
        ): Promise<void> {
            switch (this._batchKind) {
                case DropBatchKind.In:
                    return reel.startDropIn(this._batchBoards[reelIndex]);

                case DropBatchKind.Refill:
                    return reel.startDropRefill(
                        this._batchRemovePositions[reelIndex],
                        this._batchRefillCells[reelIndex],
                    );

                default:
                    /* DropBatchKind.Out */
                    return reel.startDropOut();
            }
        }

        /** 建一批的開始時刻：第 i 軸在 `i × interval` 秒開始。 */
        private createPendingStarts(interval: number): PendingDropStart[] {
            const starts: PendingDropStart[] = [];

            for (let index = 0; index < this._reels.length; index++) {
                starts.push({
                    reelIndex: index,
                    startAt: index * interval,
                });
            }

            return starts;
        }

        /** 放掉這批的逐軸資料（這批結束、出錯或 cleanup 時）。 */
        private clearBatch(): void {
            this._batchKind = DropBatchKind.Out;
            this._batchBoards = [];
            this._batchRemovePositions = [];
            this._batchRefillCells = [];
        }

        /** 排程順序：開始時刻早的在前。 */
        private static compareStartAt(
            first: PendingDropStart,
            second: PendingDropStart,
        ): number {
            return first.startAt - second.startAt;
        }

        /**
         * 發出逐軸的 `DropEvent`；沒人聽就不建立事件物件。
         *
         * 機台不監聽單軸自己的 `DROP_STARTED` / `DROP_COMPLETED`，那兩個留給遊戲。
         */
        private dispatchReelDropEvent(
            type: string,
            reelIndex: number,
            reel: BaseDropReel,
        ): void {
            if (!this.hasEventListener(type)) {
                return;
            }

            const event = new DropEvent(type);
            event.reelIndex = reelIndex;
            event.reel = reel;
            this.dispatchEvent(event);
        }

        /** 全部開始、也全部掉完就結束這批。 */
        private tryFinishRun(): void {
            if (
                !this._running
                || this._pendingStarts.length > 0
                || this.anyReelDropping()
            ) {
                return;
            }

            this._running = false;
            this.clearBatch();
            const resolve = this._resolveRun;
            this._resolveRun = undefined;

            if (resolve !== undefined) {
                resolve();
            }
        }

        private anyReelDropping(): boolean {
            for (const reel of this._reels) {
                if (reel.dropping) {
                    return true;
                }
            }

            return false;
        }

        private assertOnePerReel(
            values: any[],
            label: string,
        ): void {
            if (!Array.isArray(values) || values.length !== this._reels.length) {
                throw new Error(
                    `${label} requires one entry per reel (${this._reels.length}).`,
                );
            }
        }

        private assertInitialized(): void {
            if (!this._inited) {
                throw new Error("BaseDropSlotMachine.init() must be called first.");
            }
        }
    }
}
