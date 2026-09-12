/**
 * 單一數值軸的移動指令執行器。
 *
 * 此類別刻意只處理 number，不認識 Cocos Node、Vec2、Vec3、Reel 或 Symbol。
 * 使用端可以自行決定這個數值代表 X、Y 或其他邏輯軸，讓底層計算保持單純且容易驗證。
 */

/** 將 0～1 的原始進度轉換成實際移動進度。 */
export type MovementEasing = (progress: number) => number;

/** BaseMovement 支援的指令種類。 */
export enum MovementCommandType {
    /** 移動至指定的絕對位置。 */
    MoveTo = "MoveTo",

    /** 從指令開始執行時的位置，再增加指定的相對位移。 */
    MoveBy = "MoveBy",

    /** 不消耗時間的流程回呼。 */
    Callback = "Callback",
}

interface MoveToCommand {
    readonly type: MovementCommandType.MoveTo;
    readonly destination: number;
    readonly duration: number;
    readonly easing: MovementEasing;
}

interface MoveByCommand {
    readonly type: MovementCommandType.MoveBy;
    readonly offset: number;
    readonly duration: number;
    readonly easing: MovementEasing;
}

interface CallbackCommand {
    readonly type: MovementCommandType.Callback;
    readonly callback: (movement: BaseMovement) => void;
}

type MovementCommand =
    | MoveToCommand
    | MoveByCommand
    | CallbackCommand;

interface ActiveMove {
    readonly command: MoveToCommand | MoveByCommand;
    readonly startValue: number;
    readonly endValue: number;
    elapsedTime: number;
}

/**
 * 可直接使用、也允許遊戲端視需要繼承的 Movement Command Runner。
 *
 * `moveTo()` 的終點是絕對位置。
 * `moveBy()` 的終點則在指令真正開始執行時，使用當前值加上相對位移。
 */
export class BaseMovement {
    private readonly _commands: MovementCommand[] = [];
    private _activeMove: ActiveMove | undefined;
    private _value: number;
    private _timeScale = 1;
    private _paused = false;

    /** 每當目前數值改變時通知使用端。 */
    public onValueChanged?: (value: number) => void;

    /** 每個指令完成時通知使用端。 */
    public onCommandComplete?: (
        commandType: MovementCommandType,
    ) => void;

    /** 整批指令由有工作轉為完全空閒時通知使用端。 */
    public onQueueComplete?: () => void;

    public constructor(initialValue = 0) {
        this.assertFiniteNumber(initialValue, "initialValue");
        this._value = initialValue;
    }

    public get value(): number {
        return this._value;
    }

    public get timeScale(): number {
        return this._timeScale;
    }

    /**
     * 整體時間縮放可用於暫停、除錯慢動作或明確核准的全域速度調整。
     *
     * Reel 的玩家急停不得透過修改 timeScale 實作，否則會破壞資料距離與企劃時間的對應。
     */
    public set timeScale(value: number) {
        if (!Number.isFinite(value) || value < 0) {
            throw new Error("timeScale must be a non-negative finite number.");
        }

        this._timeScale = value;
    }

    public get isPaused(): boolean {
        return this._paused;
    }

    public get isIdle(): boolean {
        return this._activeMove === undefined && this._commands.length === 0;
    }

    public get queuedCommandCount(): number {
        return this._commands.length + (this._activeMove === undefined ? 0 : 1);
    }

    /**
     * 目前 Movement Queue 尚需執行的原始秒數。
     *
     * Callback 不佔時間；停止時間規劃會用此值納入結果提交當下
     * 已經開始、但尚未完成的 Cell Movement。
     */
    public get remainingDuration(): number {
        let duration = 0;

        if (this._activeMove !== undefined) {
            duration +=
                this._activeMove.command.duration
                - this._activeMove.elapsedTime;
        }

        for (const command of this._commands) {
            if (command.type !== MovementCommandType.Callback) {
                duration += command.duration;
            }
        }

        return duration;
    }

    /**
     * 目前 Move 指令距離終點尚餘多少位移。
     *
     * QuickStop 投影只用它完成正在進行的第一個半格；後續仍依固定
     * half-Cell 距離計算。沒有進行中 Move 時回傳 undefined。
     */
    public get activeMoveRemainingOffset(): number | undefined {
        if (this._activeMove === undefined) {
            return undefined;
        }

        return this._activeMove.endValue - this._value;
    }

    /** 直接設定目前值，不建立 Movement 指令。 */
    public setValue(value: number): void {
        this.assertFiniteNumber(value, "value");
        this.applyValue(value);
    }

    /** 加入「移動至絕對位置」指令。 */
    public moveTo(
        destination: number,
        duration: number,
        easing: MovementEasing = BaseMovement.linear,
    ): void {
        this.assertFiniteNumber(destination, "destination");
        this.assertDuration(duration);

        this._commands.push({
            type: MovementCommandType.MoveTo,
            destination,
            duration,
            easing,
        });
    }

    /**
     * 加入「從執行當下位置再移動指定距離」指令。
     *
     * 相對終點要等到指令開始時才計算，避免前方指令改變位置後仍使用過期起點。
     */
    public moveBy(
        offset: number,
        duration: number,
        easing: MovementEasing = BaseMovement.linear,
    ): void {
        this.assertFiniteNumber(offset, "offset");
        this.assertDuration(duration);

        this._commands.push({
            type: MovementCommandType.MoveBy,
            offset,
            duration,
            easing,
        });
    }

    /** 加入不消耗時間的流程回呼。 */
    public addCallback(callback: (movement: BaseMovement) => void): void {
        this._commands.push({
            type: MovementCommandType.Callback,
            callback,
        });
    }

    public pause(): void {
        this._paused = true;
    }

    public resume(): void {
        this._paused = false;
    }

    /** 清除尚未完成及尚未開始的全部指令。 */
    public clear(): void {
        this._commands.length = 0;
        this._activeMove = undefined;
    }

    /**
     * 推進目前的指令序列。
     *
     * 一個指令若提前完成，本幀尚未消耗的 deltaTime 會立即交給下一個指令。
     * 這能避免 Reel 每個半 Cell 邊界都額外浪費一幀，也讓低幀率下的總時間更穩定。
     */
    public update(deltaTime: number): void {
        if (this._paused) {
            return;
        }

        if (!Number.isFinite(deltaTime) || deltaTime < 0) {
            throw new Error("deltaTime must be a non-negative finite number.");
        }

        let remainingTime = deltaTime * this._timeScale;
        const queueWasActive = !this.isIdle;

        while (this._activeMove !== undefined || this._commands.length > 0) {
            if (this._activeMove === undefined) {
                const next = this._commands.shift();

                if (next === undefined) {
                    break;
                }

                if (next.type === MovementCommandType.Callback) {
                    next.callback(this);
                    this.onCommandComplete?.(MovementCommandType.Callback);
                    continue;
                }

                const endValue =
                    next.type === MovementCommandType.MoveTo
                        ? next.destination
                        : this._value + next.offset;

                this._activeMove = {
                    command: next,
                    startValue: this._value,
                    endValue,
                    elapsedTime: 0,
                };
            }

            const active = this._activeMove;
            const timeNeeded =
                active.command.duration - active.elapsedTime;
            const consumedTime = Math.min(remainingTime, timeNeeded);

            active.elapsedTime += consumedTime;
            remainingTime -= consumedTime;

            const rawProgress =
                active.command.duration === 0
                    ? 1
                    : active.elapsedTime / active.command.duration;
            const easedProgress = active.command.easing(rawProgress);
            const nextValue =
                active.startValue
                + (active.endValue - active.startValue) * easedProgress;

            this.applyValue(nextValue);

            if (active.elapsedTime < active.command.duration) {
                break;
            }

            /**
             * 完成時直接校正到精確終點，避免多段 Movement 的浮點誤差持續累積。
             */
            this.applyValue(active.endValue);
            const completedType = active.command.type;
            this._activeMove = undefined;
            this.onCommandComplete?.(completedType);

            if (remainingTime <= 0 && this._commands.length > 0) {
                /**
                 * Movement 後方若緊接 Callback，即使本幀時間已用完也要立即執行，
                 * 讓半 Cell 完成檢查與下一段 Movement 能維持同一條時間線。
                 */
                const nextCommand = this._commands[0];

                if (nextCommand.type !== MovementCommandType.Callback) {
                    break;
                }
            }
        }

        if (queueWasActive && this.isIdle) {
            this.onQueueComplete?.();
        }
    }

    public static linear(progress: number): number {
        return progress;
    }

    private applyValue(value: number): void {
        this._value = value;
        this.onValueChanged?.(value);
    }

    private assertDuration(duration: number): void {
        if (!Number.isFinite(duration) || duration < 0) {
            throw new Error("duration must be a non-negative finite number.");
        }
    }

    private assertFiniteNumber(value: number, label: string): void {
        if (!Number.isFinite(value)) {
            throw new Error(`${label} must be a finite number.`);
        }
    }
}
