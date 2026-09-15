import { BaseReel } from "../SlotMachine/Core/Reel/BaseReel";
import { ReelIconDirection } from "../SlotMachine/Core/Reel/Config/ReelIconDirection";
import { SymbolData } from "../SlotMachine/Core/Reel/Data/SymbolData";
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

/** 顯示區中心，四個方向共用。 */
const CENTER_X = 320;
const CENTER_Y = 420;

/**
 * 階段 9a：單軸最小可跑場景。
 *
 * 目的**只有四個**，刻意不做多軸、不做 Turbo：
 *
 * 1. 讓 SlotMachine 第一次真的被 webpack 打包 —— 在此之前
 *    entry 走不到那些模組，`egret build` 零錯誤只代表 tsc 型別檢查過。
 * 2. 確認 Egret 顯示層會動：Icon 建得出來、位置每幀更新、
 *    大 Symbol 的 head／follower 顯示正確。
 * 3. 確認停輪真的會在正式結果對齊時停下。
 * 4. **四個方向都能實際跑一遍** —— 方向只影響三個地方
 *    （`mapAxisToLocal()`、`createDisplayMaskRect()`、
 *    `resultEntryAtDisplayStart`），但沒跑過就不算數。
 *
 * ## 這裡不碰 BaseReel 的流程
 *
 * 場景只做三件事：建立 Reel 當顯示物件、把它交給 `TestSlotMachine.init()`、
 * 按鈕呼叫 `startSpin()` / `stopSpin()`。心跳、啟動延遲、結果分派全部
 * 由 `BaseSlotMachine` 負責 —— 場景自己**沒有** tick，也不直接呼叫
 * `startRoll()` / `commitResult()` / `updateMovement()`。
 *
 * 設定集中在 `TestSlotMachine`（對應 Cocos 版的 Inspector 欄位），
 * 只有方向由場景給 —— 因為它要能在執行期換。
 */
export class SingleReelScene extends egret.DisplayObjectContainer {

    private _reel: BaseReel;
    private _machine: TestSlotMachine;
    private _frame: egret.Shape;

    private readonly _status = new egret.TextField();

    private _spinCount = 0;
    private _stopRequested = false;
    private _scenarioIndex = 0;
    private _directionIndex = 0;

    public constructor() {
        super();
        this.buildStaticView();
        this.rebuildReel();
    }

    // ───────────────── 建立 ─────────────────

    /** 按鈕與狀態列只建一次，換方向時不重建。 */
    private buildStaticView(): void {
        this.addLabel("階段 9a：單軸最小可跑場景", 20, 24, 0xffff66, 20);

        this.addButton("開始滾動", 40, 640, () => this.onStart());
        this.addButton("送出結果並停輪", 200, 640, () => this.onStop());
        this.addButton("切換盤面", 360, 640, () => this.onCycleScenario());
        this.addButton("切換方向", 40, 694, () => this.onCycleDirection());

        this._status.size = 16;
        this._status.textColor = 0xffffff;
        this._status.lineSpacing = 6;
        this._status.width = 600;
        this._status.x = 20;
        this._status.y = 754;
        this.addChild(this._status);
    }

    /**
     * 依目前方向重新建立 Reel 與 SlotMachine。
     *
     * 方向是 `BaseReel.init()` 的 config，而 `BaseSlotMachine.init()`
     * 重複呼叫會直接略過，所以換方向只能整組重建 —— 這也順便驗證了
     * `cleanup()` 真的清得乾淨。
     */
    private rebuildReel(): void {
        if (this._machine !== undefined) {
            this._machine.cleanup();
            this.removeChild(this._reel);
            this.removeChild(this._frame);
        }

        const direction = DIRECTIONS[this._directionIndex];

        this._reel = new BaseReel();
        this._machine = new TestSlotMachine(
            direction.layoutType,
            direction.inverseDirection,
        );

        this._machine.init([this._reel]);
        this._machine.onAllReelsStopped = () => {
            this._stopRequested = false;
            this.refreshStatus();
        };
        this._machine.onReelStarted = () => {
            this.refreshStatus();
        };

        /* 每走完一個完整 Cell 更新一次狀態，不另外開第二個心跳。 */
        this._reel.onCellMovementComplete = () => {
            this.refreshStatus();
        };

        this._reel.x = CENTER_X;
        this._reel.y = CENTER_Y;
        this._reel.mask =
            this._reel.createDisplayMaskRect(TEST_COLUMN_WIDTH);

        this._frame = this.createFrame();

        this.addChild(this._reel);
        this.addChild(this._frame);
        this.refreshStatus();
    }

    /** 顯示區外框與每格分隔線；長邊隨 layoutType 換軸。 */
    private createFrame(): egret.Shape {
        const vertical =
            this._reel.layoutType === ReelIconDirection.Vertical;
        const visibleCells = this._machine.visibleCellCount;
        const axisLength = visibleCells * TEST_CELL_PITCH;
        const width = vertical ? TEST_COLUMN_WIDTH : axisLength;
        const height = vertical ? axisLength : TEST_COLUMN_WIDTH;
        const left = CENTER_X - width * 0.5;
        const top = CENTER_Y - height * 0.5;

        const frame = new egret.Shape();
        frame.graphics.lineStyle(2, 0x00ff88, 0.9);
        frame.graphics.drawRect(left, top, width, height);
        frame.graphics.lineStyle(1, 0x00ff88, 0.45);

        for (let i = 1; i < visibleCells; i++) {
            if (vertical) {
                const y = top + i * TEST_CELL_PITCH;
                frame.graphics.moveTo(left, y);
                frame.graphics.lineTo(left + width, y);
            } else {
                const x = left + i * TEST_CELL_PITCH;
                frame.graphics.moveTo(x, top);
                frame.graphics.lineTo(x, top + height);
            }
        }

        return frame;
    }

    // ───────────────── 操作 ─────────────────

    private onStart(): void {
        if (this._machine.spinning) {
            return;
        }

        this._spinCount++;
        this._stopRequested = false;
        this._machine
            .startSpin(this._machine.normalMode)
            .catch((error: Error) => {
                console.error("startSpin failed", error);
            });
        this.refreshStatus();
    }

    /** 換下一個盤面；滾動中也可以換，送出時才會用到。 */
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
        this.rebuildReel();
    }

    /**
     * 送出正式結果。
     *
     * `stopSpin()` 吃的是**逐軸**結果，每一軸的陣列是**畫面閱讀順序**、
     * 長度等於 visibleCellCount。送出後自動跳下一個盤面，連按就能把
     * RESULT_SCENARIOS 走一輪。
     */
    private onStop(): void {
        if (!this._machine.spinning || this._stopRequested) {
            return;
        }

        const scenario = RESULT_SCENARIOS[this._scenarioIndex];
        const result: SymbolData[] = symbolDataList(scenario.ids);

        this._scenarioIndex =
            (this._scenarioIndex + 1) % RESULT_SCENARIOS.length;
        this._stopRequested = true;
        this._machine
            .stopSpin([result])
            .catch((error: Error) => {
                this._stopRequested = false;
                console.error("stopSpin failed", error);
            });
        this.refreshStatus();
    }

    // ───────────────── 顯示 ─────────────────

    private refreshStatus(): void {
        const reel = this._reel;
        const plan = reel.lastStopPlan;
        const lines = [
            `方向 = ${DIRECTIONS[this._directionIndex].label}`
            + `   exitTowardPositiveAxis = ${reel.exitTowardPositiveAxis}`,
            `machine.spinning = ${this._machine.spinning}`
            + `   spin = ${this._spinCount}`,
            `reel.state = ${reel.state}`
            + `   elapsed = ${reel.elapsedRollTime.toFixed(2)}s`,
            `strip = ${reel.stripCellCount} cells`
            + `   maxCellSpan = ${reel.maxCellSpan}`
            + `   firstVisibleIndex = ${reel.firstVisibleIndex}`,
            `visible ids  = [${reel.getVisibleCellSymbolIds().join(", ")}]`
            + `   (可視段的每一格，畫面閱讀順序)`,
            `visibleIcons = [${this.describeVisibleIcons()}]`
            + `   (圖有露出來的 group，只回 head)`,
            `groupOffset  = [${reel.symbols.map(r => r.groupOffset).join(", ")}]`,
            `下一個盤面 = ${RESULT_SCENARIOS[this._scenarioIndex].label}`,
        ];

        if (plan !== undefined) {
            lines.push(
                `stopPlan  requested=${plan.requestedStopTime.toFixed(2)}`
                + `  earliest=${plan.earliestStopTime.toFixed(2)}`
                + `  actual=${plan.actualStopTime.toFixed(2)}`
                + `  perfCells=${plan.performanceCellCount}`,
            );
        }

        this._status.text = lines.join("\n");
    }

    /**
     * 把 getVisibleIcons() 的結果印成「strip 索引:Symbol ID」。
     *
     * 截斷盤面上會看到索引落在 firstVisibleIndex 之外 —— 那就是 head
     * 待在 buffer 裡、圖卻蓋進顯示區的情況。
     */
    private describeVisibleIcons(): string {
        const reel = this._reel;
        const all = reel.icons;

        return reel.getVisibleIcons()
            .map((icon) => {
                const index = all.indexOf(icon);
                const id = icon.data !== undefined ? icon.data.id : "?";
                return `${index}:${id}`;
            })
            .join(", ");
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
