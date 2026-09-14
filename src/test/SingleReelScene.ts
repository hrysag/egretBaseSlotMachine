import { BaseReel } from "../SlotMachine/Core/Reel/BaseReel";
import { SymbolData } from "../SlotMachine/Core/Reel/Data/SymbolData";
import { TestSlotMachine } from "./TestSlotMachine";
import {
    symbolDataList,
    TEST_CELL_PITCH,
    TEST_COLUMN_WIDTH,
} from "./TestSymbolTable";

/**
 * 階段 9a：單軸最小可跑場景。
 *
 * 目的**只有三個**，刻意不做多軸、不做 Turbo、不做四方向：
 *
 * 1. 讓 SlotMachine 第一次真的被 webpack 打包 —— 在此之前
 *    entry 走不到那些模組，`egret build` 零錯誤只代表 tsc 型別檢查過。
 * 2. 確認 Egret 顯示層會動：Icon 建得出來、位置每幀更新、
 *    大 Symbol 的 head／follower 顯示正確。
 * 3. 確認停輪真的會在正式結果對齊時停下。
 *
 * ## 這裡不碰 BaseReel 的流程
 *
 * 場景只做三件事：建立 Reel 當顯示物件、把它交給 `TestSlotMachine.init()`、
 * 按鈕呼叫 `startSpin()` / `stopSpin()`。心跳、啟動延遲、結果分派全部
 * 由 `BaseSlotMachine` 負責 —— 場景自己**沒有** tick，也不直接呼叫
 * `startRoll()` / `commitResult()` / `updateMovement()`。
 *
 * 設定集中在 `TestSlotMachine`（對應 Cocos 版的 Inspector 欄位）。
 */
export class SingleReelScene extends egret.DisplayObjectContainer {

    private readonly _reel = new BaseReel();
    private readonly _machine = new TestSlotMachine();
    private readonly _status = new egret.TextField();

    private _spinCount = 0;
    private _stopRequested = false;

    public constructor() {
        super();
        this.buildMachine();
        this.buildView();
        this.refreshStatus();
    }

    // ───────────────── 建立 ─────────────────

    /**
     * 把 Reel 交給 SlotMachine。
     *
     * Reel 的幾何、時間、牌庫與初始盤面都在 `TestSlotMachine` 的三個
     * Hook 裡，`init()` 會依序呼叫它們，這裡不重複設定。
     */
    private buildMachine(): void {
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
    }

    private buildView(): void {
        const visibleCells = this._machine.visibleCellCount;
        const axisLength = visibleCells * TEST_CELL_PITCH;
        const centerX = 320;
        const centerY = 420;

        this.addLabel("階段 9a：單軸最小可跑場景", 20, 24, 0xffff66, 20);

        /* 顯示區外框，用來目視確認 Icon 有沒有超出可視範圍。 */
        const frame = new egret.Shape();
        frame.graphics.lineStyle(2, 0x00ff88, 0.9);
        frame.graphics.drawRect(
            centerX - TEST_COLUMN_WIDTH * 0.5,
            centerY - axisLength * 0.5,
            TEST_COLUMN_WIDTH,
            axisLength,
        );

        /* 每一格的分隔線，停止時 Symbol 必須精確落在格內。 */
        frame.graphics.lineStyle(1, 0x00ff88, 0.45);

        for (let i = 1; i < visibleCells; i++) {
            const y = centerY - axisLength * 0.5 + i * TEST_CELL_PITCH;
            frame.graphics.moveTo(centerX - TEST_COLUMN_WIDTH * 0.5, y);
            frame.graphics.lineTo(centerX + TEST_COLUMN_WIDTH * 0.5, y);
        }

        this._reel.x = centerX;
        this._reel.y = centerY;
        this._reel.mask =
            this._reel.createDisplayMaskRect(TEST_COLUMN_WIDTH);

        this.addChild(this._reel);
        this.addChild(frame);

        this.addButton("開始滾動", 40, 640, () => this.onStart());
        this.addButton("送出結果並停輪", 200, 640, () => this.onStop());

        this._status.size = 16;
        this._status.textColor = 0xffffff;
        this._status.lineSpacing = 6;
        this._status.width = 600;
        this._status.x = 20;
        this._status.y = 710;
        this.addChild(this._status);
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

    /**
     * 送出正式結果。
     *
     * `stopSpin()` 吃的是**逐軸**結果，每一軸的陣列是**畫面閱讀順序**、
     * 長度等於 visibleCellCount。此處刻意輪流送純 1×1 與含 1×3 的盤面，
     * 後者會讓 head 停在進場 buffer（截斷盤面）。
     */
    private onStop(): void {
        if (!this._machine.spinning || this._stopRequested) {
            return;
        }

        const result: SymbolData[] = this._spinCount % 2 === 1
            ? symbolDataList([73, 73, 73])
            : symbolDataList([8, 9, 10]);

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
            `machine.spinning = ${this._machine.spinning}`
            + `   spin = ${this._spinCount}`,
            `reel.state = ${reel.state}`
            + `   elapsed = ${reel.elapsedRollTime.toFixed(2)}s`,
            `strip = ${reel.stripCellCount} cells`
            + `   maxCellSpan = ${reel.maxCellSpan}`
            + `   firstVisibleIndex = ${reel.firstVisibleIndex}`,
            `visible ids = [${reel.getVisibleCellSymbolIds().join(", ")}]`,
            `groupOffset = [${reel.symbols.map(r => r.groupOffset).join(", ")}]`,
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
