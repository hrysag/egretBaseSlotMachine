namespace slot_test {
    /**
     * 測試用的 SlotMachine。
     *
     * 對應 Cocos 版 `TestSlotMachine`：那邊的欄位掛在 Inspector 上，
     * Egret 沒有 Inspector，改成本類別的常數 —— 值的來源不同，
     * 但「設定集中在繼承類別、場景只按按鈕」這件事一樣。
     *
     * ## 為什麼一定要繼承
     *
     * `BaseSlotMachine` 的三個設定入口 `registerInitialReelData()`、
     * `registerInitialSpinConfigs()`、`applyInitialLayout()` 都是
     * `protected`，而 `registerSpinConfig()` 有 `if (this._inited) throw`。
     * 設定只能在 `init()` 內、經由這三個 Hook 進去。
     *
     * ## 呼叫順序
     *
     * `init(reels)` 依序呼叫三個 Hook，所以：
     *
     * ```text
     * registerInitialReelData()    registerSymbolCells → reel.init → 表演牌庫
     * registerInitialSpinConfigs() registerSpinConfig("normal")
     * applyInitialLayout()         setInitialLayout → configureIconDisplay
     * ```
     *
     * `configureIconDisplay()` 排在 `setInitialLayout()` **之後**，因為
     * `ReelIconManager.initializeIcons()` 依已展開的 strip 長度決定要建
     * 幾個載體。Cocos 版沒有這個順序限制（載體數量另外算），移植後有。
     *
     * ## 範圍
     *
     * 只註冊 `normal` 一種模式、只服務單一軸。`turbo` / `l2`、fastMode
     * 與聽牌等單軸走通之後再加（第二棒交接 §4.6）。
     */
    export class TestSlotMachine extends slot_core.BaseSlotMachine {

        /** 對應 Cocos 版的 @property 欄位。 */
        private readonly _visibleCellCount = 3;
        private readonly _cellSize = TEST_CELL_PITCH;
        /**
         * 明寫而不讓 Registry 自動推導。
         *
         * `BaseReelConfig.maxCellSpan` 的 JSDoc 建議這樣做：自動推導是取
         * 已註冊 cellSpan 的最大值，牌庫一改（例如某軸剛好沒有大牌）
         * strip 長度就會悄悄跟著變，排錯時對不上。073 是 1×3，所以是 3。
         */
        private readonly _maxCellSpan = 3;
        private readonly _normalMoveInterval = 0.08;
        private readonly _turboMoveInterval = 0.05;
        private readonly _l2MoveInterval = 0.016;
        /** L2 的啟動上拉與停止回彈時間倍率；0.15 = 用原時間的 15%。 */
        private readonly _l2EffectTimeScale = 0.15;
        private readonly _staggerStart = 0.1;

        private readonly _startEffectEnabled = true;
        private readonly _startEffectDistance = 50;
        private readonly _startEffectOutwardDuration = 0.2;
        private readonly _startEffectReturnDuration = 0.1;

        private readonly _stopEffectEnabled = true;
        private readonly _stopEffectDistance = 50;
        private readonly _stopEffectOutwardDuration = 0.2;
        private readonly _stopEffectReturnDuration = 0.1;

        /**
         * 本軸的滾動方向，由場景在 `initTest()` 指定。
         *
         * 只用來組 `BaseReel.init()` 的 config —— **不要拿它推導別的東西**。
         * Icon 需要的「退場方向是不是正向」由框架在 `setupCell()` 給
         * （`BaseReelIcon.exitTowardPositiveAxis`）。
         */
        private _layoutType: slot_core.ReelIconDirection = slot_core.ReelIconDirection.Vertical;
        private _inverseDirection = false;

        /**
         * 每軸的目標停輪秒數。預設 0.15 取自 Cocos 參考場景
         * （`SlotMachineTest.scene` 裡 `TestSlotMachine.targetStopTime`）。
         *
         * 它低於所有模式的**物理下限** —— 結果的第一格要走完
         * `(firstVisibleIndex + visibleCellCount - 1)` 次交接才進得了可視段，
         * 也就是 `5 × moveInterval`：normal 0.40s、turbo 0.25s、**L2 0.08s**。
         * 所以三個模式都會被鉗到各自的下限，速度差直接反映成停輪快慢，
         * L2 於是「刷一下就是新盤面」。
         *
         * 設成 1.6 這種遠高於下限的值會讓三個模式都轉滿 1.6 秒，
         * 只剩糊的程度不同 —— 那就看不出模式差異了。
         */
        private _targetStopTime = 0.15;

        /**
         * 記下方向與停輪時間，再 `init(reels)`。
         *
         * 三個值要在 `init()` 內的 Hook 用到，所以一定要經過這裡。
         * 比照 `BaseSlotMachine.init()`：已 init 過時直接略過。
         */
        public initTest(
            reels: slot_core.BaseReel[],
            layoutType: slot_core.ReelIconDirection,
            inverseDirection: boolean,
            targetStopTime: number,
        ): void {
            if (this.inited) {
                return;
            }

            this._layoutType = layoutType;
            this._inverseDirection = inverseDirection;
            this._targetStopTime = targetStopTime;
            this.init(reels);
        }

        /**
         * 每幀通知，給測試場景排自己的時程用（例如模擬 Server 回應延遲）。
         *
         * 對應 Cocos 版 `TestSlotMachine.update()` 裡那段 `resultCommitDelay`
         * 計時 —— 那邊 Cocos 會自動呼叫 Component.update()，Egret 沒有，
         * 而機台層已經有唯一心跳（決議 37 把推進抽成 `update(deltaTime)`），
         * 所以這裡只是把同一份 deltaTime 轉出去，**不另外開第二個心跳**。
         *
         * 時程「內容」屬於流程層，寫在場景；這裡只負責轉送。
         */
        public onUpdate?: (deltaTime: number) => void;

        /**
         * Hook 排在 `super.update()` **之前**。
         *
         * 這樣場景累積的「本輪已經過多久」在同一幀內就已經含入這次的
         * deltaTime，與機台內部的 `_spinElapsed` 對齊 —— 於是 `REEL_STARTED`
         * 在 `super.update()` 裡觸發時，場景記下的時刻才不會少一幀。
         * 排在後面的話，rAF 被節流（一幀 0.1 秒）時那一幀的誤差會很明顯。
         */
        public update(deltaTime: number): void {
            if (this.onUpdate !== undefined) {
                this.onUpdate(deltaTime);
            }

            super.update(deltaTime);
        }

        /** 本模式使用的 Spin mode 名稱，場景按鈕用得到。 */
        public get normalMode(): string {
            return "normal";
        }

        /**
         * Turbo：`fastMode: true`，每格更快，而且**各軸同時啟動**
         * （`BaseSlotMachine.createPendingStarts()` 在 fastMode 下略過
         * `startDelaySeconds`）—— 那是 Turbo 同步停輪的相位前提。
         * 急停的補牌同步（`prepareFastQuickStopPadding()`）也只在這個模式下跑。
         */
        public get turboMode(): string {
            return "turbo";
        }

        /**
         * L2：最快速模式。`moveInterval = 0.016`（約一幀一格），
         * 外加 `effectTimeScale` 把啟動／停止效果壓到 15% —— 否則效果自己的
         * 0.3 秒會比整輪滾動還長。用來壓 Movement 與交接的極端相位。
         */
        public get l2Mode(): string {
            return "l2";
        }

        public get visibleCellCount(): number {
            return this._visibleCellCount;
        }

        protected registerInitialReelData(): void {
            for (const reel of this.reelList) {
                reel.registerSymbolCells(testCellDefinitions());
                reel.init({
                    layoutType: this._layoutType,
                    inverseDirection: this._inverseDirection,
                    visibleCellCount: this._visibleCellCount,
                    cellSize: this._cellSize,
                    maxCellSpan: this._maxCellSpan,
                    /*
                     * 這裡**刻意不填 moveInterval**。
                     *
                     * `BaseReelConfig.moveInterval` 是 optional —— JSDoc 寫明
                     * 「也可稍後由 setRollTiming() 設定；startRoll() 前至少
                     * 要有一處提供」。而 `BaseSlotMachine.startOneReel()` 每輪
                     * 開始前都會依當輪 SpinConfig 呼叫 `setRollTiming()`，
                     * 所以速度的唯一來源就是 registerSpinConfig() 註冊的
                     * `SlotMachineReelTiming.moveIntervalSeconds`。
                     *
                     * 在這裡填 `_normalMoveInterval` 會變成第二份速度來源，
                     * 而且隱含假設第一輪是 normal —— 三個模式各有開始鍵之後
                     * 那個假設就不成立了。
                     */
                    startEffect: {
                        enabled: this._startEffectEnabled,
                        distance: this._startEffectDistance,
                        outwardDuration: this._startEffectOutwardDuration,
                        returnDuration: this._startEffectReturnDuration,
                    },
                    stopEffect: {
                        enabled: this._stopEffectEnabled,
                        distance: this._stopEffectDistance,
                        outwardDuration: this._stopEffectOutwardDuration,
                        returnDuration: this._stopEffectReturnDuration,
                    },
                });

                /* 混合尺寸的表演牌，滾動時才看得出 group 有沒有散掉。 */
                reel.setPerformanceDataBank(
                    symbolDataList([1, 62, 5, 73, 2, 6, 62, 3, 73, 4]),
                );
            }
        }

        protected registerInitialSpinConfigs(): void {
            this.registerSpinConfig(this.normalMode, {
                fastMode: false,
                reelTimings: this.createReelTimings(
                    this._normalMoveInterval,
                ),
            });
            this.registerSpinConfig(this.turboMode, {
                fastMode: true,
                reelTimings: this.createReelTimings(
                    this._turboMoveInterval,
                ),
            });
            this.registerSpinConfig(this.l2Mode, {
                fastMode: true,
                effectTimeScale: this._l2EffectTimeScale,
                reelTimings: this.createReelTimings(
                    this._l2MoveInterval,
                ),
            });
        }

        protected applyInitialLayout(): void {
            /*
             * 三段各自獨立驗證展開後的 Cell 數：
             * entryBuffer 與 exitBuffer 各要 maxCellSpan（= 3，因為 073 是 1×3），
             * visible 要 visibleCellCount（= 3）。
             */
            const source: slot_core.ReelLayoutSource = {
                entryBuffer: symbolDataList([73]),
                visible: symbolDataList([1, 2, 3]),
                exitBuffer: symbolDataList([62, 4]),
            };

            for (const reel of this.reelList) {
                reel.setInitialLayout(source);
                /*
                 * 對應 Cocos 版 `ReelIconDisplayConfig.prefab` —— 那邊給的是掛有
                 * BaseReelIcon 的**載體** Prefab，美術由載體自己另外接收。
                 * 方向由框架在 `setupCell()` 交給載體，這裡不必管。
                 */
                reel.configureIconDisplay({
                    iconClass: "slot_test.TestReelIcon",
                });
            }
        }

        private createReelTimings(
            moveInterval: number,
        ): slot_core.SlotMachineReelTiming[] {
            const result: slot_core.SlotMachineReelTiming[] = [];

            for (
                let reelIndex = 0;
                reelIndex < this.reelList.length;
                reelIndex++
            ) {
                result.push({
                    reelIndex,
                    startDelaySeconds:
                        reelIndex === 0 ? 0 : this._staggerStart,
                    targetStopSeconds: this._targetStopTime,
                    moveIntervalSeconds: moveInterval,
                });
            }

            return result;
        }
    }
}
