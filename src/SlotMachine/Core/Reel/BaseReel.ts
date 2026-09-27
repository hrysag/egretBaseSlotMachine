import { BaseReelIcon } from "./BaseReelIcon";
import {
    BaseReelConfig,
    ReelIconDisplayConfig,
} from "./Config/ReelConfig";
import { ReelIconDirection } from "./Config/ReelIconDirection";
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

export {
    ReelIconCell,
    ReelIconLayout,
    ReelLayoutSource,
    ReelSymbolRuntime,
} from "./Data/ReelData";
export { ReelIconDirection } from "./Config/ReelIconDirection";
export { SymbolData, SymbolVisualSize } from "./Data/SymbolData";
export { ReelSymbolCellDefinition } from "./Data/ReelSymbolRegistry";
export { ReelExpediteReason } from "./Runtime/ReelStopPlan";
export { ReelStopPlan, ReelStopPlanInput } from "./Runtime/ReelStopPlan";

/**
 * 可直接使用、也允許遊戲端繼承的單軸 Reel。
 *
 * ## 與 Cocos 版的三個結構差異
 *
 * 1. **自己就是顯示節點。** Cocos 的 `Component` 是被 `new` 出來再由
 *    外部塞 `node`，載體是 Node 不是 Component；Egret 把兩者合一，
 *    所以本類別直接 `extends eui.Component`，Icon 空殼掛在 `this`
 *    底下 —— 對應 Cocos 版 `iconContainer` 預設值就是 `this.node`。
 *    沒有對應物的只有「掛在節點上的腳本」這一面：`update()` 不存在，
 *    每幀由 `BaseSlotMachine` 統一呼叫 `updateMovement(deltaTime)`，
 *    Cocos 版的 `ReelUpdateMode.Self` 已移除。
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
export class BaseReel extends eui.Component {
    /**
     * 每格自我修正最多把本格時間拉長多少（決議 45，ε = +25%）。
     *
     * 只拉長不壓短：碰到上限時補不完的部分就放著，結果是稍微早停，
     * 等於局部退回「每格恆為 moveInterval」。驗算中每格拉長中位數約 1%、
     * 最大 20%（聽牌切速後剩餘格數少時），+25% 從未觸發。
     */
    public static readonly MAX_CELL_STRETCH = 0.25;

    private _inited = false;

    private _moveInterval = 0;

    private _effectTimeScale = 1;

    private readonly _movement = new BaseMovement();

    private readonly _startEffect = new ReelAxisEffect();

    private readonly _stopEffect = new ReelAxisEffect();

    private readonly _iconManager = new ReelIconManager();

    /**
     * Icon 的直接容器。
     *
     * 刻意**不用 BaseReel 自己**當容器：eui 系的容器會在每次子項增刪時
     * 強制 `invalidateSize()` + `invalidateDisplayList()`
     * （`UIComponent.ts` 的 implementUIComponent，`eui.Component` 與
     * `eui.Group` 都是 isContainer = true），而 `setChildIndex()` 會
     * 同時觸發兩者 —— displayPriority 重排正是靠它。
     *
     * 普通 `DisplayObjectContainer` 的同名方法是空實作，所以把 Icon 收在
     * 這一層之後，重排不再產生任何測量。這一層只在建立時加一次，
     * 之後不動；mask 仍然設在 BaseReel（或機台）上，照樣夾住整棵子樹。
     */
    private _iconLayer?: egret.DisplayObjectContainer;

    private readonly _dataFlow = new ReelDataFlow();

    private readonly _symbolRegistry = new ReelSymbolRegistry();

    private _waitingForStartEffect = false;

    /** 本輪已走完的完整 Cell 數；聽牌切速的邊界以此計（決議 42）。 */
    private _completedCellCount = 0;

    /**
     * 聽牌預定切速：走完第 `afterCellCount` 格時把 moveInterval 換成
     * `moveInterval`（決議 42）。`switchAtSeconds` 是那個邊界的時刻，
     * `planRescaled` 記錄停輪計畫是否已換算成切速後的真實時間。
     */
    private _scheduledSpeedChange?: {
        afterCellCount: number;
        moveInterval: number;
        switchAtSeconds: number;
        /** 聽牌真實結束時刻；切速後的自我修正以它為目標（決議 45）。 */
        stopSeconds: number;
        speedMultiplier: number;
        planRescaled: boolean;
    };

    /**
     * 本格的開始時刻與本格時間，以**本軸連續時間**計（決議 45）。
     *
     * 與 `elapsedRollTime` 不同：後者每幀開頭就吃掉整幀，Cell 邊界卻多半
     * 落在幀中間，所以邊界上讀 elapsed 最多領先一幀。這裡逐格累加
     * Movement 實際走的時間，邊界上就是精確時刻。
     */
    private _cellStartTime = 0;

    private _cellDuration = 0;

    /** 結果提交後到停輪還要走的 Cell 數，每個邊界遞減（決議 45）。 */
    private _cellsUntilStop?: number;

    /** 自我修正的停輪目標；聽牌軸是聽牌真實結束時刻（決議 45）。 */
    private _correctionTarget?: number;

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
        if (this.onHalfCellComplete !== undefined) {
            this.onHalfCellComplete(1);
        }
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
        this._cellStartTime += this._cellDuration;
        if (this._cellsUntilStop !== undefined) {
            this._cellsUntilStop--;
        }

        this.tryCommitResultAtBoundary();
        this.drainPendingHandoffs();
        if (this.onHalfCellComplete !== undefined) {
            this.onHalfCellComplete(2);
        }
        if (this.onCellMovementComplete !== undefined) {
            this.onCellMovementComplete();
        }

        this._completedCellCount++;
        this.applyScheduledSpeedChange();

        if (!this.tryCompleteStop()) {
            this.queueOneCellMovement(this.calculateNextCellDuration());
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

        const cellSpacing = config.cellSpacing !== undefined
            ? config.cellSpacing
            : 0;
        const alignmentEpsilon = config.alignmentEpsilon !== undefined
            ? config.alignmentEpsilon
            : 0.0001;
        const maxCellSpan = config.maxCellSpan !== undefined
            ? config.maxCellSpan
            : this._symbolRegistry.getMaxCellSpan();

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

        this._moveInterval = config.moveInterval !== undefined
            ? config.moveInterval
            : 0;
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

    /**
     * 用 config 的建構器建立 Icon 載體，並掛到自己底下。
     *
     * 載體數量固定 = `stripCellCount`，建立後滾動期不再增刪；
     * 美術是載體另外接收的東西，不從這裡進來。
     * 必須在 `setInitialLayout()` 之後呼叫 —— 目前的建立迴圈跑的是
     * 已展開的 strip 長度。
     */
    public configureIconDisplay(config: ReelIconDisplayConfig): void {
        this.assertInitialized();

        if (this.isActive()) {
            throw new Error(
                "Icon display cannot be changed while the reel is active.",
            );
        }

        if (this._iconLayer === undefined) {
            this._iconLayer = new egret.DisplayObjectContainer();
            this.addChild(this._iconLayer);
        }

        this._iconManager.initializeIcons(
            this._iconLayer,
            config.iconFactory,
        );
    }

    /** 移除 Icon 空殼，保留純數值 strip。 */
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
            this.beginFirstCellMovement(this._stopFlow.elapsedRollTime);
        }
    }

    /**
     * @param cellStartTime 第一格的開始時刻（本軸連續時間）。從 startRoll()
     *   進來是 0；啟動效果播完才進來時是**效果結束的那一刻** —— 同一幀稍後
     *   Movement 只吃效果結束後剩下的時間（見 updateMovement()）。
     */
    private beginFirstCellMovement(cellStartTime: number): void {
        this._cellStartTime = cellStartTime;
        this.queueOneCellMovement(this.calculateNextCellDuration());
        if (this.onRollStarted !== undefined) {
            this.onRollStarted();
        }
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

        /*
         * **必須從退場端往進場端綁**（也就是把 getReplaceableEntryRuntimes()
         * 的回傳倒過來走）。兩個理由，缺一不可：
         *
         * 1. rebindEntryRuntime() 依 _symbols[index + 1]（朝退場方向的鄰居）
         *    推導 groupOffset。由外往內綁時那個鄰居還是上一輪的舊資料，
         *    推出來的 offset 無效 —— 實測會產生 [1/0, 62/1, 62/1] 這種
         *    「兩個 follower 都沒有 head」的組，該格永遠不繪製，
         *    捲進顯示區就是一個空格。
         *
         * 2. 正常交接是每格塞進 index 0、把既有的往退場端推，所以**先消耗
         *    的資料本來就該落在較靠退場端的格**。倒著綁才與交接順序一致。
         */
        for (let i = replaceable.length - 1; i >= 0; i--) {
            const runtime = replaceable[i];
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
            if (this.onReelDataChanged !== undefined) {
                this.onReelDataChanged(runtime, previousData);
            }
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
        let startEffectRemaining = 0;

        if (this._startEffect.active) {
            startEffectRemaining = this._startEffect.remainingDuration;
            startEffectCompleted = this._startEffect.update(deltaTime);
        }

        /*
         * 啟動效果在本幀播完時，第一格只吃「效果結束之後」剩下的時間。
         * 以前第一格吃整幀，效果用過的那段又被 Movement 用一次，第一格
         * 起點落在幀頭 —— 比效果結束早、早多少取決於幀長，事先推算不出來
         * （資料在啟動效果中送到時，停輪推算因此最多差一幀）。
         */
        let movementDeltaTime = deltaTime;

        let stopEffectCompleted = false;

        if (this._stopEffect.active) {
            stopEffectCompleted = this._stopEffect.update(deltaTime);
        }

        if (effectWasActive) {
            this.syncVisualEffectOffset();
        }

        if (this._waitingForStartEffect && startEffectCompleted) {
            this._waitingForStartEffect = false;
            movementDeltaTime = Math.max(0, deltaTime - startEffectRemaining);

            try {
                if (this.onStartEffectCompleted !== undefined) {
                    this.onStartEffectCompleted();
                }
            } finally {
                this.beginFirstCellMovement(
                    this._stopFlow.elapsedRollTime - movementDeltaTime,
                );
            }
        }

        if (stopEffectCompleted) {
            this.syncVisualEffectOffset();
            if (this.onStopEffectCompleted !== undefined) {
                this.onStopEffectCompleted();
            }
        }

        this._movement.update(movementDeltaTime);
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

        this._cellDuration = moveInterval;

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

        const now = this._cellStartTime;
        const cellsUntilStop = this._stopFlow.tryCommitResultAtHandoff(
            this._moveInterval,
            this.calculateResultEntryHalfCellCount(),
            this.dissolveIncompleteEntryGroup(),
            now,
            this.countCellsBeforeTarget(now),
        );

        if (cellsUntilStop === undefined) {
            return;
        }

        const change = this._scheduledSpeedChange;

        this._cellsUntilStop = cellsUntilStop;
        this._correctionTarget = change !== undefined
            ? change.stopSeconds
            : this._stopFlow.targetStopTime;

        /* 格數以原速換算；計畫裡切速點之後那段縮回真實時間（僅供除錯）。 */
        if (change !== undefined && !change.planRescaled) {
            this._stopFlow.rescaleStopPlanAfter(
                change.switchAtSeconds,
                1 / change.speedMultiplier,
            );
            change.planRescaled = true;
        }

        this.retimeStopPlanForCorrection(now);
    }

    /**
     * 從這個邊界起、到停輪目標為止放得下幾個完整 Cell（決議 45）。
     *
     * 取 floor：每格只會被拉長，所以格數寧少勿多 —— 多一格就一定晚停。
     *
     * 有預定切速時分兩段算：切速前照原速數到切速邊界，切速後以聽牌速度
     * 數到聽牌真實結束。切速前那幾格由自我修正對準切速邊界，所以切速後
     * 那段從 `switchAtSeconds` 起算不會晚。
     */
    private countCellsBeforeTarget(now: number): number {
        const change = this._scheduledSpeedChange;

        if (change !== undefined) {
            const cellsBeforeSwitch = Math.max(
                0,
                change.afterCellCount - (this._completedCellCount + 1),
            );
            const cellsAfterSwitch = Math.max(
                0,
                Math.floor(
                    (change.stopSeconds - change.switchAtSeconds)
                    / change.moveInterval
                    + 1e-9,
                ),
            );

            return cellsBeforeSwitch + cellsAfterSwitch;
        }

        const target = this._stopFlow.targetStopTime;

        if (target === undefined) {
            return 0;
        }

        return Math.max(
            0,
            Math.floor((target - now) / this._moveInterval + 1e-9),
        );
    }

    /**
     * 下一格要走多久：每格邊界自我修正（決議 45）。
     *
     * ```text
     * 本格時間 = clamp((目標 − 現在) / 剩餘格數, 原速, 原速 × (1 + ε))
     * ```
     *
     * - 有預定切速：目標是切速邊界，剩餘格數數到切速那一格
     * - 已提交結果：目標是停輪目標（聽牌軸為聽牌真實結束），剩餘格數數到停輪
     * - 其餘（還沒下達停止）：原速
     *
     * 急停與即停之後不修正，**依照當下速度**走完 —— 決議 43 依序補牌以
     * 原速推算剩餘秒數，修正若還在動，推算就錯。
     */
    private calculateNextCellDuration(): number {
        const base = this._moveInterval;

        if (
            this._stopFlow.quickStopRequested
            || this._stopMode === ReelStopMode.Immediate
        ) {
            return base;
        }

        const change = this._scheduledSpeedChange;
        let target: number;
        let cellCount: number;

        if (change !== undefined) {
            target = change.switchAtSeconds;
            cellCount = change.afterCellCount - this._completedCellCount;
        } else if (
            this._cellsUntilStop !== undefined
            && this._correctionTarget !== undefined
        ) {
            target = this._correctionTarget;
            cellCount = this._cellsUntilStop;
        } else {
            return base;
        }

        if (cellCount <= 0) {
            return base;
        }

        const ideal = (target - this._cellStartTime) / cellCount;

        return Math.min(
            base * (1 + BaseReel.MAX_CELL_STRETCH),
            Math.max(base, ideal),
        );
    }

    /**
     * 停輪計畫改成自我修正預計達到的時刻（僅供除錯；決議 45）。
     *
     * 提交時算的是「每格原速」的格線時刻；目標比它晚時，修正會把剩下的
     * 格子拉長去對準目標，最多拉到 ε。
     */
    private retimeStopPlanForCorrection(now: number): void {
        const plan = this._stopFlow.lastStopPlan;
        const target = this._correctionTarget;

        if (
            plan === undefined
            || target === undefined
            || this._stopFlow.quickStopRequested
            || target <= plan.actualStopTime
        ) {
            return;
        }

        const reachable = now
            + (plan.actualStopTime - now) * (1 + BaseReel.MAX_CELL_STRETCH);

        this._stopFlow.retimeStopPlan(Math.min(target, reachable));
    }

    /**
     * 聽牌：在「不晚於 listenStartSeconds 的最後一個 Cell 邊界」切成
     * `moveInterval / speedMultiplier`，並讓停輪落在 listenStopSeconds
     * （時間皆為本軸 elapsedRollTime；決議 42）。
     *
     * 必須在 commitResult() 之前呼叫 —— 結果寫進佇列時才以目標時間換算
     * 表演格數。格數照**原速**換算，所以目標要換成原速下的等效時間：
     *
     * ```text
     * b      = 切速邊界
     * 目標   = b + (listenStop − b) × speedMultiplier
     * ```
     *
     * 切速點用本軸自己的格邊界推算（當前這格剩下的時間，或啟動效果剩下
     * 的時間 + 一格），不假設從 0 起每格一個 moveInterval。切速在規劃時
     * 就定好，不靠前一軸停下的事件 —— 事件觸發會晚到下一格才生效，
     * 可能晚停（驗算 148 組真晚停）。
     */
    public planListenSpeedUp(
        listenStartSeconds: number,
        listenStopSeconds: number,
        speedMultiplier: number,
    ): void {
        this.assertInitialized();

        if (!this.isActive() || this._dataFlow.resultCommitted) {
            throw new Error(
                "Listen speed can only be planned while the reel is active and before the result is committed.",
            );
        }

        this._scheduledSpeedChange = undefined;

        if (speedMultiplier === 1 || listenStopSeconds <= listenStartSeconds) {
            this._stopFlow.setTargetStopTime(listenStopSeconds);
            return;
        }

        const moveInterval = this._moveInterval;
        const nextBoundary = this._waitingForStartEffect
            ? this._stopFlow.elapsedRollTime
                + this._startEffect.remainingDuration
                + moveInterval
            : this._cellStartTime + this._cellDuration;
        const extraCells = Math.max(
            0,
            Math.floor((listenStartSeconds - nextBoundary) / moveInterval + 1e-9),
        );
        const switchAtSeconds = nextBoundary + extraCells * moveInterval;

        /* 聽牌在第一個可切速的邊界之前就結束：本軸走不到切速，照普通軸停。 */
        if (listenStopSeconds <= switchAtSeconds) {
            this._stopFlow.setTargetStopTime(listenStopSeconds);
            return;
        }

        this._scheduledSpeedChange = {
            afterCellCount: this._completedCellCount + 1 + extraCells,
            moveInterval: moveInterval / speedMultiplier,
            switchAtSeconds,
            stopSeconds: listenStopSeconds,
            speedMultiplier,
            planRescaled: false,
        };
        this._stopFlow.setTargetStopTime(
            switchAtSeconds
            + (listenStopSeconds - switchAtSeconds) * speedMultiplier,
        );
    }

    /** 走到預定的切速邊界就換速度（決議 42）。 */
    private applyScheduledSpeedChange(): void {
        const change = this._scheduledSpeedChange;

        if (
            change === undefined
            || this._completedCellCount < change.afterCellCount
        ) {
            return;
        }

        this._scheduledSpeedChange = undefined;
        this._moveInterval = change.moveInterval;
    }

    /**
     * 急停／即停時取消尚未發生的切速：**依照當下速度**走完（決議 42）。
     *
     * 已切過的不在這裡（_scheduledSpeedChange 已清空），速度維持。
     * 這也是決議 43 依序補牌的前提 —— 它以當下的 moveInterval 推算剩餘
     * 秒數，急停後速度不能再變。
     */
    private cancelScheduledSpeedChange(): void {
        const change = this._scheduledSpeedChange;

        if (change === undefined) {
            return;
        }

        if (change.planRescaled) {
            this._stopFlow.rescaleStopPlanAfter(
                change.switchAtSeconds,
                change.speedMultiplier,
            );
        }

        this._scheduledSpeedChange = undefined;
    }

    /**
     * 提交結果前，把進場端沒湊滿的那組拆成 1×1。
     *
     * 表演牌若是大 Symbol，結果提交的當下它可能只進場了一部分。那組的
     * head 還沒進來，而正式結果的第一格入列時 `resolveGroupOffset()`
     * 只比對「同 id 且 offset > 0」，同一張牌就會被接進那組裡，整批
     * groupOffset 跟著錯位（可視區會看到兩組大 Symbol 的碎片）。
     *
     * 拆而不是補完，理由是時間：補完要多跑最多 `maxCellSpan - 1` 格，
     * 而且那幾格繞過 `performanceCellBudget`，急停時停輪時間會失準；
     * 補完還會把那張本該丟掉的表演牌救活，讓同一張大 Symbol 連出兩次。
     * 拆掉不花任何行程，而且那幾格必定還在進場 buffer 內，沒人看過。
     *
     * @returns 該組仍留在資料佇列裡的未讀格數，由 commitResult() 一併丟棄
     */
    private dissolveIncompleteEntryGroup(): number {
        const pendingCellCount =
            this._iconManager.incompleteEntryGroupPendingCellCount;

        if (pendingCellCount === 0) {
            return 0;
        }

        const filler = this._dataFlow.takeSingleCellPerformanceSymbol(
            this._cellSpanResolver,
            this._performanceDataProvider,
            this._flowDataValidator,
        );

        if (filler === undefined) {
            throw new Error(
                "Dissolving an incomplete entry group requires "
                + "at least one 1x1 performance Symbol.",
            );
        }

        this._iconManager.dissolveIncompleteEntryGroup(filler);
        return pendingCellCount;
    }

    /**
     * 把欠下的交接一次補完。
     *
     * 位置每幀更新，交接只在完整 Cell 邊界執行，所以這裡可能一次
     * 處理多格（低幀率時）。
     */
    private drainPendingHandoffs(): void {
        let handedOff = false;

        while (this._iconManager.pendingHandoffCount > 0) {
            this.handoffOneCell();
            handedOff = true;
        }

        /*
         * 交接只輪轉陣列（資料與 Icon 一起轉），要 syncAllIcons() 才會把
         * 新位置與進場那一格的新資料反映到 Icon 上。
         *
         * 滾動期原本靠下一幀的 onValueChanged 補上，但**最後一次交接
         * 之後沒有下一幀** —— 少了這裡，停止畫面會永遠停在交接前的狀態：
         * head 不顯示、follower 反而顯示，且 head 的圖高度停留在上一張
         * Symbol 的 cellSpan。階段 9a 在瀏覽器實測到這個現象。
         *
         * 滾動期也一樣受益：每個 Cell 邊界少掉一幀的錯誤畫面。
         */
        if (handedOff) {
            this._iconManager.syncAllIcons();
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
        if (this.onReelDataChanged !== undefined) {
            this.onReelDataChanged(runtime, previousData);
        }
    }

    private consumeNextData(): ReelConsumedData | undefined {
        return this._dataFlow.consumeNextData(
            this._performanceDataProvider,
            this._flowDataValidator,
            this._cellSpanResolver,
        );
    }

    /**
     * 正式結果從本次 commit 邊界起，還要**經過**幾個半 Cell 才會對齊。
     *
     * 回傳的是**時間**（半 Cell 數），不是交接次數 —— 兩者差一。
     * 結果的第一格要從 idx0 走到可視段最外格，共需
     * `firstVisibleIndex + visibleCellCount` 次交接；但其中**第一次與
     * commit 同刻發生**（`_secondHalfCompleteHandler` 是
     * `tryCommitResultAtBoundary()` 緊接 `drainPendingHandoffs()`），
     * 不佔用時間，所以只跨過 `次數 - 1` 個 moveInterval。
     *
     * 呼叫端 `ReelStopFlow.tryCommitResultAtHandoff()` 兩個用途都是時間：
     * `directResultStopTime` 直接乘 halfCellDuration，
     * `performanceCellBudget` 由剩餘時間扣掉它再折成整數格。
     * 所以這裡回傳時間語意，一處改好兩邊都正確。
     *
     * > 少減這個 1 會讓 earliestStopTime 晚報一格、表演牌少補一格，
     * > 實際停輪因而比要求的時間早約一格。252 組參數組合實測，
     * > 差距固定為一個 moveInterval，與 maxCellSpan／可視格數／
     * > moveInterval／目標時間都無關。
     */
    private calculateResultEntryHalfCellCount(): number {
        const handoffCells =
            this._iconManager.firstVisibleIndex
            + this._iconManager.visibleCellCount;

        return (handoffCells - 1) * 2;
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
            if (this.onStopEffectStarted !== undefined) {
                this.onStopEffectStarted();
            }
        }

        try {
            if (this.onRollStopped !== undefined) {
                this.onRollStopped(this._stopMode);
            }
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

        this.cancelScheduledSpeedChange();

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
     *   + 結果尚未提交時會墊在它前面的格數（退場端截斷的鏡像補格）
     * ```
     *
     * 再乘 2 換成 half-Cell；若目前停在半格上（stripOffset > 0），
     * 當前這一格只剩一個半格要走，因此扣 1。
     *
     * ## 最後一項為什麼非加不可
     *
     * Turbo 同步補牌在 `BaseSlotMachine.stopSpin()` 內、`commitResult()`
     * 之後立刻決定，而那時結果還沒寫進佇列（見
     * [Core-Runtime-Flow.md](../../../../doc/Core-Runtime-Flow.md) §1.1）。
     * 少了這一項，退場端截斷要墊幾格就看不見 —— 各軸墊的數量不同時
     * 補牌會算成 0，Turbo 根本不同步。
     *
     * 實測 360 組（maxCellSpan 3/4 × 可視 3/4/5 × 各 10 種盤面 ×
     * moveInterval 3 種 × quickStop 時機 2 種）：加上這一項之前，誤差
     * **精確等於墊格數**（墊 0/1/2 → 誤差 0/1/2 格）；加上之後殘差只
     * 剩次格量化，而且**與盤面無關、只隨相位變動** —— fastMode 各軸
     * 同時啟動且 moveInterval 相同（由 `assertUniformMoveInterval()`
     * 守門），殘差因此各軸一致，相減即歸零。
     */
    public calculateQuickStopHalfCellCount(): number {
        this.assertInitialized();

        const pendingBeforeResult =
            this._dataFlow.pendingCellCountBeforeResultBody();
        const travelCells =
            pendingBeforeResult
            + 1
            + this._iconManager.firstVisibleIndex
            + this._iconManager.visibleCellCount
            - 1
            + this._stopFlow.pendingExitTruncationCellCount;
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

    /**
     * 急停之後還要幾秒才停（連續時間；決議 43 的依序補牌用）。
     *
     * ```text
     * 當前這格剩下的時間 +（剩下的交接次數 − 1）× moveInterval
     * ```
     *
     * **不用 `lastStopPlan.actualStopTime`**：它以 `elapsedRollTime` 計，
     * 而提交發生在幀中間的 Cell 邊界、elapsed 卻已吃掉整幀 —— 各軸領先
     * 真實邊界的量不同（0～1 幀），兩軸真實只差不到一幀時會分不出先後。
     *
     * 假設剩下的格子都用目前的 moveInterval；執行中改速度的路徑
     * （聽牌切速）若之後實作，要一併納入。
     */
    public calculateQuickStopRemainingSeconds(): number {
        this.assertInitialized();

        return this._movement.remainingDuration
            + (this.countHandoffsUntilStop() - 1) * this._moveInterval;
    }

    /**
     * 急停之後還要走幾個 half-Cell 才停（Turbo 同步補牌用）。
     *
     * 還能補格時就是 `calculateQuickStopHalfCellCount()`；結果已有格子進場、
     * 不能再補的軸改看 strip 位置（`countHandoffsUntilStop()`）—— 它縮不了，
     * 但要列入共同目標，其他軸才補得到跟它一起停。
     */
    public calculateQuickStopRemainingHalfCells(): number {
        this.assertInitialized();

        if (this.canApplyQuickStopPadding) {
            return this.calculateQuickStopHalfCellCount();
        }

        const halfCells = this.countHandoffsUntilStop() * 2;

        return this._iconManager.stripOffset > 0
            ? halfCells - 1
            : halfCells;
    }

    /**
     * 結果若現在送入，本軸最早能停在哪一刻（本軸時間）。
     *
     * 提交發生在下一個完整 Cell 邊界，之後結果要再走完進場距離：
     *
     * ```text
     * 下一個邊界 +（結果進場的交接次數 − 1 + 退場端墊格數）× moveInterval
     * ```
     *
     * 與 `ReelStopFlow.tryCommitResultAtHandoff()` 算 `directResultStopTime`
     * 是同一條式子，只是提前在送入結果之前算。機台據此在資料到達時就把
     * 各軸停輪排好（決議 47），不必等前一軸提交。
     *
     * 還在播啟動效果時，第一格從效果結束那一刻起算（見 updateMovement()），
     * 所以下一個邊界 = 現在 + 效果剩餘 + 一格，是精確值。
     */
    public projectEarliestStopTime(result: SymbolData[]): number {
        this.assertInitialized();

        if (!this.isActive()) {
            throw new Error(
                "Earliest stop time can only be projected while the reel is active.",
            );
        }

        const nextBoundary = this._waitingForStartEffect
            ? this._stopFlow.elapsedRollTime
                + this._startEffect.remainingDuration
                + this._moveInterval
            : this._cellStartTime + this._cellDuration;
        const exitPadCellCount = this._dataFlow.countExitTruncationCells(
            result,
            this.resultEntryAtDisplayStart,
            this._cellSpanResolver,
        );

        return nextBoundary
            + (
                this.calculateResultEntryHalfCellCount() / 2
                + exitPadCellCount
            ) * this._moveInterval;
    }

    /** 還能不能補表演格 —— 結果第一格已進場就不行（決議 43）。 */
    public get canApplyQuickStopPadding(): boolean {
        return this._dataFlow.canInsertBeforeResult;
    }

    /**
     * 到停輪為止還要交接幾次（含當前這格）。
     *
     * 結果還沒有任何一格進場時，就是 `calculateQuickStopHalfCellCount()`
     * 的行程 —— 提交前後都成立。
     *
     * 結果已有格子進場就改看 strip 位置：資料列表讀完之後
     * `ReelDataFlow.consumeNextData()` 直接回傳 `undefined`，`readIndex`
     * 不再前進，再用資料索引算會多算。最靠退場端的本輪結果格減掉退場端
     * 墊格，就是結果本體第一格；停輪條件是本體佔滿可視段，所以它還要走到
     * 可視段最後一格。墊格在停輪前都還在退場 buffer 裡（buffer = maxSpan
     * ≥ 墊格數），不會提早被推出 strip。
     */
    private countHandoffsUntilStop(): number {
        const symbols = this._iconManager.symbols;
        const spinId = this._dataFlow.spinId;
        let deepestResultIndex = -1;

        if (this._dataFlow.resultCommitted) {
            for (let index = 0; index < symbols.length; index++) {
                if (symbols[index].resultSpinId === spinId) {
                    deepestResultIndex = index;
                }
            }
        }

        if (deepestResultIndex < 0) {
            return Math.ceil(this.calculateQuickStopHalfCellCount() / 2);
        }

        const bodyHeadIndex =
            deepestResultIndex - this._dataFlow.resultExitPadCellCount;

        return this._iconManager.firstVisibleIndex
            + this._iconManager.visibleCellCount
            - 1
            - bodyHeadIndex;
    }

    /**
     * 結果已提交後急停：砍掉結果前還沒進場的表演格。
     *
     * 砍到的若包含一組大 Symbol 還沒進場的後半，已進場的前半會留在進場
     * buffer 裡湊不滿；接著進場的結果第一格若是同一張牌（例如退場端截斷的
     * 墊格），`resolveGroupOffset()` 會把它接進那半組，整批 groupOffset
     * 錯位、可視段出現沒有 head 的空格。與決議 30 同一件事 —— 那邊只在
     * 提交結果時拆，這裡在急停砍格時也要拆。
     *
     * 實測：測試場景設定、結果先到後急停、含截斷盤面，4,464 組中 152 組
     * 盤面錯（上一個 commit 就存在），補上之後 0 組。
     */
    private applyQuickStopDataSkip(): void {
        const skipped = this._dataFlow.skipPendingPerformanceData();

        if (skipped.skippedCellCount > 0) {
            this.dissolveIncompleteEntryGroup();
        }

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
        this.cancelScheduledSpeedChange();

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

    /**
     * 內部順序固定為「進場端 → 退場端」。
     *
     * ## 排錯時怎麼讀 `groupOffset`
     *
     * 逐格印出 `groupOffset` 是最快的診斷手段。讀法只有一條規則：
     * **每遇到一個 `0` 就是一組的開始，後面連著遞增的數字都是它的
     * follower**（`0,1,2` = 一張 1×3、`0,1` = 一張 1×2、單獨的 `0`
     * = 1×1 或只剩 head 的大牌，後者要配 id 才分得出來）。
     *
     * 可視段是 `firstVisibleIndex` 起算 `visibleCellCount` 格，
     * **必須自成完整的組**。可視段長成 `1,2,0` 這種形狀就是錯位：
     * 前兩格是 head 在顯示區外那組的 follower，第三格是另一組的 head。
     * follower 不畫圖，所以孤兒 follower 在畫面上是**空格**。
     *
     * 完整對照表與實例見
     * `doc/Slot-Base-Unit-Refactor-1x1.md` §2.2.1。
     */
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

    /**
     * 取得與指定 Runtime 同組的全部 Icon，依進場端 → 退場端排列。
     *
     * 大於一格的 Symbol 只有 head 畫圖，follower 什麼都不畫；中獎表演
     * 與掉落式要以整組為單位處理時由此取得。
     *
     * 回傳的是即時走訪的結果，**請勿保存** —— 下一次交接就會失效。
     * 一個 group 進場或出場途中會有格子還不在 strip 上，因此
     * **回傳格數可能少於該 Symbol 的 cellSpan**。要判斷 head 是否
     * 在其中，用 `BaseReelIcon.isGroupHead`。
     */
    public getGroupIcons(
        runtime: ReelSymbolRuntime,
    ): BaseReelIcon[] {
        return this._iconManager.getGroupIcons(runtime);
    }

    /**
     * 取得圖有出現在顯示區的 Icon，依**畫面閱讀順序**排列。
     *
     * 判準是「該 group 在可視段裡至少擁有一格」，回傳那一組的 head
     * —— 一個大 Symbol 只會出現一次，不會因為占三格就回三個載體。
     *
     * **與 `getVisibleRuntimes()` 不是同一件事。** 後者是可視段的每一格
     * （長度恆為 visibleCellCount），截斷盤面上其中幾格是不畫圖的
     * follower，而真正畫著圖的 head 反而在 buffer 裡、不在那份清單中。
     * 中獎表演要拿的是本方法。
     */
    public getVisibleIcons(): BaseReelIcon[] {
        const icons = this._iconManager.getVisibleIcons();
        return this.resultEntryAtDisplayStart ? icons : icons.reverse();
    }

    /**
     * 退場方向是否為局部座標的正向。
     *
     * Icon 的 head 要把大圖往退場方向延伸，但 `ReelIconLayout` 不帶
     * 方向，所以建立 Icon 的那一方要靠這個 getter 告訴它。
     *
     * **不要自己從 config 的 `inverseDirection` 推導** —— 那條等式
     * （`!inverseDirection`）是框架內部 `mapAxisToLocal()` 的慣例，
     * 複製出去就會變成第二份方向推導。`inverseDirection` 因此不對外暴露。
     */
    public get exitTowardPositiveAxis(): boolean {
        return this._iconManager.exitTowardPositiveAxis;
    }

    /** 排列軸向；Icon 要靠它決定大圖的長邊擺在哪一軸。 */
    public get layoutType(): ReelIconDirection {
        return this._iconManager.layoutType;
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
        if (resolve !== undefined) {
            resolve();
        }
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
        this._completedCellCount = 0;
        this._scheduledSpeedChange = undefined;
        this.resetCellClock();
    }

    private resetCellClock(): void {
        this._cellStartTime = 0;
        this._cellDuration = 0;
        this._cellsUntilStop = undefined;
        this._correctionTarget = undefined;
    }

    private resetRuntimeData(): void {
        this.resolveStopPromise();
        this._startEffect.reset();
        this._stopEffect.reset();
        this._movement.clear();
        this._dataFlow.cleanup();
        this._stopFlow.cleanup();
        this._waitingForStartEffect = false;
        this._completedCellCount = 0;
        this._scheduledSpeedChange = undefined;
        this.resetCellClock();
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
