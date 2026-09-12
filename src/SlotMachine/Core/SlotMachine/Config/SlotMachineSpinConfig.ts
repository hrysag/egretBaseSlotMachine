/** BaseSlotMachine 使用的模式識別字，由遊戲自行定義內容。 */
export type SpinMode = string;

/** 單一 Reel 在本輪使用的聽牌設定。 */
export interface ListenReelConfig {
    /** BaseSlotMachine 內的 Reel 索引。 */
    reelIndex: number;

    /** 從聽牌真正開始，到該軸停止所持續的秒數。 */
    duration: number;

    /** 聽牌期間的速度倍率；1 維持原速，大於 1 加速。 */
    speedMultiplier: number;
}

/** 單軸在一個 Spin mode 中使用的開始與運行時間。 */
export interface SlotMachineReelTiming {
    /** 對應 BaseSlotMachine Reel 清單中的索引。 */
    readonly reelIndex: number;

    /** 相對前一個啟動 Reel 的等待秒數；第一軸通常為 0。 */
    readonly startDelaySeconds: number;

    /** 本軸從 startRoll() 起算的目標運作秒數。 */
    readonly targetStopSeconds: number;

    /** 該軸移動一個完整 Cell 所需秒數。 */
    readonly moveIntervalSeconds: number;
}

/** 一種 Spin mode 的完整多軸時間設定。 */
export interface SlotMachineSpinConfig {
    /**
     * 快速模式會在同一個同步迴圈內啟動所有 Reel，
     * 不等待各軸的 startDelaySeconds。
     */
    fastMode: boolean;

    /** 啟動上拉與停止 Bounce 的時間倍率；未設定時為 1。 */
    effectTimeScale?: number;

    /** 依陣列順序啟動及控制的 Reel。 */
    readonly reelTimings: SlotMachineReelTiming[];

}
