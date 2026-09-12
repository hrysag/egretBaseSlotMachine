import { BaseReelIcon } from "./BaseReelIcon";
import {
    BaseReelConfig,
    ReelIconDisplayConfig,
} from "./Config/ReelConfig";
import { ReelTimingConfig } from "./Config/ReelTimingConfig";
import {
    ReelLayoutSource,
    ReelSymbolRuntime,
} from "./Data/ReelData";
import {
    ReelSymbolCellDefinition,
    ReelSymbolRegistry,
} from "./Data/ReelSymbolRegistry";
import { SymbolData } from "./Data/SymbolData";
import { BaseMovement } from "./Internal/BaseMovement";
import { ReelAxisEffect } from "./Internal/ReelAxisEffect";
import {
    ReelConsumedData,
    ReelDataFlow,
} from "./Internal/ReelDataFlow";
import { ReelDataList } from "./Internal/ReelDataList";
import { ReelIconManager } from "./Internal/ReelIconManager";
import { ReelStopFlow } from "./Internal/ReelStopFlow";
import {
    ReelState,
    ReelStopMode,
} from "./Runtime/ReelState";
import { ReelStopPlan } from "./Runtime/ReelStopPlan";
import {
    assertNonNegativeFiniteNumber,
    assertPositiveFiniteNumber,
    assertPositiveInteger,
} from "../Internal/NumberAssert";

export type { ReelLayoutSource, ReelSymbolRuntime } from "./Data/ReelData";
export type { SymbolData, SymbolVisualSize } from "./Data/SymbolData";
export type { ReelSymbolCellDefinition } from "./Data/ReelSymbolRegistry";
export { ReelExpediteReason } from "./Runtime/ReelStopPlan";
export type { ReelStopPlan, ReelStopPlanInput } from "./Runtime/ReelStopPlan";

/**
 * 可直接使用、也允許遊戲端繼承的單軸 Reel。
 *
 * ## 與 Cocos 版的三個結構差異
 *
 * 1. **不是 Component。** Egret 沒有 Component 機制，本類別是普通 class，
 *    持有一個 Icon 容器；每幀由上層呼叫 `updateMovement(deltaTime)`。
 *    Cocos 版的 `ReelUpdateMode.Self` 沒有對應物，已移除。
 * 2. **Runtime 恆為 1×1。** 大於一格的 Symbol 由連續 N 格組成一個 group，
 *    以 `groupOffset` 表示組內位置，head 在進場側。
 * 3. **位置用算的。** 整軸只保存一個 `stripOffset`（由 Movement 的值取模
 *    得到），交接由完整 Cell 計數器驅動，不做幾何比較。
 *
 * ## 主線讀法
 *
 * 讀這五個就懂滾輪怎麼轉，其餘都是它們的零件：
 *
 * ```text
 * init()                       建立幾何、時間與 Movement 接線
 * setInitialLayout()           套用初始盤面
 * startRoll()                  啟動效果 → beginFirstCellMovement()
 * updateMovement(deltaTime)    每幀入口，由 BaseSlotMachine 統一呼叫
 * _secondHalfCompleteHandler   一格結束：提交結果 → 回收 → 判停或排下一格
 * ```
 *
 * 循環本體在 `_secondHalfCompleteHandler` 底下三段，與 v3 的
 * `UniReel.moveOnceComplete()` 分工相同：
 *
 * ```text
 * tryCommitResultAtBoundary()  本輪結果要不要在這個邊界提交（v3 沒有）
 * drainPendingHandoffs()       → handoffOneCell()：取資料、回收一格
 * tryCompleteStop()            對齊就停，否則 queueOneCellMovement()
 * ```
 *
 * 停輪只是「不再排下一格」，沒有額外的停止指令。
 *
 * ## 區塊順序
 *
 * 欄位與 handler → 建立 → 滾動資料與時間 → **主線** → 急停與即停
 * → 查詢 → 等待／重設／釋放 → 零件。
 */
export class BaseReel {
    private _inited = false;

    private _moveInterval = 0;

    private _effectTimeScale = 1;

    private readonly _movement = new BaseMovement();

    private readonly _startEffect = new ReelAxisEffect();

    private readonly _stopEffect = new ReelAxisEffect();

    private readonly _iconManager = new ReelIconManager();

    private readonly _dataFlow = new ReelDataFlow();

    private readonly _symbolRegistry = new ReelSymbolRegistry();

    private _waitingForStartEffect = false;

    private _stopPromise?: Promise<void>;

    private _resolveStopPromise?: () => void;

    private _state = ReelState.Idle;

    private _stopMode = ReelStopMode.ResultAligned;

    /** 第一或第二個半 Cell 完成時通知使用端。 */
    public onHalfCellComplete?: (completedHalf: 1 | 2) => void;

    /** 一個完整 Cell Movement 完成時通知使用端。 */
    public onCellMovementComplete?: () => void;

    /** 本軸已進入 Rolling 且第一個 Cell Movement 已排入後觸發。 */
    public onRollStarted?: () => void;

    /**
     * 本軸已在完整 Cell 邊界進入 Stopped 後觸發。
     *
     * 只代表 Reel 停止移動；停止效果完成是另一個事件。
     */
    public onRollStopped?: (mode: ReelStopMode) => void;

    /** 正式結果停止後開始播放停止效果時觸發。 */
    public onStopEffectStarted?: () => void;

    /** 停止效果已回到正式停止位置時觸發。 */
    public onStopEffectCompleted?: () => void;

    /** 啟動效果完成、第一個 Cell Movement 即將排入時觸發。 */
    public onStartEffectCompleted?: () => void;

    /**
     * 某一格完成新資料綁定與位置計算後通知使用端。
     *
     * View 可在此更新顯示；BaseReel 本身不操作任何顯示物件。
     */
    public onReelDataChanged?: (
        runtime: ReelSymbolRuntime,
        previousData: SymbolData,
    ) => void;

    // ───────────────── 內部 handler ─────────────────
    private readonly _movementValueChangedHandler = (
        value: number,
    ): void => {
        this._iconManager.applyMovementValue(value);
        this._iconManager.syncAllIcons();
    };

    /** 第一個半 Cell 完成：只通知，不交接也不停止。 */
    private readonly _firstHalfCompleteHandler = (): void => {
        this.onHalfCellComplete?.(1);
    };

    /**
     * 第二個半 Cell 完成：形成完整 Cell 邊界。
     *
     * 交接與停止判斷都固定落在這裡 —— 每格等寬之後相位恆定，
     * 不需要（也不應該）用幾何比較去猜時機。
     *
     * 三段分工與 v3 的 UniReel.moveOnceComplete() 相同：
     * 先決定本輪結果要不要在這次邊界提交，再回收欠下的格，
     * 最後判停或排下一格。handoffOneCell() 因此只管循環。
     */
    private readonly _secondHalfCompleteHandler = (): void => {
        this.tryCommitResultAtBoundary();
        this.drainPendingHandoffs();
        this.onHalfCellComplete?.(2);
        this.onCellMovementComplete?.();

        if (!this.tryCompleteStop()) {
            this.queueOneCellMovement(this._moveInterval);
        }
    };

    private readonly _performanceDataProvider = (): SymbolData => {
        return this.getNextPerformanceData();
    };

    private readonly _cellSpanResolver = (data: SymbolData): number => {
        return this._iconManager.getCellSpan(data);
    };

    private readonly _flowDataValidator = (
        data: SymbolData,
        label: string,
    ): void => {
        this._iconManager.validateData(data, label);
    };

    private readonly _stopFlow = new ReelStopFlow(
        this._dataFlow,
        this._cellSpanResolver,
        this._performanceDataProvider,
        this._flowDataValidator,
    );

    // ───────────────── 建立 ─────────────────
    /**
     * 正式初始化。
     *
     * 只建立 Cell、Movement 與更新規格，不指定初始牌面；
     * 初始化後再由 setInitialLayout() 套用第一批資料。
     *
     * `maxCellSpan` 未指定時取 Registry 已註冊的最大值，因此
     * **registerSymbolCells() 必須先呼叫**。
     */
    public init(config: BaseReelConfig): void {
        if (this.isActive()) {
            throw new Error(
                "BaseReel cannot be initialized while it is active.",
            );
        }

        this.configureGeometry(config);
        this.configureTiming(config);
        this.wireMovementAndReset();
    }

    /**
     * 驗證幾何設定並交給 ReelIconManager。
     *
     * `maxCellSpan` 未指定時由 Registry 取最大值，所以
     * registerSymbolCells() 必須先完成。
     */
    private configureGeometry(config: BaseReelConfig): void {
        assertPositiveInteger(
            config.visibleCellCount,
            "visibleCellCount",
        );
        assertPositiveFiniteNumber(config.cellSize, "cellSize");

        const cellSpacing = config.cellSpacing ?? 0;
        const alignmentEpsilon = config.alignmentEpsilon ?? 0.0001;
        const maxCellSpan =
            config.maxCellSpan ?? this._symbolRegistry.getMaxCellSpan();

        assertNonNegativeFiniteNumber(cellSpacing, "cellSpacing");
        assertNonNegativeFiniteNumber(
            alignmentEpsilon,
            "alignmentEpsilon",
        );
        assertPositiveInteger(maxCellSpan, "maxCellSpan");

        this._iconManager.configure(
            config.visibleCellCount,
            config.cellSize,
            cellSpacing,
            alignmentEpsilon,
            maxCellSpan,
            this._symbolRegistry,
        );
        this._iconManager.configureDisplay(
            config.layoutType,
            config.inverseDirection,
        );
    }

    /** 設定每格移動時間與啟動／停止效果。 */
    private configureTiming(config: BaseReelConfig): void {
        if (config.moveInterval !== undefined) {
            assertPositiveFiniteNumber(
                config.moveInterval,
                "moveInterval",
            );
        }

        this._moveInterval = config.moveInterval ?? 0;
        this._startEffect.configure(config.startEffect);
        this._stopEffect.configure(config.stopEffect);
    }

    /** 接上 Movement 的每幀回呼，歸零狀態，標記為已初始化。 */
    private wireMovementAndReset(): void {
        this.resetRuntimeData();
        this._movement.onValueChanged = this._movementValueChangedHandler;
        this.resetMovement();
        this._inited = true;
        this._state = ReelState.Idle;
        this._stopMode = ReelStopMode.ResultAligned;
    }

    /**
     * 登記每個 Symbol ID 固定占用的 Cell 數量。
     *
     * 必須在 init() 之前呼叫（maxCellSpan 由此推得），也必須在套用
     * 初始盤面或提供滾動資料之前完成。
     */
    public registerSymbolCells(
        definitions: ReelSymbolCellDefinition[],
    ): void {
        if (this.isActive()) {
            throw new Error(
                "Symbol cells cannot be registered while the reel is active.",
            );
        }

        this._symbolRegistry.register(definitions);
    }

    /**
     * 套用初始盤面。
     *
     * 三段皆以資料流方向（進場端 → 退場端）排列。
     */
    public setInitialLayout(source: ReelLayoutSource): void {
        this.assertInitialized();

        if (this.isActive()) {
            throw new Error(
                "Initial layout cannot be changed while the reel is active.",
            );
        }

        this.resetMovement();
        this._iconManager.initialize(source);
        this._iconManager.syncAllIcons();
    }

    /**
     * 停軸後以新的 Symbol 組合重建整軸排列。
     *
     * 適用於某張牌播放特殊效果後由 1×1 展開成 1×N。若同一 Symbol ID
     * 的 cellSpan 已改變，呼叫前必須先 registerSymbolCells() 重新註冊。
     */
    public reconfigureStoppedLayout(source: ReelLayoutSource): void {
        this.assertInitialized();

        if (this._state !== ReelState.Stopped) {
            throw new Error(
                "Stopped layout can only be reconfigured after the reel has stopped.",
            );
        }

        this.setInitialLayout(source);
    }

    /** 建立 Icon 載體並綁定容器。 */
    public configureIconDisplay(config: ReelIconDisplayConfig): void {
        this.assertInitialized();

        if (this.isActive()) {
            throw new Error(
                "Icon display cannot be changed while the reel is active.",
            );
        }

        this._iconManager.initializeIcons(
            config.container,
            config.iconFactory,
        );
    }

    /** 移除 Icon 載體，保留純數值 strip。 */
    public clearIconDisplay(): void {
        if (this.isActive()) {
            throw new Error(
                "Icon display cannot be cleared while the reel is active.",
            );
        }

        this._iconManager.clearIcons();
    }

    /** 產生顯示區裁切矩形，由呼叫端指定給容器的 mask。 */
    public createDisplayMaskRect(crossSize: number): egret.Rectangle {
        this.assertInitialized();
        return this._iconManager.createDisplayMaskRect(crossSize);
    }

    // ───────────────── 滾動資料與時間 ─────────────────
    /**
     * 設定本輪可供表演使用的亂數牌庫。
     *
     * 牌庫以 **Symbol** 為單位；框架在入列時展開成 Cell。
     */
    public setPerformanceDataBank(data: SymbolData[]): void {
        this.assertInitialized();

        if (this.isActive()) {
            throw new Error(
                "Performance data bank cannot be replaced while the reel is active.",
            );
        }

        this._dataFlow.setPerformanceDataBank(
            data,
            this._cellSpanResolver,
        );
    }

    /** 尚未提交正式結果前，追加外部生成的表演資料。 */
    public appendPerformanceData(data: SymbolData[]): void {
        this.assertInitialized();
        this._dataFlow.appendPerformanceData(
            data,
            this._cellSpanResolver,
        );
    }

    /**
     * 取得下一筆表演資料的繼承 Hook。
     *
     * 預設循環使用 setPerformanceDataBank() 的牌庫；遊戲子類可覆寫。
     */
    protected getNextPerformanceData(): SymbolData {
        return this._dataFlow.getNextPerformanceData();
    }

    /** 設定本輪目標停止時間與每 Cell 移動時間。 */
    public setRollTiming(config: ReelTimingConfig): void {
        this.assertInitialized();

        if (this.isActive()) {
            throw new Error(
                "Roll timing cannot be changed while the reel is active.",
            );
        }

        assertNonNegativeFiniteNumber(
            config.targetStopTime,
            "targetStopTime",
        );
        assertPositiveFiniteNumber(
            config.moveInterval,
            "moveInterval",
        );

        this._stopFlow.setTiming(config);
        this._moveInterval = config.moveInterval;
    }

    /** 設定下一輪軸向效果的時間倍率。 */
    public setEffectTimeScale(value: number): void {
        assertPositiveFiniteNumber(value, "effectTimeScale");
        this._effectTimeScale = value;
    }

    /** 運行中改變本輪停止目標，供上層依聽牌順序重排。 */
    public setActiveTargetStopTime(targetStopTime: number): void {
        this.assertInitialized();
        assertNonNegativeFiniteNumber(
            targetStopTime,
            "targetStopTime",
        );

        if (!this.isActive()) {
            throw new Error(
                "Active target stop time can only be changed while the reel is active.",
            );
        }

        this._stopFlow.setTargetStopTime(targetStopTime);
    }

    /**
     * 運行中改變每個完整 Cell 的移動時間。
     *
     * 已排入的 Movement 會用原時間走完，下一格才套用新值。
     */
    public setActiveMoveInterval(moveInterval: number): void {
        this.assertInitialized();
        assertPositiveFiniteNumber(moveInterval, "moveInterval");

        if (!this.isActive()) {
            throw new Error(
                "Active move interval can only be changed while the reel is active.",
            );
        }

        this._moveInterval = moveInterval;
    }

    // ───────────────── 主線：一輪滾動 ─────────────────
    /** 由遊戲流程明確啟動本軸。 */
    public startRoll(): void {
        this.assertInitialized();

        if (this._stopEffect.active) {
            throw new Error(
                "BaseReel cannot start while the stop effect is active.",
            );
        }

        if (this._iconManager.symbols.length < 3) {
            throw new Error(
                "Call BaseReel.setInitialLayout() before startRoll().",
            );
        }

        assertPositiveFiniteNumber(
            this._moveInterval,
            "moveInterval",
        );

        if (
            this._state !== ReelState.Idle
            && this._state !== ReelState.Stopped
        ) {
            throw new Error("BaseReel is already active.");
        }

        this.resetSpinData();
        this.resetMovement();
        this.replaceEntryPreparationData();
        this._stopMode = ReelStopMode.ResultAligned;
        this.changeState(ReelState.Rolling);

        /* 軸向往退場方向遞增，所以啟動效果往負向拉。 */
        this._waitingForStartEffect = this._startEffect.start(
            -1,
            this._effectTimeScale,
        );

        if (!this._waitingForStartEffect) {
            this.beginFirstCellMovement();
        }
    }

    private beginFirstCellMovement(): void {
        this.queueOneCellMovement(this._moveInterval);
        this.onRollStarted?.();
    }

    /**
     * 每輪開始前，把完整位於進場預備區的格子改綁本輪表演資料。
     *
     * **只換整組都在 buffer 內的格子** —— 上一輪若停在被截斷的大 Symbol
     * 上，它的 head 就坐在進場 buffer 裡而 follower 還在顯示區；換掉 head
     * 會讓那張圖直接消失，留下一排沒有 head 的孤兒。
     */
    private replaceEntryPreparationData(): void {
        const replaceable =
            this._iconManager.getReplaceableEntryRuntimes();

        for (const runtime of replaceable) {
            const consumed = this.consumeNextData();

            if (consumed === undefined) {
                throw new Error(
                    "Entry buffer runtime requires performance data.",
                );
            }

            const previousData = this._iconManager.rebindEntryRuntime(
                runtime,
                consumed.data,
            );
            this.onReelDataChanged?.(runtime, previousData);
        }

        this._iconManager.syncAllIcons();
    }

    /**
     * 每幀更新入口，由上層統一呼叫。
     *
     * Egret 沒有 Component 的 update()，因此沒有「自己更新」的模式；
     * 多軸時務必讓所有軸吃同一份 deltaTime，Turbo 同步停輪才成立。
     */
    public updateMovement(deltaTime: number): void {
        this.assertInitialized();
        assertNonNegativeFiniteNumber(deltaTime, "deltaTime");

        if (this.isActive()) {
            this._stopFlow.updateElapsed(deltaTime);
        }

        /*
         * 先推進上一幀已存在的效果，再推進 Reel Movement。
         * 本幀剛停止時，停止效果從下一幀才開始吃時間，
         * 避免同一份 deltaTime 被用兩次。
         */
        const effectWasActive =
            this._startEffect.active || this._stopEffect.active;

        let startEffectCompleted = false;

        if (this._startEffect.active) {
            startEffectCompleted = this._startEffect.update(deltaTime);
        }

        let stopEffectCompleted = false;

        if (this._stopEffect.active) {
            stopEffectCompleted = this._stopEffect.update(deltaTime);
        }

        if (effectWasActive) {
            this.syncVisualEffectOffset();
        }

        if (this._waitingForStartEffect && startEffectCompleted) {
            this._waitingForStartEffect = false;

            try {
                this.onStartEffectCompleted?.();
            } finally {
                this.beginFirstCellMovement();
            }
        }

        if (stopEffectCompleted) {
            this.syncVisualEffectOffset();
            this.onStopEffectCompleted?.();
        }

        this._movement.update(deltaTime);
    }

    /**
     * 排入一個完整 Cell 的移動。
     *
     * 拆成兩個半 Cell；只有第二個半格完成後才允許交接與停止判斷。
     * 移動距離永遠為正（軸向往退場方向遞增），方向由顯示映射處理。
     */
    public queueOneCellMovement(moveInterval: number): void {
        this.assertInitialized();
        assertPositiveFiniteNumber(moveInterval, "moveInterval");

        if (!this.isActive()) {
            throw new Error(
                "A Cell movement can only be queued while the reel is active.",
            );
        }

        if (!this._movement.isIdle) {
            throw new Error(
                "The previous Cell movement must complete before queuing another.",
            );
        }

        const halfCellDistance = this.cellPitch * 0.5;
        const halfCellDuration = moveInterval * 0.5;

        this._movement.moveBy(halfCellDistance, halfCellDuration);
        this._movement.addCallback(this._firstHalfCompleteHandler);
        this._movement.moveBy(halfCellDistance, halfCellDuration);
        this._movement.addCallback(this._secondHalfCompleteHandler);
    }

    /**
     * 本輪結果若已收到但尚未提交，在這個完整 Cell 邊界提交。
     *
     * 必須在 drainPendingHandoffs() 之前 —— commitResult() 會換掉
     * 資料列表尚未讀取的尾段，接著的回收才讀得到新資料。
     */
    private tryCommitResultAtBoundary(): void {
        if (
            !this._stopFlow.resultEntryPending
            || this._dataFlow.resultCommitted
        ) {
            return;
        }

        this._stopFlow.tryCommitResultAtHandoff(
            this._moveInterval,
            this.calculateResultEntryHalfCellCount(),
        );
    }

    /**
     * 把欠下的交接一次補完。
     *
     * 位置每幀更新，交接只在完整 Cell 邊界執行，所以這裡可能一次
     * 處理多格（低幀率時）。
     */
    private drainPendingHandoffs(): void {
        while (this._iconManager.pendingHandoffCount > 0) {
            this.handoffOneCell();
        }
    }

    /** 回收一格：取下一筆資料，把退場端那格搬回進場端並綁定。 */
    private handoffOneCell(): void {
        const consumed = this.consumeNextData();

        if (consumed === undefined) {
            /*
             * 資料耗盡不能阻止載體回收，否則退場端會堆積，
             * 下一輪也會缺少進場 buffer。
             */
            this._iconManager.recycleExitedCellKeepingData();
            return;
        }

        const { runtime, previousData } =
            this._iconManager.recycleExitedCell(
                consumed.data,
                consumed.resultSpinId,
            );
        this.onReelDataChanged?.(runtime, previousData);
    }

    private consumeNextData(): ReelConsumedData | undefined {
        return this._dataFlow.consumeNextData(
            this._performanceDataProvider,
            this._flowDataValidator,
            this._cellSpanResolver,
        );
    }

    /**
     * 正式結果從下一次交接起，還要幾個半 Cell 才能完整對齊。
     *
     * 與 calculateQuickStopHalfCellCount() 同一條算式，差別在於
     * 這裡是「結果即將排入佇列」的時點，前方尚未消耗的表演資料
     * 會被本次 commit 取代，因此不計入。
     */
    private calculateResultEntryHalfCellCount(): number {
        const travelCells =
            this._iconManager.firstVisibleIndex
            + this._iconManager.visibleCellCount;

        return travelCells * 2;
    }

    /**
     * 提交正式結果及必要尾段。
     *
     * `result` 使用畫面閱讀順序（與 Server 格式相同），長度必須等於
     * visibleCellCount；轉成進場順序由內部處理。
     */
    public commitResult(
        result: SymbolData[],
        requiredTail: SymbolData[] = [],
    ): void {
        this.assertInitialized();

        if (this._state !== ReelState.Rolling) {
            throw new Error(
                "Result can only be committed while the reel is rolling.",
            );
        }

        this._iconManager.validateResultData(result);

        for (const data of requiredTail) {
            this._iconManager.validateData(data, "requiredTail data");
        }

        this._stopFlow.receiveResult(
            result,
            requiredTail,
            this._movement.remainingDuration,
            this.resultEntryAtDisplayStart,
        );

        this._stopMode = ReelStopMode.ResultAligned;
        this.changeState(ReelState.Stopping);
    }

    /**
     * 只在完整 Cell 邊界呼叫。
     *
     * Immediate 優先完成即停；其他情況必須是 Stopping 且結果已對齊。
     */
    public tryCompleteStop(): boolean {
        if (this._state !== ReelState.Stopping) {
            return false;
        }

        if (this._stopMode === ReelStopMode.Immediate) {
            this.completeStop();
            return true;
        }

        if (
            this._stopMode !== ReelStopMode.ResultAligned
            || !this.isCommittedResultAligned()
        ) {
            return false;
        }

        this.completeStop();
        return true;
    }

    /** 正式結果是否已完整對齊顯示區。 */
    public isCommittedResultAligned(): boolean {
        const committed = this._dataFlow.committedResult;

        if (committed.length === 0) {
            return false;
        }

        const ordered = this.resultEntryAtDisplayStart
            ? committed
            : [...committed].reverse();

        return this._iconManager.isAligned(
            ordered,
            this._dataFlow.spinId,
        );
    }

    private completeStop(): void {
        this.changeState(ReelState.Stopped);

        /* 軸向往退場方向遞增，所以停止效果順著滾動往正向衝。 */
        if (
            this._stopMode === ReelStopMode.ResultAligned
            && this._stopEffect.start(1, this._effectTimeScale)
        ) {
            this.syncVisualEffectOffset();
            this.onStopEffectStarted?.();
        }

        try {
            this.onRollStopped?.(this._stopMode);
        } finally {
            this.resolveStopPromise();
        }
    }

    /** 合併啟動與停止效果的顯示偏移；Runtime 位置不受影響。 */
    private syncVisualEffectOffset(): void {
        this._iconManager.setVisualAxisOffset(
            this._startEffect.value + this._stopEffect.value,
        );
        this._iconManager.syncAllIcons();
    }

    // ───────────────── 急停與即停 ─────────────────
    /**
     * 玩家急停：只略過正式結果前尚未消耗的表演資料。
     *
     * 不修改速度、duration、easing 或 timeScale，也不影響已經進場的格子。
     */
    public requestQuickStop(): void {
        this.assertInitialized();

        if (!this._stopFlow.requestQuickStop()) {
            return;
        }

        if (this._dataFlow.resultCommitted) {
            this.applyQuickStopDataSkip();
        }
    }

    /**
     * 推算 Turbo QuickStop 的直接停止距離，單位為 half-Cell。
     *
     * 每格等寬之後這是純算術，不再需要逐半格預演：
     *
     * ```text
     * 還要走的完整 Cell 數
     *   = 結果之前尚未消耗的格數        （k）
     *   + 1                            （把結果第一格帶進 index 0）
     *   + firstVisibleIndex + visible - 1（從 index 0 推到顯示區最後一格）
     * ```
     *
     * 再乘 2 換成 half-Cell；若目前停在半格上（stripOffset > 0），
     * 當前這一格只剩一個半格要走，因此扣 1。
     */
    public calculateQuickStopHalfCellCount(): number {
        this.assertInitialized();

        const pendingBeforeResult =
            this._dataFlow.pendingCellCountBeforeResult();
        const travelCells =
            pendingBeforeResult
            + 1
            + this._iconManager.firstVisibleIndex
            + this._iconManager.visibleCellCount
            - 1;
        const halfCells = travelCells * 2;

        return this._iconManager.stripOffset > 0
            ? halfCells - 1
            : halfCells;
    }

    /** 套用控制層算出的 Turbo QuickStop 同步補牌。 */
    public applyQuickStopPadding(cellCount: number): void {
        this.assertInitialized();

        if (!Number.isInteger(cellCount) || cellCount < 0) {
            throw new Error(
                "QuickStop padding must be a non-negative integer.",
            );
        }

        if (this._dataFlow.resultCommitted) {
            const inserted =
                this._dataFlow.insertPerformanceCellsBeforeResult(
                    cellCount,
                    this._cellSpanResolver,
                    this._performanceDataProvider,
                    this._flowDataValidator,
                );
            this._stopFlow.applyQuickStopPadding(
                inserted,
                this._moveInterval,
            );
            return;
        }

        this._stopFlow.setQuickStopPerformanceCellBudget(cellCount);
    }

    private applyQuickStopDataSkip(): void {
        const skipped = this._dataFlow.skipPendingPerformanceData();
        this._stopFlow.applyQuickStopSkip(skipped, this._moveInterval);
    }

    /**
     * 請求 Immediate 即停：完成當前完整 Cell 後停止。
     *
     * 不要求正式結果對齊，也不等於玩家急停。
     */
    public requestImmediateStop(): void {
        this.assertInitialized();

        if (!this.isActive()) {
            throw new Error(
                "Immediate stop can only be requested while the reel is active.",
            );
        }

        this._stopMode = ReelStopMode.Immediate;

        if (this._state === ReelState.Rolling) {
            this.changeState(ReelState.Stopping);
        }

        if (this._waitingForStartEffect) {
            this._waitingForStartEffect = false;
            this._startEffect.reset();
            this.syncVisualEffectOffset();
        }

        if (this._movement.isIdle) {
            this.tryCompleteStop();
        }
    }

    // ───────────────── 查詢 ─────────────────
    public get inited(): boolean {
        return this._inited;
    }

    public get state(): ReelState {
        return this._state;
    }

    public get stopMode(): ReelStopMode {
        return this._stopMode;
    }

    public get visibleCellCount(): number {
        return this._iconManager.visibleCellCount;
    }

    public get maxCellSpan(): number {
        return this._iconManager.maxCellSpan;
    }

    public get stripCellCount(): number {
        return this._iconManager.stripCellCount;
    }

    public get cellPitch(): number {
        return this._iconManager.cellPitch;
    }

    public get movement(): BaseMovement {
        return this._movement;
    }

    public get moveInterval(): number {
        return this._moveInterval;
    }

    /** 目前是否仍在播放停止效果。 */
    public get stopEffectActive(): boolean {
        return this._stopEffect.active;
    }

    /**
     * 停止效果播完需要的總秒數（外移 + 回復）。
     *
     * 遊戲層排時間軸時需要它 —— 例如中獎表演要等停止效果結束才進場。
     * 未啟用時為 0。不含 effectTimeScale 的縮放。
     */
    public get stopEffectDuration(): number {
        return this._stopEffect.totalDuration;
    }

    /** 從本次 startRoll() 起累積的秒數。 */
    public get elapsedRollTime(): number {
        return this._stopFlow.elapsedRollTime;
    }

    /** 本輪 Server 結果送入時建立的停止計畫。 */
    public get lastStopPlan(): ReelStopPlan | undefined {
        return this._stopFlow.lastStopPlan;
    }

    /**
     * 公開底層資料列表，保留給繼承類別與特殊企劃流程。
     *
     * 一般流程請優先使用 setPerformanceDataBank()／appendPerformanceData()
     * ／commitResult()。直接操作會改變正式結果邊界與時間計算的前提。
     */
    public get dataList(): ReelDataList {
        return this._dataFlow.dataList;
    }

    /** 內部順序固定為「進場端 → 退場端」。 */
    public get symbols(): ReelSymbolRuntime[] {
        return this._iconManager.symbols;
    }

    /**
     * 顯示區第一格在 symbols／icons 中的索引。
     *
     * 恆等於 maxCellSpan（進場 buffer 的長度）。有了它，遊戲層拿到
     * symbols 或 icons 之後才切得出可視段。
     */
    public get firstVisibleIndex(): number {
        return this._iconManager.firstVisibleIndex;
    }

    /** 顯示區逐 Cell 的 Runtime，順序同 symbols（進場端 → 退場端）。 */
    public getVisibleRuntimes(): ReelSymbolRuntime[] {
        return this._iconManager.getVisibleRuntimes();
    }

    /**
     * 整條 strip 的 Icon，索引與 symbols 一一對應。
     *
     * 中獎表演需要它 —— 由 symbols[k].groupOffset 判斷 head，再從
     * icons[k] 取得對應的顯示物件。回傳的是內部陣列本身，請勿增刪。
     */
    public get icons(): BaseReelIcon[] {
        return this._iconManager.icons;
    }

    /** 正式結果是否由畫面閱讀順序的開頭側進場。 */
    public get resultEntryAtDisplayStart(): boolean {
        return this._iconManager.resultEntryAtDisplayStart;
    }

    /** 回傳目前顯示區由進場端到退場端的逐 Cell Symbol ID。 */
    public getVisibleCellSymbolIds(): number[] {
        const ids = this._iconManager.getVisibleCellSymbolIds();
        return this.resultEntryAtDisplayStart ? ids : ids.reverse();
    }

    // ───────────────── 等待、重設與釋放 ─────────────────
    /** 等待本軸真正進入 Stopped。 */
    public async waitForStoppedAsync(): Promise<void> {
        this.assertInitialized();

        if (this._state === ReelState.Stopped) {
            return;
        }

        if (!this.isActive()) {
            throw new Error(
                "waitForStoppedAsync() requires an active reel.",
            );
        }

        if (this._stopPromise === undefined) {
            this._stopPromise = new Promise<void>((resolve) => {
                this._resolveStopPromise = resolve;
            });
        }

        await this._stopPromise;
    }

    private resolveStopPromise(): void {
        const resolve = this._resolveStopPromise;
        this._resolveStopPromise = undefined;
        this._stopPromise = undefined;
        resolve?.();
    }

    private resetMovement(): void {
        this._movement.clear();
        this._movement.setValue(0);
        this._iconManager.resetMovement();
    }

    private resetSpinData(): void {
        this.resolveStopPromise();
        this._startEffect.reset();
        this._dataFlow.beginSpin();
        this._stopFlow.beginSpin();
        this._waitingForStartEffect = false;
    }

    private resetRuntimeData(): void {
        this.resolveStopPromise();
        this._startEffect.reset();
        this._stopEffect.reset();
        this._movement.clear();
        this._dataFlow.cleanup();
        this._stopFlow.cleanup();
        this._waitingForStartEffect = false;
    }

    /**
     * 釋放本實例持有的執行期資料與 Callback。
     *
     * 不可當成每輪 Spin 的 reset 使用。呼叫後必須重新 init()。
     */
    public cleanup(): void {
        this._movement.clear();
        this._movement.onValueChanged = undefined;
        this._movement.onCommandComplete = undefined;
        this._movement.onQueueComplete = undefined;
        this._movement.setValue(0);
        this.resolveStopPromise();
        this._startEffect.cleanup();
        this._stopEffect.cleanup();

        this._dataFlow.cleanup();
        this._stopFlow.cleanup();
        this._iconManager.cleanup();

        this.onHalfCellComplete = undefined;
        this.onCellMovementComplete = undefined;
        this.onRollStarted = undefined;
        this.onRollStopped = undefined;
        this.onStopEffectStarted = undefined;
        this.onStopEffectCompleted = undefined;
        this.onStartEffectCompleted = undefined;
        this.onReelDataChanged = undefined;

        this._waitingForStartEffect = false;
        this._stopPromise = undefined;
        this._resolveStopPromise = undefined;
        this._state = ReelState.Idle;
        this._stopMode = ReelStopMode.ResultAligned;
        this._moveInterval = 0;
        this._inited = false;
    }

    // ───────────────── 零件 ─────────────────
    private isActive(): boolean {
        return this._state === ReelState.Rolling
            || this._state === ReelState.Stopping;
    }

    private assertInitialized(): void {
        if (!this._inited) {
            throw new Error("BaseReel.init() must be called first.");
        }
    }

    /** 狀態轉換保持明確；停止策略由 ReelStopMode 表示，不塞進 State。 */
    private changeState(nextState: ReelState): void {
        if (this._state === nextState) {
            return;
        }

        let allowed = false;

        switch (this._state) {
            case ReelState.Idle:
                allowed = nextState === ReelState.Rolling;
                break;

            case ReelState.Rolling:
                allowed = nextState === ReelState.Stopping;
                break;

            case ReelState.Stopping:
                allowed = nextState === ReelState.Stopped;
                break;

            case ReelState.Stopped:
                allowed = nextState === ReelState.Idle
                    || nextState === ReelState.Rolling;
                break;
        }

        if (!allowed) {
            throw new Error(
                `Invalid reel state transition: ${this._state} -> ${nextState}.`,
            );
        }

        this._state = nextState;
    }
}
