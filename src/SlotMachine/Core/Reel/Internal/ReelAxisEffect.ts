import {
    BaseMovement,
    MovementEasing,
} from "./BaseMovement";
import { ReelEffectEasing } from "../Config/ReelEffectEasing";
import { ReelEffectConfig } from "../Config/ReelEffectConfig";

/**
 * Reel 軸向顯示效果的純數值控制器。
 *
 * 同一個類別同時供啟動效果與停止效果使用，兩者只差移出方向；
 * 方向由呼叫端在 start() 傳入正負號決定。
 *
 * 本類別不認識 Node、Symbol 或資料佇列，只產生額外的顯示軸向偏移。
 */
export class ReelAxisEffect {
    private readonly _movement = new BaseMovement();
    private _enabled = false;
    private _distance = 0;
    private _outwardDuration = 0;
    private _returnDuration = 0;
    private _outwardEasing = ReelEffectEasing.CubicOut;
    private _returnEasing = ReelEffectEasing.Linear;
    private _active = false;
    private _completedDuringUpdate = false;

    private readonly _completeHandler = (): void => {
        this._active = false;
        this._completedDuringUpdate = true;
    };

    public get active(): boolean {
        return this._active;
    }

    public get value(): number {
        return this._movement.value;
    }

    /** 完整向外與回正所需的總秒數。 */
    public get totalDuration(): number {
        return this._outwardDuration + this._returnDuration;
    }

    public configure(config?: ReelEffectConfig): void {
        if (this._active) {
            throw new Error(
                "Reel Bounce cannot be configured while it is active.",
            );
        }

        if (config === undefined) {
            this._enabled = false;
            this._distance = 0;
            this._outwardDuration = 0;
            this._returnDuration = 0;
            this._outwardEasing = ReelEffectEasing.CubicOut;
            this._returnEasing = ReelEffectEasing.Linear;
            return;
        }

        this.assertNonNegativeFiniteNumber(
            config.distance,
            "bounce.distance",
        );
        this.assertNonNegativeFiniteNumber(
            config.outwardDuration,
            "bounce.outwardDuration",
        );
        this.assertNonNegativeFiniteNumber(
            config.returnDuration,
            "bounce.returnDuration",
        );

        this._enabled = config.enabled;
        this._distance = config.distance;
        this._outwardDuration = config.outwardDuration;
        this._returnDuration = config.returnDuration;
        this._outwardEasing =
            config.outwardEasing ?? ReelEffectEasing.CubicOut;
        this._returnEasing =
            config.returnEasing ?? ReelEffectEasing.Linear;

        this.resolveEasing(this._outwardEasing);
        this.resolveEasing(this._returnEasing);
    }

    /**
     * 開始 Bounce。
     *
     * Reel 的 Runtime 預設沿負軸向移動，所以先移到負距離，
     * 再回到 0；畫面反向顯示仍由 ReelIconManager 統一處理。
     */
    public start(
        outwardDirection = -1,
        durationScale = 1,
    ): boolean {
        this.reset();

        if (!this._enabled || this._distance === 0) {
            return false;
        }

        if (
            !Number.isFinite(outwardDirection)
            || outwardDirection === 0
        ) {
            throw new Error(
                "outwardDirection must be a non-zero finite number.",
            );
        }
        if (!Number.isFinite(durationScale) || durationScale <= 0) {
            throw new Error(
                "durationScale must be a positive finite number.",
            );
        }

        this._active = true;
        this._movement.moveTo(
            this._distance * Math.sign(outwardDirection),
            this._outwardDuration * durationScale,
            this.resolveEasing(this._outwardEasing),
        );
        this._movement.moveTo(
            0,
            this._returnDuration * durationScale,
            this.resolveEasing(this._returnEasing),
        );
        this._movement.addCallback(this._completeHandler);
        return true;
    }

    /**
     * 推進顯示回彈；回傳本幀是否剛完成。
     */
    public update(deltaTime: number): boolean {
        this._completedDuringUpdate = false;

        if (!this._active) {
            return false;
        }

        this._movement.update(deltaTime);
        return this._completedDuringUpdate;
    }

    /** 中止回彈並把顯示偏移歸零。 */
    public reset(): void {
        this._movement.clear();
        this._movement.setValue(0);
        this._active = false;
        this._completedDuringUpdate = false;
    }

    public cleanup(): void {
        this.reset();
        this._movement.onValueChanged = undefined;
        this._movement.onCommandComplete = undefined;
        this._movement.onQueueComplete = undefined;
    }

    private resolveEasing(
        easing: ReelEffectEasing,
    ): MovementEasing {
        const resolved = this._easingMap[easing];

        if (resolved === undefined) {
            throw new Error(
                `Unsupported ReelEffectEasing: ${String(easing)}.`,
            );
        }

        return resolved;
    }

    private readonly _easingMap: Readonly<
        Record<ReelEffectEasing, MovementEasing>
    > = {
        [ReelEffectEasing.Linear]: BaseMovement.linear,
        [ReelEffectEasing.QuadIn]: (progress) =>
            progress * progress,
        [ReelEffectEasing.QuadOut]: (progress) =>
            1 - (1 - progress) * (1 - progress),
        [ReelEffectEasing.QuadInOut]: (progress) =>
            progress < 0.5
                ? 2 * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 2) / 2,
        [ReelEffectEasing.CubicIn]: (progress) =>
            progress * progress * progress,
        [ReelEffectEasing.CubicOut]: (progress) =>
            1 - Math.pow(1 - progress, 3),
        [ReelEffectEasing.CubicInOut]: (progress) =>
            progress < 0.5
                ? 4 * progress * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 3) / 2,
        [ReelEffectEasing.SineIn]: (progress) =>
            1 - Math.cos(progress * Math.PI / 2),
        [ReelEffectEasing.SineOut]: (progress) =>
            Math.sin(progress * Math.PI / 2),
        [ReelEffectEasing.SineInOut]: (progress) =>
            -(Math.cos(Math.PI * progress) - 1) / 2,
        [ReelEffectEasing.BackIn]: (progress) => {
            const overshoot = 1.70158;
            return (overshoot + 1)
                * progress * progress * progress
                - overshoot * progress * progress;
        },
        [ReelEffectEasing.BackOut]: (progress) => {
            const overshoot = 1.70158;
            const shifted = progress - 1;
            return 1
                + (overshoot + 1) * shifted * shifted * shifted
                + overshoot * shifted * shifted;
        },
    };

    private assertNonNegativeFiniteNumber(
        value: number,
        label: string,
    ): void {
        if (!Number.isFinite(value) || value < 0) {
            throw new Error(
                `${label} must be a non-negative finite number.`,
            );
        }
    }
}
