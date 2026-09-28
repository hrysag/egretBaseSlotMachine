import { SymbolData } from "../Core/Reel/Data/SymbolData";
import { assertNonNegativeFiniteNumber } from "../Core/Internal/NumberAssert";
import { BaseDropReel } from "./BaseDropReel";
import { DropSlotMachineConfig } from "./Config/DropSlotMachineConfig";

interface PendingDropStart {
    readonly startAt: number;
    readonly start: () => Promise<void>;
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
export class BaseDropSlotMachine extends eui.Component {
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

        assertNonNegativeFiniteNumber(dropOutInterval, "dropOutIntervalSeconds");
        assertNonNegativeFiniteNumber(dropInInterval, "dropInIntervalSeconds");

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
        return this.run(this._reels.map((reel, index) => ({
            startAt: index * interval,
            start: () => reel.startDropOut(),
        })));
    }

    /**
     * 全軸掉入新盤面；相鄰兩軸間隔 `dropInIntervalSeconds`，Turbo 時不等。
     *
     * @param boards 每軸一份，畫面閱讀順序的逐格結果
     */
    public dropIn(boards: SymbolData[][], fastMode = false): Promise<void> {
        this.assertOnePerReel(boards, "dropIn()");
        const interval = fastMode ? 0 : this._dropInInterval;
        return this.run(this._reels.map((reel, index) => ({
            startAt: index * interval,
            start: () => reel.startDropIn(boards[index]),
        })));
    }

    /**
     * 全軸同時消除並補牌（v3 `startDropRefill()`）。沒有要消的軸直接略過。
     *
     * @param removePositions 每軸的消除格子位置（畫面閱讀順序）
     * @param refillCells 每軸補進來的新牌（畫面閱讀順序），張數 = 該軸消掉的格數
     */
    public dropRefill(
        removePositions: number[][],
        refillCells: SymbolData[][],
    ): Promise<void> {
        this.assertOnePerReel(removePositions, "dropRefill()");
        this.assertOnePerReel(refillCells, "dropRefill()");
        return this.run(this._reels.map((reel, index) => ({
            startAt: 0,
            start: () => reel.startDropRefill(
                removePositions[index],
                refillCells[index],
            ),
        })));
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

    public cleanup(): void {
        this.stopTicking();

        for (const reel of this._reels) {
            reel.cleanup();
        }

        this._reels = [];
        this._running = false;
        this._pendingStarts = [];
        this._resolveRun = undefined;
        this._elapsed = 0;
        this._inited = false;
    }

    // ───────────────── 內部 ─────────────────

    /**
     * 排程一批掉落：時間 0 的軸當場開始，其餘由 update() 依時間開始；
     * 全部開始、也全部掉完才 resolve。途中再下指令 → throw（Q6）。
     */
    private run(starts: PendingDropStart[]): Promise<void> {
        this.assertInitialized();

        if (this._running) {
            throw new Error(
                "A drop command cannot start while the previous one is still running.",
            );
        }

        this._running = true;
        this._elapsed = 0;
        this._pendingStarts = [...starts].sort((a, b) => a.startAt - b.startAt);

        const promise = new Promise<void>((resolve) => {
            this._resolveRun = resolve;
        });

        try {
            this.startDueReels();
        } catch (error) {
            this._running = false;
            this._pendingStarts = [];
            this._resolveRun = undefined;
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
            const pending = this._pendingStarts.shift() as PendingDropStart;
            void pending.start();
        }
    }

    /** 全部開始、也全部掉完就結束這批。 */
    private tryFinishRun(): void {
        if (
            !this._running
            || this._pendingStarts.length > 0
            || this._reels.some((reel) => reel.dropping)
        ) {
            return;
        }

        this._running = false;
        const resolve = this._resolveRun;
        this._resolveRun = undefined;

        if (resolve !== undefined) {
            resolve();
        }
    }

    private assertOnePerReel(values: unknown[], label: string): void {
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
