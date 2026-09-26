import { BaseReel } from "../SlotMachine/Core/Reel/BaseReel";
import { ReelIconDirection } from "../SlotMachine/Core/Reel/Config/ReelIconDirection";
import { SymbolData } from "../SlotMachine/Core/Reel/Data/SymbolData";
import { ListenReelConfig } from "../SlotMachine/Core/SlotMachine/Config/SlotMachineSpinConfig";
import { TestSlotMachine } from "./TestSlotMachine";
import {
    symbolDataList,
    TEST_CELL_PITCH,
    TEST_COLUMN_WIDTH,
} from "./TestSymbolTable";

/**
 * 停輪時可以送出的盤面清單。
 *
 * 73 是 1×3、62 是 1×2，其餘為 1×1。**刻意讓大圖在多數盤面上是不完整的**
 * —— 一張 1×3 只要沒有正好填滿三格，就一定有格子落在顯示區外，而那正是
 * `groupOffset` 推導、兩端補格與 `getVisibleIcons()` 最容易出錯的地方。
 *
 * 陣列是**畫面閱讀順序**，長度等於 visibleCellCount。
 *
 * 多軸時各軸取**不同**的盤面（索引各自加上軸號），所以一次送出就能同時
 * 看到完整大圖、兩端截斷與純 1×1 三種情況，不必連按好幾輪。
 */
const RESULT_SCENARIOS: { label: string; ids: number[] }[] = [
    { label: "73,73,73  完整 1×3 填滿顯示區", ids: [73, 73, 73] },
    { label: "73,73,1   截在進場端：head 在進場 buffer，露三分之二", ids: [73, 73, 1] },
    { label: "73,1,1    截在進場端更深：只露最後一格", ids: [73, 1, 1] },
    { label: "1,73,73   截在退場端：尾巴在退場 buffer", ids: [1, 73, 73] },
    { label: "62,62,1   完整 1×2 靠前", ids: [62, 62, 1] },
    { label: "1,62,62   完整 1×2 靠後", ids: [1, 62, 62] },
    { label: "8,9,10    純 1×1 對照組", ids: [8, 9, 10] },
];

/**
 * 四個滾動方向。
 *
 * 「正／反」的語意由 `ReelIconDirection` 的 JSDoc 定義：垂直正向是
 * 上→下、水平正向是左→右。畫面閱讀順序一律從座標小的那一端開始，
 * 所以正向時進場端就是閱讀順序的開頭。
 */
const DIRECTIONS: {
    label: string;
    layoutType: ReelIconDirection;
    inverseDirection: boolean;
}[] = [
    {
        label: "垂直正向（上→下）",
        layoutType: ReelIconDirection.Vertical,
        inverseDirection: false,
    },
    {
        label: "垂直反向（下→上）",
        layoutType: ReelIconDirection.Vertical,
        inverseDirection: true,
    },
    {
        label: "水平正向（左→右）",
        layoutType: ReelIconDirection.Horizontal,
        inverseDirection: false,
    },
    {
        label: "水平反向（右→左）",
        layoutType: ReelIconDirection.Horizontal,
        inverseDirection: true,
    },
];

/**
 * 可切換的軸數。1 軸保留下來，是為了讓舊的單軸路徑仍然跑得到。
 *
 * 預設 5 軸。舞台只有 640 寬，5 軸（跨軸 832px）放不下，整台由
 * `_board` 依軸數與方向等比縮小（見 fitBoardScale()）。
 */
const REEL_COUNTS = [1, 3, 5];

/**
 * 模擬 Server 回應延遲（秒）：開始滾動後幾秒把正式結果送進來。
 *
 * 對應 Cocos 版 `TestSlotMachine.resultCommitDelay`。滾動的長短就由它決定：
 * 資料到了才開始進入停止，所以延後送就轉得久，速度不變。
 *
 * | 延遲 | 想看的 |
 * |---|---|
 * | 0.05 | **預設**，Cocos 參考場景的設定，結果幾乎立刻到 |
 * | 0.30 | 結果早到 |
 * | 1.00 | Cocos 腳本預設值 |
 * | 3 | 轉 3 秒資料才到，急停有時間按 |
 */
const SERVER_DELAYS = [0.05, 0.3, 1.0, 3];

/**
 * 每軸目標停輪秒數。
 *
 * `0.15` 是 Cocos 參考場景的值，低於所有模式的物理下限，所以三個模式都
 * 被鉗到各自下限（normal 0.40 / turbo 0.25 / L2 0.08），速度差直接看得出來。
 * `1.60` 是長版：高於下限，三個模式都轉滿 1.6 秒 —— 這時才看得到
 * 「表演牌補時間」（`perfCells`）與 `act ≈ req` 的量化精度。
 */
const TARGET_STOP_TIMES = [0.15, 1.6];

/**
 * 聽牌設定（決議 42／45）。每輪開始時以 `setListenReels()` 送入。
 *
 * 取自 Cocos 版 `TestSlotMachine` 的腳本預設值：`listenReelIndex = 1`
 * （第 2 軸，狀態列的 R1）、`listenDuration = 1.5`、`listenSpeedMultiplier = 1.5`。
 *
 * 聽牌軸的停輪 = 前一軸（停止順序）**實際**停下 + `duration`（決議 46），
 * 伺服器晚到也不會吃掉聽牌時間；第 3 軸維持原本的軸間距接在聽牌軸之後。
 * 聽牌中每格時間變成原速 ÷ 1.5（0.08 → 0.053），時長仍是 1.5 秒。
 * 1 軸時沒有第 2 軸，等於無聽牌。
 *
 * Turbo／L2 是 `fastMode`，框架**不排聽牌時間**，但 onListenStart／End
 * 照發；聽牌中按急停則**依照當下速度**走完。
 */
const LISTEN_SCENARIOS: { label: string; configs: ListenReelConfig[] }[] = [
    {
        label: "第 2 軸（R1）1.5 秒、加速 1.5 倍",
        configs: [{ reelIndex: 1, duration: 1.5, speedMultiplier: 1.5 }],
    },
    { label: "無", configs: [] },
];

/** 聽牌中的軸外框顏色。 */
const LISTEN_HIGHLIGHT_COLOR = 0xffcc00;

/** 機台原點（舞台座標）。各軸對稱擺在它兩側，mask 也以它為中心。 */
const CENTER_X = 320;
const CENTER_Y = 340;

/**
 * 機台區可用的最大寬高（舞台座標，以 CENTER 為中心）：左右留 10px、
 * 上面讓出標題、下面讓出第一排按鈕（y = 600）。
 */
const BOARD_MAX_WIDTH = 620;
const BOARD_MAX_HEIGHT = 500;

/** 相鄰兩軸的跨軸間距：素材寬度再留 8px 縫，避免大圖溢出時互相貼死。 */
const REEL_SPACING = TEST_COLUMN_WIDTH + 8;

/**
 * 測試場景：1 軸或多軸的最小可跑場景。
 *
 * 目的有六個，前四個是單軸時期就有的：
 *
 * 1. 讓 SlotMachine 真的被 webpack 打包 —— `egret build` 零錯誤只代表
 *    tsc 型別檢查過，entry 走不到的模組不算跑過。
 * 2. 確認 Egret 顯示層會動：Icon 建得出來、位置每幀更新、
 *    大 Symbol 的 head／follower 顯示正確。
 * 3. 確認停輪真的會在正式結果對齊時停下。
 * 4. 四個方向都能實際跑一遍。
 * 5. **錯開啟動（`staggerStart`）在瀏覽器裡真的生效** —— 純 TS 斷言
 *    （`tests` §11）涵蓋了時序，但那是餵假 deltaTime 跑的；實機還多了
 *    rAF 節流與真實 frame pacing。
 * 6. **停輪順序與軸間隔**：狀態列印出各軸實際的啟動／停止時刻與相鄰
 *    間隔，直接對照 `staggerStart` 設定值。
 * 7. **聽牌**（決議 42／45）：聽牌中的軸加黃框，狀態列印出聽牌開始／結束
 *    時刻與時長，各軸的 `mi` 看得到切速；配急停可看「依照當下速度」。
 *
 * ## 這裡不碰 BaseReel 的流程
 *
 * 場景只做四件事：建立 Reel 當顯示物件、擺位、交給 `TestSlotMachine.init()`、
 * 按鈕呼叫 `startSpin()` / `stopSpin()`。心跳、啟動延遲、結果分派全部
 * 由 `BaseSlotMachine` 負責 —— 場景自己**沒有** tick，也不直接呼叫
 * `startRoll()` / `commitResult()` / `updateMovement()`。
 *
 * ## 擺位為什麼在場景
 *
 * `BaseSlotMachine.init()` 會把 Reel 收成子項（`adoptReels()`），但不擺位
 * —— 各軸擺哪裡取決於美術寬度與版面，屬於場景／skin 的事，框架不知道
 * （同理 `createDisplayMaskRect(crossSize)` 的跨軸長度也由呼叫端給）。
 */
export class SlotMachineScene extends egret.DisplayObjectContainer {

    private _reels: BaseReel[] = [];
    private _machine: TestSlotMachine;
    private _frame: egret.Shape;

    private readonly _status = new egret.TextField();

    private _spinCount = 0;
    private _stopRequested = false;
    private _scenarioIndex = 0;
    private _directionIndex = 0;
    private _reelCountIndex = REEL_COUNTS.indexOf(5);
    private _serverDelayIndex = 0;
    private _targetStopIndex = 0;
    private _listenIndex = 0;

    /** 聽牌中的軸加框；疊在顯示區外框之上，每次開始／結束重畫。 */
    private readonly _listenFrame = new egret.Shape();

    /**
     * 機台、外框、聽牌框共用的容器，原點在 CENTER。軸數多到放不下時
     * 只縮這一層 —— 機台的 mask 與各軸擺位都在它裡面，一起縮。
     */
    private readonly _board = new egret.DisplayObjectContainer();

    /** 本輪各聽牌軸的開始／結束時刻（遊戲時間）。 */
    private _listenMarks: { reelIndex: number; start?: number; end?: number }[] = [];

    /**
     * 模擬 Server 的狀態機，三個值就夠：
     * 等待中（`_waitingForServer`）→ 已送出（`_serverSentAt` 有值）。
     */
    private _waitingForServer = false;
    private _serverElapsed = 0;
    private _serverSentAt?: number;

    /** 本輪用哪個 Spin mode；由按下哪一顆「開始」決定。 */
    private _mode = "normal";
    private _quickStopAt?: number;
    private _quickStopBeforeServer = false;

    /**
     * 本輪各軸的啟動／停止時刻，用來核對 staggerStart 與停輪順序。
     *
     * 記的是**遊戲時間**（機台心跳累積的 deltaTime），不是牆鐘。
     * 牆鐘在 rAF 被節流時會騙人 —— `MAX_DELTA_TIME = 0.1` 會把每次 tick
     * 的推進鉗在 0.1 秒，於是 0.1 秒的軸間隔量起來變成 1 秒多。
     * 用遊戲時間就與框架同一條時間軸，節流與否讀數都一樣。
     */
    private _startMarks: (number | undefined)[] = [];
    private _stopMarks: (number | undefined)[] = [];
    private _spinElapsedTime = 0;
    private _stopOrder: number[] = [];

    /**
     * 先建靜態視圖（狀態列要先存在），再建機台與外框。
     *
     * 兩個欄位在這裡**直接賦值**而不是委託給 `rebuildMachine()` ——
     * 那樣寫 TypeScript 看不穿方法呼叫，`strictPropertyInitialization`
     * 會判定未初始化，得靠 `!` 斷言騙過去。拆成
     * 「建立（回傳）／掛載／卸載」三段就不需要斷言。
     */
    public constructor() {
        super();
        this._board.x = CENTER_X;
        this._board.y = CENTER_Y;
        this.addChild(this._board);
        this.buildStaticView();
        this._machine = this.createMachine();
        this._frame = this.createFrame();
        this.mountMachine();
    }

    // ───────────────── 建立 ─────────────────

    /** 按鈕與狀態列只建一次，換方向或軸數時不重建。 */
    private buildStaticView(): void {
        this.addLabel("多軸測試場景（含聽牌）", 20, 24, 0xffff66, 20);

        /*
         * 開始的入口每個模式各一顆，對照 Cocos 版
         * `startNormalTest()` / `startTurboTest()` —— 不做「先切模式再按開始」，
         * 因為模式決定的是本輪 Config（速度、fastMode），按下去就定案。
         */
        const machine = () => this._machine;

        this.addButton("Normal 開始", 40, 600,
            () => this.onStart(machine().normalMode));
        this.addButton("Turbo 開始", 200, 600,
            () => this.onStart(machine().turboMode));
        this.addButton("L2 開始", 360, 600,
            () => this.onStart(machine().l2Mode));
        this.addButton("急停", 40, 648, () => this.onQuickStop());
        this.addButton("切換 Server 延遲", 200, 648, () => this.onCycleServerDelay());
        this.addButton("切換盤面", 360, 648, () => this.onCycleScenario());
        this.addButton("切換方向", 40, 696, () => this.onCycleDirection());
        this.addButton("切換軸數", 200, 696, () => this.onCycleReelCount());
        this.addButton("切換停輪時間", 360, 696, () => this.onCycleTargetStop());
        this.addButton("切換聽牌", 40, 744, () => this.onCycleListen());

        /* 5 軸時每軸兩行，15 號字會超出 1136 的舞台底（實測 1211）；13／3 約到 1113。 */
        this._status.size = 13;
        this._status.textColor = 0xffffff;
        this._status.lineSpacing = 3;
        this._status.width = 604;
        this._status.x = 18;
        this._status.y = 796;
        this.addChild(this._status);
    }

    private get reelCount(): number {
        return REEL_COUNTS[this._reelCountIndex];
    }

    private get serverDelay(): number {
        return SERVER_DELAYS[this._serverDelayIndex];
    }

    private get targetStopTime(): number {
        return TARGET_STOP_TIMES[this._targetStopIndex];
    }

    /** 目前的聽牌設定，濾掉本機台沒有的軸。 */
    private get listenConfigs(): ListenReelConfig[] {
        return LISTEN_SCENARIOS[this._listenIndex].configs.filter(
            (config) => config.reelIndex < this._reels.length,
        );
    }

    /**
     * 依目前方向與軸數重新建立整台機台。
     *
     * 方向是 `BaseReel.init()` 的 config、軸數是 `init(reels)` 的參數，
     * 而 `BaseSlotMachine.init()` 重複呼叫會直接略過，所以兩者都只能整組
     * 重建 —— 這也順便反覆驗證 `cleanup()` 真的清得乾淨。
     */
    private rebuildMachine(): void {
        this.unmountMachine();
        this._machine = this.createMachine();
        this._frame = this.createFrame();
        this.mountMachine();
    }

    /**
     * 依目前方向與軸數建立整台機台，含 Reel、擺位、Callback 與遮罩。
     *
     * 回傳而不是直接寫 `this._machine` —— 建構式要看得到賦值（見建構式註解）。
     * 機台交給呼叫端 `mountMachine()` 掛上顯示樹。
     */
    private createMachine(): TestSlotMachine {
        const direction = DIRECTIONS[this._directionIndex];
        const count = this.reelCount;

        this._reels = [];

        for (let index = 0; index < count; index++) {
            this._reels.push(new BaseReel());
        }

        const machine = new TestSlotMachine(
            direction.layoutType,
            direction.inverseDirection,
            this.targetStopTime,
        );
        machine.init(this._reels);

        this.layoutReels();
        this.wireMachineCallbacks(machine);

        machine.x = 0;
        machine.y = 0;
        machine.mask = machine.createDisplayMaskRect(this.crossSize());

        return machine;
    }

    private mountMachine(): void {
        this._board.addChild(this._machine);
        this._board.addChild(this._frame);
        this._board.addChild(this._listenFrame);
        this.fitBoardScale();
        this.resetMarks();
        this.redrawListenFrame();
        this.refreshStatus();
    }

    private unmountMachine(): void {
        this._machine.cleanup();
        this._board.removeChild(this._machine);
        this._board.removeChild(this._frame);
        this._board.removeChild(this._listenFrame);
    }

    /**
     * 各軸沿**跨軸**方向對稱排開，沿軸方向一律留在機台原點。
     *
     * 跨軸是哪一條由 layoutType 決定：垂直滾動時各軸左右排（差 x），
     * 水平滾動時各軸上下排（差 y）。
     */
    private layoutReels(): void {
        const vertical = this.isVertical();
        const count = this._reels.length;

        for (let index = 0; index < count; index++) {
            const offset = this.crossOffsetOf(index);
            const reel = this._reels[index];
            reel.x = vertical ? offset : 0;
            reel.y = vertical ? 0 : offset;
        }
    }

    /** 第 index 軸相對機台原點的跨軸位移；整組置中。 */
    private crossOffsetOf(index: number): number {
        const count = this._reels.length;
        return (index - (count - 1) * 0.5) * REEL_SPACING;
    }

    /** 整台在跨軸方向要遮多寬：兩端軸的外緣距離。 */
    private crossSize(): number {
        const count = this._reels.length;
        return (count - 1) * REEL_SPACING + TEST_COLUMN_WIDTH;
    }

    /**
     * 整台放不進機台區就等比縮小，放得進維持 1:1。
     *
     * 垂直滾動時各軸左右排（寬 = 跨軸長度）；水平滾動時上下排（高 = 跨軸長度）。
     * 1、3 軸兩個方向都放得下；5 軸垂直約 0.75、水平約 0.6。
     */
    private fitBoardScale(): void {
        const axisLength = this._machine.visibleCellCount * TEST_CELL_PITCH;
        const vertical = this.isVertical();
        const width = vertical ? this.crossSize() : axisLength;
        const height = vertical ? axisLength : this.crossSize();
        const scale = Math.min(
            1,
            BOARD_MAX_WIDTH / width,
            BOARD_MAX_HEIGHT / height,
        );

        this._board.scaleX = scale;
        this._board.scaleY = scale;
    }

    private isVertical(): boolean {
        return this._reels[0].layoutType === ReelIconDirection.Vertical;
    }

    private wireMachineCallbacks(machine: TestSlotMachine): void {
        machine.onReelStarted = (reelIndex) => {
            this._startMarks[reelIndex] = this._spinElapsedTime;
            this.refreshStatus();
        };

        machine.onReelStopped = (reelIndex) => {
            this._stopMarks[reelIndex] = this._spinElapsedTime;
            this._stopOrder.push(reelIndex);
            this.refreshStatus();
        };

        machine.onAllReelsStopped = () => {
            this._stopRequested = false;
            this.refreshStatus();
        };

        /*
         * 聽牌通知：前一軸（停止順序）停下 → 開始；本軸停下 → 結束。
         * fastMode／急停時框架不排聽牌時間，但這兩則照發（決議 42），
         * 遊戲層要不要播表演自己決定 —— 場景一律畫框，看得到它們有發。
         */
        machine.onListenStart = (reelIndex) => {
            this.listenMarkOf(reelIndex).start = this._spinElapsedTime;
            this.redrawListenFrame();
            this.refreshStatus();
        };

        machine.onListenEnd = (reelIndex) => {
            this.listenMarkOf(reelIndex).end = this._spinElapsedTime;
            this.redrawListenFrame();
            this.refreshStatus();
        };

        /* 本輪計時與模擬 Server 都掛在機台的唯一心跳上，不另開第二個。 */
        machine.onUpdate = (deltaTime) => {
            this.tickSpin(deltaTime);
        };

        /* 每走完一個完整 Cell 更新一次狀態，不另外開第二個心跳。 */
        for (const reel of this._reels) {
            reel.onCellMovementComplete = () => {
                this.refreshStatus();
            };
        }
    }

    private resetMarks(): void {
        this._startMarks = this._reels.map(() => undefined);
        this._stopMarks = this._reels.map(() => undefined);
        this._stopOrder = [];
        this._listenMarks = [];
    }

    private listenMarkOf(
        reelIndex: number,
    ): { reelIndex: number; start?: number; end?: number } {
        for (const mark of this._listenMarks) {
            if (mark.reelIndex === reelIndex) {
                return mark;
            }
        }

        const mark = { reelIndex };
        this._listenMarks.push(mark);
        return mark;
    }

    /** 已開始、尚未結束的聽牌軸加粗黃框。 */
    private redrawListenFrame(): void {
        const graphics = this._listenFrame.graphics;
        graphics.clear();

        const vertical = this.isVertical();
        const axisLength = this._machine.visibleCellCount * TEST_CELL_PITCH;
        const width = vertical ? TEST_COLUMN_WIDTH : axisLength;
        const height = vertical ? axisLength : TEST_COLUMN_WIDTH;

        for (const mark of this._listenMarks) {
            if (mark.start === undefined || mark.end !== undefined) {
                continue;
            }

            const offset = this.crossOffsetOf(mark.reelIndex);
            const centerX = vertical ? offset : 0;
            const centerY = vertical ? 0 : offset;

            graphics.lineStyle(6, LISTEN_HIGHLIGHT_COLOR, 1);
            graphics.drawRect(
                centerX - width * 0.5 - 3,
                centerY - height * 0.5 - 3,
                width + 6,
                height + 6,
            );
        }
    }

    /** 每一軸各畫一個顯示區外框與格線；長邊隨 layoutType 換軸。 */
    private createFrame(): egret.Shape {
        const vertical = this.isVertical();
        const visibleCells = this._machine.visibleCellCount;
        const axisLength = visibleCells * TEST_CELL_PITCH;
        const width = vertical ? TEST_COLUMN_WIDTH : axisLength;
        const height = vertical ? axisLength : TEST_COLUMN_WIDTH;

        const frame = new egret.Shape();

        for (let index = 0; index < this._reels.length; index++) {
            const offset = this.crossOffsetOf(index);
            const centerX = vertical ? offset : 0;
            const centerY = vertical ? 0 : offset;
            const left = centerX - width * 0.5;
            const top = centerY - height * 0.5;

            frame.graphics.lineStyle(2, 0x00ff88, 0.9);
            frame.graphics.drawRect(left, top, width, height);
            frame.graphics.lineStyle(1, 0x00ff88, 0.45);

            for (let cell = 1; cell < visibleCells; cell++) {
                if (vertical) {
                    const y = top + cell * TEST_CELL_PITCH;
                    frame.graphics.moveTo(left, y);
                    frame.graphics.lineTo(left + width, y);
                } else {
                    const x = left + cell * TEST_CELL_PITCH;
                    frame.graphics.moveTo(x, top);
                    frame.graphics.lineTo(x, top + height);
                }
            }
        }

        return frame;
    }

    // ───────────────── 操作 ─────────────────

    /**
     * 開始一輪，並掛上模擬 Server 的倒數。
     *
     * 結果**不再由按鈕送出** —— 按下之後 `serverDelay` 秒，
     * `tickServerSimulation()` 會自動把結果送進來，與真實遊戲的
     * 「送出下注 → 等回應 → 停輪」同形。對照 Cocos 版
     * `TestSlotMachine.startTest()` 的 `_waitingToSubmitResult = true`。
     */
    private onStart(mode: string): void {
        if (this._machine.spinning) {
            return;
        }

        this._mode = mode;
        this._spinCount++;
        this._stopRequested = false;
        this._spinElapsedTime = 0;
        this._waitingForServer = true;
        this._serverElapsed = 0;
        this._serverSentAt = undefined;
        this._quickStopAt = undefined;
        this.resetMarks();
        this.redrawListenFrame();

        /* 聽牌在 stopSpin() 規劃，所以開轉時送入即可；「無」要送空陣列清掉上一輪。 */
        this._machine.setListenReels(this.listenConfigs);
        this._machine
            .startSpin(this._mode)
            .catch((error: Error) => {
                this._waitingForServer = false;
                console.error("startSpin failed", error);
            });
        this.refreshStatus();
    }

    /**
     * 本輪的時程推進：累積遊戲時間，並在延遲到達時模擬 Server 送入結果。
     *
     * 吃的是機台心跳轉出來的同一份 deltaTime（`TestSlotMachine.onUpdate`），
     * 所以它與滾動共用同一條時間軸 —— 用 `setTimeout` 會變成第二個時間源，
     * 分頁切走或 rAF 被節流時兩邊會脫節。
     *
     * 對照 Cocos 版 `TestSlotMachine.update()`：那邊 `_testElapsedTime`
     * 只在 `spinning` 時累加、`_elapsedTime` 只在等待結果時累加，這裡同形。
     */
    private tickSpin(deltaTime: number): void {
        if (this._machine.spinning) {
            this._spinElapsedTime += deltaTime;
        }

        if (!this._waitingForServer) {
            return;
        }

        this._serverElapsed += deltaTime;

        if (this._serverElapsed < this.serverDelay) {
            return;
        }

        this._waitingForServer = false;
        this._serverSentAt = this._serverElapsed;
        this.submitResult();
    }


    /**
     * 玩家急停。
     *
     * 對照 Cocos 版 `TestSlotMachine.quickStop()` —— 那邊 override 之後
     * 印出「QuickStop 是在 Server 結果送達前還是送達後按下」，因為那正是
     * `prepareFastQuickStopPadding()` 的**兩個進入順序**（主線 §3.6）：
     *
     * | 順序 | 觸發點 | 成因 |
     * |---|---|---|
     * | 送達前按 | `stopSpin()` 內 | 結果還沒寫進佇列，看不到等一下會墊幾格 |
     * | 送達後按 | `quickStop()` 內 | 墊格併在結果區段開頭，起點指的不是本體 |
     *
     * 兩條都只在 `fastMode` 下跑補牌同步，所以要配「切換模式」到 turbo
     * 才驗得到 Turbo 同步；normal 模式下急停只砍未消耗的表演牌。
     */
    private onQuickStop(): void {
        if (!this._machine.spinning || this._quickStopAt !== undefined) {
            return;
        }

        this._quickStopAt = this._spinElapsedTime;
        this._quickStopBeforeServer = this._waitingForServer;
        this._machine.quickStop();
        this.refreshStatus();
    }


    /** 換下一組盤面；滾動中也可以換，送出時才會用到。 */
    private onCycleScenario(): void {
        this._scenarioIndex =
            (this._scenarioIndex + 1) % RESULT_SCENARIOS.length;
        this.refreshStatus();
    }

    /** 換方向要整組重建，所以滾動中不給換。 */
    private onCycleDirection(): void {
        if (this._machine.spinning) {
            return;
        }

        this._directionIndex =
            (this._directionIndex + 1) % DIRECTIONS.length;
        this._spinCount = 0;
        this._stopRequested = false;
        this.rebuildMachine();
    }

    /**
     * 換停輪時間。
     *
     * `targetStopSeconds` 是 `registerSpinConfig()` 的內容，而那在 `init()`
     * 裡就定案了，所以跟方向、軸數一樣只能整組重建。
     */
    private onCycleTargetStop(): void {
        if (this._machine.spinning) {
            return;
        }

        this._targetStopIndex =
            (this._targetStopIndex + 1) % TARGET_STOP_TIMES.length;
        this._spinCount = 0;
        this._stopRequested = false;
        this.rebuildMachine();
    }

    /** 換軸數同樣要整組重建。 */
    private onCycleReelCount(): void {
        if (this._machine.spinning) {
            return;
        }

        this._reelCountIndex =
            (this._reelCountIndex + 1) % REEL_COUNTS.length;
        this._spinCount = 0;
        this._stopRequested = false;
        this.rebuildMachine();
    }

    /** 換下一組聽牌設定；滾動中也可以換，下一輪開轉時才送入。 */
    private onCycleListen(): void {
        this._listenIndex = (this._listenIndex + 1) % LISTEN_SCENARIOS.length;
        this.refreshStatus();
    }

    /** 換下一組 Server 回應延遲；滾動中也可以換，下一輪才生效。 */
    private onCycleServerDelay(): void {
        this._serverDelayIndex =
            (this._serverDelayIndex + 1) % SERVER_DELAYS.length;
        this.refreshStatus();
    }

    /**
     * 模擬 Server 把正式結果送進來。
     *
     * `stopSpin()` 吃的是**逐軸**結果，每一軸的陣列是**畫面閱讀順序**、
     * 長度等於 visibleCellCount。各軸取的盤面索引各自加上軸號，所以同
     * 一次送出各軸長得不一樣 —— 多軸要看的正是「各軸互不干擾」。
     */
    private submitResult(): void {
        if (!this._machine.spinning || this._stopRequested) {
            return;
        }

        const resultByReel: SymbolData[][] = this._reels.map(
            (unused, index) => symbolDataList(this.scenarioOf(index).ids),
        );

        this._scenarioIndex =
            (this._scenarioIndex + 1) % RESULT_SCENARIOS.length;
        this._stopRequested = true;
        this._machine
            .stopSpin(resultByReel)
            .catch((error: Error) => {
                this._stopRequested = false;
                console.error("stopSpin failed", error);
            });
        this.refreshStatus();
    }

    private scenarioOf(reelIndex: number): { label: string; ids: number[] } {
        const index =
            (this._scenarioIndex + reelIndex) % RESULT_SCENARIOS.length;
        return RESULT_SCENARIOS[index];
    }

    // ───────────────── 顯示 ─────────────────

    private refreshStatus(): void {
        const direction = DIRECTIONS[this._directionIndex];
        const first = this._reels[0];
        const lines = [
            `方向 = ${direction.label}`
            + `   exitTowardPositiveAxis = ${first.exitTowardPositiveAxis}`,
            `模式 = ${this._mode}`
            + `   軸數 = ${this._reels.length}`
            + `   spinning = ${this._machine.spinning}`
            + `   spin = ${this._spinCount}`
            + `   t = ${this._spinElapsedTime.toFixed(2)}s`,
            `strip = ${first.stripCellCount} cells`
            + `   maxCellSpan = ${first.maxCellSpan}`
            + `   firstVisibleIndex = ${first.firstVisibleIndex}`,
        ];

        for (let index = 0; index < this._reels.length; index++) {
            lines.push(this.describeReel(index));
        }

        lines.push(this.describeTimeline());
        lines.push(this.describeListen());
        lines.push(this.describeServer());
        lines.push(`下一組盤面 = ${this.describeNextScenarios()}`);

        this._status.text = lines.join("\n");
    }

    /**
     * 單軸一行：狀態、可視段、露出來的圖、groupOffset。
     *
     * `visible ids` 與 `icons` 在截斷盤面上會分岔 —— 前者是可視段的每一格
     * （follower 什麼都沒畫），後者是「圖有露進顯示區」的 group，只回 head，
     * 所以 head 待在 buffer 時索引會落在可視段之外。
     */
    private describeReel(index: number): string {
        const reel = this._reels[index];
        const plan = reel.lastStopPlan;
        const stopInfo = plan !== undefined
            ? `  stop req=${plan.requestedStopTime.toFixed(2)}`
                + `/act=${plan.actualStopTime.toFixed(2)}`
                + `  perf=${plan.performanceCellCount}`
            : "";

        return `R${index} ${reel.state}`
            + `  t=${reel.elapsedRollTime.toFixed(2)}s`
            + `  mi=${reel.moveInterval.toFixed(3)}`
            + `  ids=[${reel.getVisibleCellSymbolIds().join(",")}]`
            + `  icons=[${this.describeVisibleIcons(index)}]`
            + `  off=[${reel.symbols.map(r => r.groupOffset).join("")}]`
            + stopInfo;
    }

    /**
     * 錯開啟動與停輪順序的實測值。
     *
     * `Δ` 是與前一軸的間隔，拿來直接對照 `TestSlotMachine` 的
     * `staggerStart`；停輪那一列同時印出實際順序，順序不是遞增就是錯的。
     */
    private describeTimeline(): string {
        const starts = this.describeMarks(this._startMarks);
        const stops = this.describeMarks(this._stopMarks);
        const order = this._stopOrder.length > 0
            ? this._stopOrder.join("→")
            : "－";

        return `啟動 ${starts}\n停輪 ${stops}   順序 ${order}`;
    }

    /**
     * 聽牌設定與本輪實測（一行）。
     *
     * 時長 = 結束 − 開始，對照設定的 duration：普通模式應等於 duration
     * （誤差一幀內，決議 45）；fastMode 或急停時框架不排聽牌時間，時長會短。
     */
    private describeListen(): string {
        const scenario = LISTEN_SCENARIOS[this._listenIndex];
        const active = this.listenConfigs.length === 0 && scenario.configs.length > 0
            ? `${scenario.label}（本軸數無此軸）`
            : scenario.label;
        const marks = this._listenMarks.map((mark) => {
            const start = mark.start !== undefined ? mark.start.toFixed(3) : "－";
            const end = mark.end !== undefined ? mark.end.toFixed(3) : "－";
            const length = mark.start !== undefined && mark.end !== undefined
                ? ` 長${(mark.end - mark.start).toFixed(3)}`
                : "";
            return `R${mark.reelIndex} ${start}→${end}${length}`;
        });

        return `聽牌 = ${active}`
            + (marks.length > 0 ? `   ${marks.join("  ")}` : "");
    }

    /**
     * 模擬 Server 的狀態。
     *
     * 「已送出 @x.xx」的時刻拿來對照各軸的 `stop req/act`：結果比
     * `targetStopTime` 晚到時 `act` 會被鉗制，兩個數字一起看才知道
     * 停輪是照計畫還是被現實逼的。
     */
    private describeServer(): string {
        const delay = this.serverDelay.toFixed(2);

        const state = this._serverSentAt !== undefined
            ? `已送出 @${this._serverSentAt.toFixed(3)}s`
            : this._waitingForServer
                ? `等待中 ${this._serverElapsed.toFixed(3)}s`
                : "（下一輪生效）";

        return `模擬 Server  延遲=${delay}s  ${state}`
            + `   停輪目標=${this.targetStopTime.toFixed(2)}s`
            + `\n${this.describeQuickStop()}`;
    }

    /**
     * 急停的按下時刻與判定。
     *
     * 「送達前／後」決定走的是 `prepareFastQuickStopPadding()` 的哪一個
     * 呼叫點，兩條路的失步成因完全不同（主線 §3.6）。
     */
    private describeQuickStop(): string {
        if (this._quickStopAt === undefined) {
            return "急停        未按下";
        }

        const timing = this._quickStopBeforeServer
            ? "Server 結果送達前"
            : "Server 結果送達後";

        return `急停        @${this._quickStopAt.toFixed(3)}s`
            + `  判定：${timing}`;
    }

    private describeMarks(marks: (number | undefined)[]): string {
        const parts: string[] = [];
        let previous: number | undefined;

        for (let index = 0; index < marks.length; index++) {
            const mark = marks[index];

            if (mark === undefined) {
                parts.push(`R${index}=－`);
                continue;
            }

            const delta = previous !== undefined
                ? ` (Δ${(mark - previous).toFixed(3)})`
                : "";
            parts.push(`R${index}=${mark.toFixed(3)}${delta}`);
            previous = mark;
        }

        return parts.join("  ");
    }

    /** 把 getVisibleIcons() 的結果印成「strip 索引:Symbol ID」。 */
    private describeVisibleIcons(index: number): string {
        const reel = this._reels[index];
        const all = reel.icons;

        return reel.getVisibleIcons()
            .map((icon) => {
                const iconIndex = all.indexOf(icon);
                const id = icon.data !== undefined ? icon.data.id : "?";
                return `${iconIndex}:${id}`;
            })
            .join(",");
    }

    private describeNextScenarios(): string {
        if (this._reels.length === 1) {
            return this.scenarioOf(0).label;
        }

        return this._reels
            .map((unused, index) => this.scenarioOf(index).ids.join(","))
            .join("  |  ");
    }

    private addLabel(
        text: string,
        x: number,
        y: number,
        color: number,
        size: number,
    ): void {
        const field = new egret.TextField();
        field.text = text;
        field.size = size;
        field.textColor = color;
        field.x = x;
        field.y = y;
        this.addChild(field);
    }

    private addButton(
        text: string,
        x: number,
        y: number,
        handler: () => void,
    ): void {
        const button = new egret.Sprite();
        button.graphics.beginFill(0x2b4a6f, 1);
        button.graphics.lineStyle(1, 0x7fb2ff, 1);
        button.graphics.drawRoundRect(0, 0, 150, 44, 8, 8);
        button.graphics.endFill();
        button.x = x;
        button.y = y;
        button.touchEnabled = true;
        button.addEventListener(
            egret.TouchEvent.TOUCH_TAP,
            handler,
            this,
        );

        const field = new egret.TextField();
        field.text = text;
        field.size = 16;
        field.textColor = 0xffffff;
        field.width = 150;
        field.height = 44;
        field.textAlign = egret.HorizontalAlign.CENTER;
        field.verticalAlign = egret.VerticalAlign.MIDDLE;
        field.touchEnabled = false;
        button.addChild(field);

        this.addChild(button);
    }
}
