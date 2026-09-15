import { BaseSlotMachine } from "../SlotMachine/Core/BaseSlotMachine";
import { BaseReel } from "../SlotMachine/Core/Reel/BaseReel";
import { ReelIconDirection } from "../SlotMachine/Core/Reel/Config/ReelIconDirection";
import { ReelLayoutSource } from "../SlotMachine/Core/Reel/Data/ReelData";
import { SlotMachineReelTiming } from "../SlotMachine/Core/SlotMachine/Config/SlotMachineSpinConfig";
import { TestReelIcon } from "./TestReelIcon";
import {
    symbolDataList,
    testCellDefinitions,
    TEST_CELL_PITCH,
} from "./TestSymbolTable";

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
export class TestSlotMachine extends BaseSlotMachine {

    /** 對應 Cocos 版的 @property 欄位。 */
    private readonly _visibleCellCount = 3;
    private readonly _cellSize = TEST_CELL_PITCH;
    private readonly _normalMoveInterval = 0.08;
    private readonly _staggerStart = 0.1;
    private readonly _targetStopTime = 1.6;

    private readonly _startEffectEnabled = true;
    private readonly _startEffectDistance = 50;
    private readonly _startEffectOutwardDuration = 0.2;
    private readonly _startEffectReturnDuration = 0.1;

    private readonly _stopEffectEnabled = true;
    private readonly _stopEffectDistance = 50;
    private readonly _stopEffectOutwardDuration = 0.2;
    private readonly _stopEffectReturnDuration = 0.1;

    /**
     * 本軸的滾動方向，由場景在建構時指定。
     *
     * 只用來組 `BaseReel.init()` 的 config —— **不要拿它推導別的東西**。
     * Icon 需要的「退場方向是不是正向」要向 reel 問
     * （`reel.exitTowardPositiveAxis`），見 createIcon()。
     */
    public constructor(
        private readonly _layoutType = ReelIconDirection.Vertical,
        private readonly _inverseDirection = false,
    ) {
        super();
    }

    /** 本模式使用的 Spin mode 名稱，場景按鈕用得到。 */
    public get normalMode(): string {
        return "normal";
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
                moveInterval: this._normalMoveInterval,
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
    }

    protected applyInitialLayout(): void {
        /*
         * 三段各自獨立驗證展開後的 Cell 數：
         * entryBuffer 與 exitBuffer 各要 maxCellSpan（= 3，因為 073 是 1×3），
         * visible 要 visibleCellCount（= 3）。
         */
        const source: ReelLayoutSource = {
            entryBuffer: symbolDataList([73]),
            visible: symbolDataList([1, 2, 3]),
            exitBuffer: symbolDataList([62, 4]),
        };

        for (const reel of this.reelList) {
            reel.setInitialLayout(source);
            reel.configureIconDisplay({
                iconFactory: () => this.createIcon(reel),
            });
        }
    }

    /**
     * 建立 Icon 載體。
     *
     * 對應 Cocos 版 `ReelIconDisplayConfig.prefab` —— 那邊給的是掛有
     * BaseReelIcon 的**載體** Prefab，美術由載體自己另外接收。
     *
     * 方向一律**向 reel 問**，不從自己的 _inverseDirection 推導：
     * `!inverseDirection === 退場在正向` 是框架 mapAxisToLocal() 的
     * 內部慣例，在遊戲層複製一份就是第二份方向推導。
     */
    private createIcon(reel: BaseReel): TestReelIcon {
        return new TestReelIcon(
            reel.exitTowardPositiveAxis,
            reel.layoutType === ReelIconDirection.Vertical,
        );
    }

    private createReelTimings(
        moveInterval: number,
    ): SlotMachineReelTiming[] {
        const result: SlotMachineReelTiming[] = [];

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
