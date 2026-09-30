namespace slot_core {
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

        /** 本次效果還剩幾秒；未播放時為 0（決議 42 推算第一格邊界用）。 */
        public get remainingDuration(): number {
            return this._active ? this._movement.remainingDuration : 0;
        }

        public configure(config?: ReelEffectConfig): void {
            if (this._active) {
                throw new Error(
                    "Reel Bounce cannot be configured while it is active.",
                );
            }

            this._movement.init(0);

            if (config === undefined) {
                this._enabled = false;
                this._distance = 0;
                this._outwardDuration = 0;
                this._returnDuration = 0;
                this._outwardEasing = ReelEffectEasing.CubicOut;
                this._returnEasing = ReelEffectEasing.Linear;
                return;
            }

            assertNonNegativeFiniteNumber(
                config.distance,
                "bounce.distance",
            );
            assertNonNegativeFiniteNumber(
                config.outwardDuration,
                "bounce.outwardDuration",
            );
            assertNonNegativeFiniteNumber(
                config.returnDuration,
                "bounce.returnDuration",
            );

            this._enabled = config.enabled;
            this._distance = config.distance;
            this._outwardDuration = config.outwardDuration;
            this._returnDuration = config.returnDuration;
            this._outwardEasing = config.outwardEasing !== undefined
                ? config.outwardEasing
                : ReelEffectEasing.CubicOut;
            this._returnEasing = config.returnEasing !== undefined
                ? config.returnEasing
                : ReelEffectEasing.Linear;

            this.resolveEasing(this._outwardEasing);
            this.resolveEasing(this._returnEasing);
        }

        /**
         * 開始播放效果：先移到 `distance × outwardDirection`，再回到 0。
         *
         * 軸向座標一律往退場方向遞增，因此：
         * - 啟動效果逆著滾動拉 → `outwardDirection = -1`
         * - 停止效果順著滾動衝 → `outwardDirection = +1`
         *
         * 畫面上的實際方向由 ReelIconManager 的軸向映射統一處理。
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
            this._movement.cleanup();
        }

        /**
         * 查出緩動函式。
         *
         * 每個緩動是本類別的具名 static 方法；新增 `ReelEffectEasing` 成員時
         * 要在這裡補一個 case，漏了會在 `configure()` 就 throw。
         */
        private resolveEasing(
            easing: ReelEffectEasing,
        ): MovementEasing {
            switch (easing) {
                case ReelEffectEasing.Linear:
                    return BaseMovement.linear;
                case ReelEffectEasing.QuadIn:
                    return ReelAxisEffect.quadIn;
                case ReelEffectEasing.QuadOut:
                    return ReelAxisEffect.quadOut;
                case ReelEffectEasing.QuadInOut:
                    return ReelAxisEffect.quadInOut;
                case ReelEffectEasing.CubicIn:
                    return ReelAxisEffect.cubicIn;
                case ReelEffectEasing.CubicOut:
                    return ReelAxisEffect.cubicOut;
                case ReelEffectEasing.CubicInOut:
                    return ReelAxisEffect.cubicInOut;
                case ReelEffectEasing.SineIn:
                    return ReelAxisEffect.sineIn;
                case ReelEffectEasing.SineOut:
                    return ReelAxisEffect.sineOut;
                case ReelEffectEasing.SineInOut:
                    return ReelAxisEffect.sineInOut;
                case ReelEffectEasing.BackIn:
                    return ReelAxisEffect.backIn;
                case ReelEffectEasing.BackOut:
                    return ReelAxisEffect.backOut;
                default:
                    throw new Error(
                        `Unsupported ReelEffectEasing: ${String(easing)}.`,
                    );
            }
        }

        // ───────────────── 緩動（0～1 的進度 → 實際進度） ─────────────────

        private static quadIn(progress: number): number {
            return progress * progress;
        }

        private static quadOut(progress: number): number {
            return 1 - (1 - progress) * (1 - progress);
        }

        private static quadInOut(progress: number): number {
            return progress < 0.5
                ? 2 * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        }

        private static cubicIn(progress: number): number {
            return progress * progress * progress;
        }

        private static cubicOut(progress: number): number {
            return 1 - Math.pow(1 - progress, 3);
        }

        private static cubicInOut(progress: number): number {
            return progress < 0.5
                ? 4 * progress * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        }

        private static sineIn(progress: number): number {
            return 1 - Math.cos(progress * Math.PI / 2);
        }

        private static sineOut(progress: number): number {
            return Math.sin(progress * Math.PI / 2);
        }

        private static sineInOut(progress: number): number {
            return -(Math.cos(Math.PI * progress) - 1) / 2;
        }

        private static backIn(progress: number): number {
            const overshoot = 1.70158;
            return (overshoot + 1)
                * progress * progress * progress
                - overshoot * progress * progress;
        }

        private static backOut(progress: number): number {
            const overshoot = 1.70158;
            const shifted = progress - 1;
            return 1
                + (overshoot + 1) * shifted * shifted * shifted
                + overshoot * shifted * shifted;
        }
    }
}
