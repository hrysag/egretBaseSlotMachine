import { BaseReel } from "./Reel/BaseReel";
import { BaseReelIcon } from "./Reel/BaseReelIcon";
import { SymbolData } from "./Reel/Data/SymbolData";
import {
    ReelState,
    ReelStopMode,
} from "./Reel/Runtime/ReelState";
import {
    ListenReelConfig,
    SlotMachineReelTiming,
    SlotMachineSpinConfig,
    SpinMode,
} from "./SlotMachine/Config/SlotMachineSpinConfig";
import {
    assertNonNegativeFiniteNumber,
    assertPositiveFiniteNumber,
} from "./Internal/NumberAssert";

interface PendingReelStart {
    readonly timing: SlotMachineReelTiming;
    readonly startAt: number;
}

/**
 * 可直接使用、也允許遊戲端繼承的多軸 SlotMachine 控制器。
 *
 * 只協調多軸，不改寫 BaseReel 的單軸運動規則。
 *
 * ## 與 Cocos 版的兩個結構差異
 *
 * 1. **不是 Component，而且擁有唯一的心跳。** Egret 沒有 Component 的
 *    update()，因此由本類別註冊一個 `egret.startTick` 並自行換算
 *    deltaTime，再推進所有 Reel。全場只有這一個心跳。
 * 2. **錯開啟動改用同一個時間累積器。** Cocos 版用 `scheduleOnce`，
 *    那是與 Movement 不同的時間源；Turbo 同步停輪對相位敏感，
 *    兩個時間源會讓各軸相位不可預測。
 */
export class BaseSlotMachine {
    /** 背景分頁恢復後 rAF 會補一個巨大的 deltaTime，必須鉗制。 */
    private static readonly MAX_DELTA_TIME = 0.1;

    private _inited = false;
    private readonly _spinConfigs =
        new Map<SpinMode, SlotMachineSpinConfig>();
    private _runtimeReels: BaseReel[] = [];
    private _currentSpinConfig?: SlotMachineSpinConfig;

    private _spinning = false;
    private _stopping = false;
    private _quickStopRequested = false;
    private _autoSpinEnabled = false;
    private _autoSpinMode?: SpinMode;
    private _lifecycleVersion = 0;
    private _listenReels: ListenReelConfig[] = [];
    private _activeReelIndexes: number[] = [];
    private _currentResultByReel?: SymbolData[][];

    /** 心跳狀態。 */
    private _ticking = false;
    private _lastTimeStamp = 0;

    /** 錯開啟動：與 Movement 共用同一個時間累積器。 */
    private _spinElapsed = 0;
    private _pendingStarts: PendingReelStart[] = [];
    private _resolveAllStarted?: () => void;
    private _startPromise?: Promise<void>;

    private _immediateStopPromise?: Promise<void>;

    /** 控制器呼叫單軸 startRoll() 後通知。 */
    public onReelStarted?: (reelIndex: number, reel: BaseReel) => void;

    /** 本輪全部有效軸都已啟動後通知。 */
    public onAllReelsStarted?: () => void;

    /** 單軸完成停止後通知。 */
    public onReelStopped?: (
        reelIndex: number,
        reel: BaseReel,
        mode: ReelStopMode,
    ) => void;

    /** 本輪全部有效軸完成停止後通知。 */
    public onAllReelsStopped?: () => void;

    /** 指定 Reel 真正進入本輪聽牌狀態時觸發。 */
    public onListenStart?: (reelIndex: number, reel: BaseReel) => void;

    /** 指定 Reel 完成本輪聽牌並停止時觸發。 */
    public onListenEnd?: (reelIndex: number, reel: BaseReel) => void;

    public get inited(): boolean {
        return this._inited;
    }

    public get spinning(): boolean {
        return this._spinning;
    }

    public get reelList(): BaseReel[] {
        return this._runtimeReels;
    }

    // ───────────────── 初始化 ─────────────────

    /**
     * 固定初始化順序；重複呼叫時安全略過。
     *
     * 心跳在此註冊，直到 cleanup() 才停止 —— 停輪後的停止效果仍需要
     * 每幀推進，所以不能在全軸停止時就關掉。
     */
    public init(reels: BaseReel[]): void {
        if (this._inited) {
            return;
        }

        this.validateReels(reels);
        this._runtimeReels = [...reels];

        try {
            this.registerInitialReelData();
            this.registerInitialSpinConfigs();
            this.applyInitialLayout();
            this._inited = true;
        } catch (error) {
            this._runtimeReels = [];
            throw error;
        }

        this.startTicking();
    }

    /** 註冊或完整取代一種 mode 的設定。 */
    public registerSpinConfig(
        mode: SpinMode,
        config: SlotMachineSpinConfig,
    ): void {
        if (this._inited) {
            throw new Error(
                "Spin configs cannot be registered after init().",
            );
        }

        this.validateSpinMode(mode);
        const snapshot = this.createSpinConfigSnapshot(config);
        this.validateSpinConfig(snapshot);
        this._spinConfigs.set(mode, snapshot);
    }

    // ───────────────── 心跳 ─────────────────

    /**
     * 全場唯一的心跳。
     *
     * Egret 的 tick 給的是 timeStamp（自框架啟動的毫秒數）而非
     * deltaTime，所以要自己相減；`startTick` 每個 rAF 都會觸發，
     * 與 frameRate 設定無關。
     */
    private readonly _tickHandler = (timeStamp: number): boolean => {
        const rawDelta = (timeStamp - this._lastTimeStamp) / 1000;
        this._lastTimeStamp = timeStamp;

        if (!(rawDelta > 0)) {
            return false;
        }

        const deltaTime = Math.min(
            rawDelta,
            BaseSlotMachine.MAX_DELTA_TIME,
        );

        if (this._spinning) {
            this._spinElapsed += deltaTime;
            this.startDueReels();
        }

        /*
         * 所有 Reel 都推進，不只作用軸 —— 停輪後的停止效果仍需要
         * 時間才能播完。閒置的 Reel 在 updateMovement() 內會自行略過。
         */
        for (const reel of this._runtimeReels) {
            if (reel.inited) {
                reel.updateMovement(deltaTime);
            }
        }

        return false;
    };

    private startTicking(): void {
        if (this._ticking) {
            return;
        }

        this._ticking = true;
        this._lastTimeStamp = egret.getTimer();
        egret.startTick(this._tickHandler, this);
    }

    private stopTicking(): void {
        if (!this._ticking) {
            return;
        }

        this._ticking = false;
        egret.stopTick(this._tickHandler, this);
    }

    // ───────────────── 開始 ─────────────────

    /**
     * 依 mode 套用當輪 Config 並依序啟動 Reel。
     *
     * 回傳的 Promise 在最後一軸啟動時 resolve。
     */
    public startSpin(
        mode: SpinMode,
        reelIndexes?: number[],
    ): Promise<void> {
        this.assertInitialized();

        if (this._spinning) {
            throw new Error("BaseSlotMachine is already spinning.");
        }

        const config = this._spinConfigs.get(mode);

        if (config === undefined) {
            throw new Error(
                `Spin config is not registered for mode: ${mode}.`,
            );
        }

        this._currentSpinConfig = config;
        this._activeReelIndexes = this.createActiveReelIndexes(
            config,
            reelIndexes,
        );

        const effectTimeScale = config.effectTimeScale !== undefined
            ? config.effectTimeScale
            : 1;

        for (const reelIndex of this._activeReelIndexes) {
            this._runtimeReels[reelIndex].setEffectTimeScale(
                effectTimeScale,
            );
        }

        this._quickStopRequested = false;
        this._currentResultByReel = undefined;
        this._stopping = false;
        this._spinning = true;
        this._spinElapsed = 0;
        this._pendingStarts = this.createPendingStarts(config);

        this._startPromise = new Promise<void>((resolve) => {
            this._resolveAllStarted = resolve;
        });

        /* 起始時間為 0 的軸在本呼叫內就啟動，不等下一個 tick。 */
        this.startDueReels();
        return this._startPromise;
    }

    /**
     * 把錯開啟動換算成相對本輪起點的絕對時間。
     *
     * fastMode 全部為 0，代表同一個同步迴圈內一起啟動 —— Turbo 同步
     * 停輪的相位前提就建立在這裡。
     */
    private createPendingStarts(
        config: SlotMachineSpinConfig,
    ): PendingReelStart[] {
        const result: PendingReelStart[] = [];
        let startAt = 0;

        for (const timing of this.getCurrentReelTimings()) {
            if (!config.fastMode) {
                startAt += timing.startDelaySeconds;
            }

            result.push({ timing, startAt });
        }

        return result;
    }

    private startDueReels(): void {
        while (
            this._pendingStarts.length > 0
            && this._pendingStarts[0].startAt <= this._spinElapsed
        ) {
            const pending = this._pendingStarts.shift() as PendingReelStart;
            this.startOneReel(pending.timing);
        }

        if (
            this._pendingStarts.length === 0
            && this._resolveAllStarted !== undefined
        ) {
            const resolve = this._resolveAllStarted;
            this._resolveAllStarted = undefined;
            if (this.onAllReelsStarted !== undefined) {
                this.onAllReelsStarted();
            }
            resolve();
        }
    }

    private startOneReel(timing: SlotMachineReelTiming): void {
        const reel = this._runtimeReels[timing.reelIndex];

        reel.setRollTiming({
            targetStopTime: timing.targetStopSeconds,
            moveInterval: timing.moveIntervalSeconds,
        });
        reel.startRoll();

        if (this._quickStopRequested) {
            reel.requestQuickStop();
        }

        if (this.onReelStarted !== undefined) {
            this.onReelStarted(timing.reelIndex, reel);
        }
    }

    /** 啟用 AutoSpin 並開始第一輪。 */
    public async autoSpin(mode: SpinMode): Promise<void> {
        this.assertInitialized();

        if (this._spinning) {
            throw new Error(
                "AutoSpin can only start while SlotMachine is stopped.",
            );
        }

        this._autoSpinEnabled = true;
        this._autoSpinMode = mode;
        await this.startSpin(mode);
    }

    /** 只阻止下一輪，不中斷目前 Spin。 */
    public stopAutoSpin(): void {
        this._autoSpinEnabled = false;
        this._autoSpinMode = undefined;
    }

    /** 登記本輪需要聽牌的 Reel。 */
    public setListenReels(configs: ListenReelConfig[]): void {
        this.assertInitialized();
        this._listenReels = configs.map((config) => ({
            reelIndex: config.reelIndex,
            duration: config.duration,
            speedMultiplier: config.speedMultiplier,
        }));
    }

    // ───────────────── 停止 ─────────────────

    /** 提交本輪 Server 結果並等待全部有效 Reel 停止。 */
    public async stopSpin(resultByReel: SymbolData[][]): Promise<void> {
        this.assertCanStop();
        this._stopping = true;
        this._currentResultByReel = resultByReel.map(
            (result) => [...result],
        );

        const waitPromises: Promise<void>[] = [];

        try {
            await this._startPromise;

            if (!this._inited) {
                return;
            }

            const stopTimings = this.createCurrentStopTimings(
                this.getCurrentReelTimings(),
            );

            for (const timing of stopTimings) {
                const reel = this._runtimeReels[timing.reelIndex];
                reel.setActiveTargetStopTime(timing.targetStopSeconds);
                reel.commitResult(resultByReel[timing.reelIndex]);
                waitPromises.push(
                    this.waitOneReelStopped(timing.reelIndex, reel),
                );
            }

            if (
                this._quickStopRequested
                && this._currentSpinConfig !== undefined
                && this._currentSpinConfig.fastMode === true
            ) {
                this.prepareFastQuickStopPadding();
            }

            await this.runListenSequence(stopTimings);
            await Promise.all(waitPromises);

            if (this._inited) {
                await this.completeStoppedSpin();
            }
        } catch (error) {
            this._stopping = false;
            throw error;
        }
    }

    /** 將 QuickStop 轉發給本輪已啟動的 Reel；未啟動軸會在開始時套用。 */
    public quickStop(): void {
        this.assertInitialized();

        if (
            !this._spinning
            || this._quickStopRequested
            || this._immediateStopPromise !== undefined
        ) {
            return;
        }

        this._quickStopRequested = true;

        for (const timing of this.getCurrentReelTimings()) {
            const reel = this._runtimeReels[timing.reelIndex];

            if (
                reel.state === ReelState.Rolling
                || reel.state === ReelState.Stopping
            ) {
                reel.requestQuickStop();
            }
        }

        if (
            this._currentSpinConfig !== undefined
            && this._currentSpinConfig.fastMode === true
            && this._currentResultByReel !== undefined
        ) {
            this.prepareFastQuickStopPadding();
        }
    }

    /**
     * Turbo QuickStop：以所有啟動軸中最長的直接停止距離為共同目標。
     *
     * 每格等寬之後單軸距離是純算術（見 BaseReel），差額用完整 Cell 的
     * 表演牌補足，不改變任何 Reel 的速度。
     *
     * fastMode 下所有軸在同一個同步迴圈啟動，相位相同，差額必為偶數個
     * half-Cell。若各軸設了不同的 moveIntervalSeconds，相位會漂開而
     * 出現奇數差 —— 此時無條件進位成完整 Cell 並提出警告，讓該軸晚半格
     * 停止，而不是讓整輪丟出例外。
     */
    private prepareFastQuickStopPadding(): void {
        const resultByReel = this._currentResultByReel;

        if (resultByReel === undefined) {
            return;
        }

        const projections: {
            reel: BaseReel;
            reelIndex: number;
            halfCellCount: number;
        }[] = [];

        for (const timing of this.getCurrentReelTimings()) {
            const reel = this._runtimeReels[timing.reelIndex];
            const result = resultByReel[timing.reelIndex];

            if (
                result === undefined
                || (
                    reel.state !== ReelState.Rolling
                    && reel.state !== ReelState.Stopping
                )
            ) {
                continue;
            }

            projections.push({
                reel,
                reelIndex: timing.reelIndex,
                halfCellCount: reel.calculateQuickStopHalfCellCount(),
            });
        }

        if (projections.length === 0) {
            return;
        }

        let commonHalfCellCount = 0;

        for (const projection of projections) {
            commonHalfCellCount = Math.max(
                commonHalfCellCount,
                projection.halfCellCount,
            );
        }

        for (const projection of projections) {
            const difference =
                commonHalfCellCount - projection.halfCellCount;

            if (difference % 2 !== 0) {
                console.warn(
                    "[BaseSlotMachine] Reel "
                    + `${projection.reelIndex} 與其他軸相差半個 Cell，`
                    + "無法完全同步；請確認各軸的 moveIntervalSeconds "
                    + "是否一致。本軸將晚半格停止。",
                );
            }

            projection.reel.applyQuickStopPadding(
                Math.ceil(difference / 2),
            );
        }
    }

    /** 取消尚未啟動的軸，並讓已啟動軸停在目前完整 Cell 邊界。 */
    public immediateStop(): void {
        this.assertInitialized();

        if (!this._spinning || this._stopping) {
            return;
        }

        this.stopAutoSpin();
        this._pendingStarts = [];
        this._stopping = true;

        const activeReels: { reelIndex: number; reel: BaseReel }[] = [];

        for (const timing of this.getCurrentReelTimings()) {
            const reel = this._runtimeReels[timing.reelIndex];

            if (
                reel.state !== ReelState.Rolling
                && reel.state !== ReelState.Stopping
            ) {
                continue;
            }

            reel.requestImmediateStop();
            activeReels.push({ reelIndex: timing.reelIndex, reel });
        }

        this._immediateStopPromise =
            this.waitForImmediateStop(activeReels);
    }

    /**
     * 取消排程、清除控制器狀態與 Callback，並停止心跳。
     *
     * 不呼叫 BaseReel.cleanup() —— Reel 的生命週期由建立它的人負責。
     */
    public cleanup(): void {
        this.stopTicking();
        this._lifecycleVersion++;
        this._autoSpinEnabled = false;
        this._autoSpinMode = undefined;
        this._spinning = false;
        this._stopping = false;
        this._quickStopRequested = false;
        this._currentSpinConfig = undefined;
        this._currentResultByReel = undefined;
        this._pendingStarts = [];
        this._spinElapsed = 0;
        this._startPromise = undefined;
        this._resolveAllStarted = undefined;
        this._immediateStopPromise = undefined;
        this._spinConfigs.clear();
        this._listenReels = [];
        this._activeReelIndexes = [];
        this._runtimeReels = [];
        this.onReelStarted = undefined;
        this.onAllReelsStarted = undefined;
        this.onReelStopped = undefined;
        this.onAllReelsStopped = undefined;
        this.onListenStart = undefined;
        this.onListenEnd = undefined;
        this._inited = false;
    }

    // ───────────────── 查詢 ─────────────────

    /** 取得指定軸目前顯示區的逐 Cell Symbol ID。 */
    public getVisibleSymbolIds(reelIndex: number): number[] {
        return this.getReel(reelIndex).getVisibleCellSymbolIds();
    }

    /** 聚合全部 Reel 的顯示區逐 Cell Symbol ID。 */
    public getAllVisibleSymbolIds(): number[][] {
        return this._runtimeReels.map(
            (reel) => reel.getVisibleCellSymbolIds(),
        );
    }

    /**
     * 取得指定軸目前圖有出現在顯示區的 Icon，依畫面閱讀順序排列。
     *
     * 一個大 Symbol 只回傳它的 head 一次；截斷盤面上 head 可能位於
     * buffer 內，因此這份清單與「可視段的每一格」不等長。
     */
    public getVisibleIcons(reelIndex: number): BaseReelIcon[] {
        return this.getReel(reelIndex).getVisibleIcons();
    }

    /** 聚合全部 Reel 的可見 Icon。 */
    public getAllVisibleIcons(): BaseReelIcon[][] {
        return this._runtimeReels.map((reel) => reel.getVisibleIcons());
    }

    // ───────────────── 繼承 Hook ─────────────────

    /** 遊戲可覆寫，註冊 Symbol 與表演資料；Base 預設不做事。 */
    protected registerInitialReelData(): void {
        // 留給繼承類別。
    }

    /** 遊戲可覆寫，註冊所有 Spin mode Config；Base 預設不做事。 */
    protected registerInitialSpinConfigs(): void {
        // 留給繼承類別。
    }

    /** 遊戲可覆寫，寫入各軸初始盤面；Base 預設不做事。 */
    protected applyInitialLayout(): void {
        // 留給繼承類別。
    }

    // ───────────────── 內部 ─────────────────

    private async startNextAutoSpinIfNeeded(): Promise<void> {
        if (
            !this._inited
            || !this._autoSpinEnabled
            || this._autoSpinMode === undefined
        ) {
            return;
        }

        await this.startSpin(this._autoSpinMode);
    }

    private async waitOneReelStopped(
        reelIndex: number,
        reel: BaseReel,
    ): Promise<void> {
        const lifecycleVersion = this._lifecycleVersion;
        await reel.waitForStoppedAsync();

        if (
            !this._inited
            || lifecycleVersion !== this._lifecycleVersion
        ) {
            return;
        }

        if (this.onReelStopped !== undefined) {
            this.onReelStopped(reelIndex, reel, reel.stopMode);
        }
    }

    private async waitForImmediateStop(
        activeReels: { reelIndex: number; reel: BaseReel }[],
    ): Promise<void> {
        const waitPromises = activeReels.map(
            (item) => this.waitOneReelStopped(item.reelIndex, item.reel),
        );

        try {
            await Promise.all(waitPromises);

            if (this._inited) {
                await this.completeStoppedSpin();
            }
        } finally {
            this._immediateStopPromise = undefined;
        }
    }

    private async completeStoppedSpin(): Promise<void> {
        this._spinning = false;
        this._stopping = false;
        this._quickStopRequested = false;
        this._currentResultByReel = undefined;
        this._currentSpinConfig = undefined;
        this._listenReels = [];
        this._activeReelIndexes = [];
        this._pendingStarts = [];
        this._spinElapsed = 0;
        this._startPromise = undefined;
        if (this.onAllReelsStopped !== undefined) {
            this.onAllReelsStopped();
        }
        await this.startNextAutoSpinIfNeeded();
    }

    /**
     * 依原本停止順序建立本輪目標。
     *
     * 聽牌軸從前一軸的停止目標起算 duration；後續普通軸保留原本軸間距，
     * 但不會因此成為聽牌軸。
     */
    private createCurrentStopTimings(
        timings: SlotMachineReelTiming[],
    ): SlotMachineReelTiming[] {
        const result: SlotMachineReelTiming[] = [];
        let startTime = 0;
        let previousBaseStopTime = 0;
        let previousCurrentStopTime = 0;

        for (const timing of timings) {
            startTime += timing.startDelaySeconds;
            const baseStopTime = startTime + timing.targetStopSeconds;
            const listenConfig = this.getListenConfig(timing.reelIndex);
            let currentStopTime = baseStopTime;

            if (result.length > 0) {
                if (listenConfig !== undefined) {
                    currentStopTime =
                        previousCurrentStopTime + listenConfig.duration;
                } else {
                    const baseStopGap = Math.max(
                        0,
                        baseStopTime - previousBaseStopTime,
                    );
                    currentStopTime = Math.max(
                        baseStopTime,
                        previousCurrentStopTime + baseStopGap,
                    );
                }
            } else if (listenConfig !== undefined) {
                currentStopTime = Math.max(
                    baseStopTime,
                    listenConfig.duration,
                );
            }

            result.push({
                reelIndex: timing.reelIndex,
                startDelaySeconds: timing.startDelaySeconds,
                targetStopSeconds: Math.max(
                    0,
                    currentStopTime - startTime,
                ),
                moveIntervalSeconds: timing.moveIntervalSeconds,
            });
            previousBaseStopTime = baseStopTime;
            previousCurrentStopTime = currentStopTime;
        }

        return result;
    }

    private async runListenSequence(
        timings: SlotMachineReelTiming[],
    ): Promise<void> {
        const tasks: Promise<void>[] = [];

        for (let index = 0; index < timings.length; index++) {
            const timing = timings[index];
            const listenConfig = this.getListenConfig(timing.reelIndex);

            if (listenConfig === undefined) {
                continue;
            }

            tasks.push(
                this.runOneListenReel(
                    timing,
                    listenConfig,
                    index > 0 ? timings[index - 1] : undefined,
                ),
            );
        }

        await Promise.all(tasks);
    }

    /** 前一軸實際停止後，才切換指定 Reel 的聽牌速度與效果。 */
    private async runOneListenReel(
        timing: SlotMachineReelTiming,
        listenConfig: ListenReelConfig,
        previousTiming?: SlotMachineReelTiming,
    ): Promise<void> {
        if (previousTiming !== undefined) {
            await this._runtimeReels[
                previousTiming.reelIndex
            ].waitForStoppedAsync();
        }

        if (!this._inited || !this._spinning) {
            return;
        }

        const reel = this._runtimeReels[timing.reelIndex];

        if (
            reel.state !== ReelState.Rolling
            && reel.state !== ReelState.Stopping
        ) {
            return;
        }

        /*
         * duration 從 Callback 發生的這一刻起算，不是加在原始
         * targetStopTime 上；前一軸的實際停止誤差不會吃掉聽牌時間。
         */
        reel.setActiveTargetStopTime(
            reel.elapsedRollTime + listenConfig.duration,
        );
        reel.setActiveMoveInterval(
            timing.moveIntervalSeconds / listenConfig.speedMultiplier,
        );
        if (this.onListenStart !== undefined) {
            this.onListenStart(timing.reelIndex, reel);
        }
        await reel.waitForStoppedAsync();

        if (this._inited) {
            if (this.onListenEnd !== undefined) {
                this.onListenEnd(timing.reelIndex, reel);
            }
        }
    }

    private getListenConfig(
        reelIndex: number,
    ): ListenReelConfig | undefined {
        return this._listenReels.find(
            (config) => config.reelIndex === reelIndex,
        );
    }

    private assertCanStop(): void {
        this.assertInitialized();

        if (!this._spinning) {
            throw new Error(
                "BaseSlotMachine.startSpin() must be called first.",
            );
        }

        if (this._stopping) {
            throw new Error("BaseSlotMachine is already stopping.");
        }
    }

    private getCurrentReelTimings(): SlotMachineReelTiming[] {
        if (this._currentSpinConfig === undefined) {
            return [];
        }

        const result: SlotMachineReelTiming[] = [];

        for (const timing of this._currentSpinConfig.reelTimings) {
            if (this._activeReelIndexes.indexOf(timing.reelIndex) < 0) {
                continue;
            }

            result.push({
                reelIndex: timing.reelIndex,
                startDelaySeconds:
                    result.length === 0 ? 0 : timing.startDelaySeconds,
                targetStopSeconds: timing.targetStopSeconds,
                moveIntervalSeconds: timing.moveIntervalSeconds,
            });
        }

        return result;
    }

    /**
     * 建立本輪真正參與滾動的 Reel 索引。
     *
     * 未傳入時使用目前 mode 的全部 Reel；傳入時依 reelTimings 原有順序
     * 挑出指定 Reel，未被挑中的就是本輪鎖軸。
     */
    private createActiveReelIndexes(
        config: SlotMachineSpinConfig,
        reelIndexes?: number[],
    ): number[] {
        if (reelIndexes === undefined) {
            return config.reelTimings.map((timing) => timing.reelIndex);
        }

        const selected = reelIndexes.slice();
        const result = config.reelTimings
            .filter(
                (timing) => selected.indexOf(timing.reelIndex) >= 0,
            )
            .map((timing) => timing.reelIndex);

        if (result.length === 0) {
            throw new Error(
                "At least one Reel must be selected for this Spin.",
            );
        }

        return result;
    }

    private getReel(reelIndex: number): BaseReel {
        this.assertInitialized();

        if (
            !Number.isInteger(reelIndex)
            || reelIndex < 0
            || reelIndex >= this._runtimeReels.length
        ) {
            throw new Error(`reelIndex is out of range: ${reelIndex}.`);
        }

        return this._runtimeReels[reelIndex];
    }

    private createSpinConfigSnapshot(
        config: SlotMachineSpinConfig,
    ): SlotMachineSpinConfig {
        if (
            config === null
            || config === undefined
            || !Array.isArray(config.reelTimings)
        ) {
            throw new Error(
                "SlotMachineSpinConfig.reelTimings is required.",
            );
        }

        return {
            fastMode: config.fastMode,
            effectTimeScale: config.effectTimeScale,
            reelTimings: config.reelTimings.map((timing) => ({
                reelIndex: timing.reelIndex,
                startDelaySeconds: timing.startDelaySeconds,
                targetStopSeconds: timing.targetStopSeconds,
                moveIntervalSeconds: timing.moveIntervalSeconds,
            })),
        };
    }

    private validateSpinConfig(config: SlotMachineSpinConfig): void {
        if (config.reelTimings.length === 0) {
            throw new Error(
                "SlotMachineSpinConfig requires at least one reel timing.",
            );
        }

        const usedReelIndexes: boolean[] = [];

        for (const timing of config.reelTimings) {
            this.validateReelTiming(timing);

            if (usedReelIndexes[timing.reelIndex]) {
                throw new Error(
                    `Duplicate reelIndex in spin config: ${timing.reelIndex}.`,
                );
            }

            usedReelIndexes[timing.reelIndex] = true;
        }
    }

    private validateReelTiming(timing: SlotMachineReelTiming): void {
        if (
            !Number.isInteger(timing.reelIndex)
            || timing.reelIndex < 0
        ) {
            throw new Error(
                `reelIndex must be a non-negative integer: ${timing.reelIndex}.`,
            );
        }

        assertNonNegativeFiniteNumber(
            timing.startDelaySeconds,
            "startDelaySeconds",
        );
        assertPositiveFiniteNumber(
            timing.targetStopSeconds,
            "targetStopSeconds",
        );
        assertPositiveFiniteNumber(
            timing.moveIntervalSeconds,
            "moveIntervalSeconds",
        );
    }

    private validateReels(reels: BaseReel[]): void {
        if (!Array.isArray(reels) || reels.length === 0) {
            throw new Error(
                "BaseSlotMachine requires at least one Reel.",
            );
        }

        for (let index = 0; index < reels.length; index++) {
            const reel = reels[index];

            if (reel === null || reel === undefined) {
                throw new Error(`Reel is required at index ${index}.`);
            }

            if (reels.indexOf(reel) !== index) {
                throw new Error(`Duplicate Reel at index ${index}.`);
            }
        }
    }

    private validateSpinMode(mode: SpinMode): void {
        if (typeof mode !== "string" || mode.trim().length === 0) {
            throw new Error("SpinMode must be a non-empty string.");
        }
    }

    private assertInitialized(): void {
        if (!this._inited) {
            throw new Error(
                "BaseSlotMachine.init() must be called first.",
            );
        }
    }
}
