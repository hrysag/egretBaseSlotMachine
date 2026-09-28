import { ReelIconDirection } from "../../Core/Reel/Config/ReelIconDirection";
import { MovementEasing } from "../../Core/Reel/Internal/BaseMovement";

/**
 * BaseDropReel 初始化所需的設定。
 *
 * 幾何欄位與 `BaseReelConfig` 同名同義；滾動才有的啟動／停止效果不在這裡。
 * （`BaseReelConfig` 混著幾何與效果，之後若要共用再把幾何那一半拆出來，
 * 見 Drop-Module-Readiness §7.6 末段。）
 */
export interface DropReelConfig {
    /** 使用 Y 軸或 X 軸排列；預設為 Vertical。 */
    readonly layoutType?: ReelIconDirection;

    /** 反轉掉落方向；與滾動相同，牌一律往退場端掉。 */
    readonly inverseDirection?: boolean;

    /** 可視區的 Cell 數量。 */
    readonly visibleCellCount: number;

    /** 一個 1×1 Cell 在軸上的長度。 */
    readonly cellSize: number;

    /** 相鄰 Cell 的額外間距，預設為 0。 */
    readonly cellSpacing?: number;

    /** 進場／退場 buffer 各自的 Cell 數；未設定時取 Registry 的最大 cellSpan。 */
    readonly maxCellSpan?: number;

    /** 位置對齊允許的浮點誤差，預設為 0.0001。 */
    readonly alignmentEpsilon?: number;

    /**
     * 掉一格所需秒數。
     *
     * 等速不等時（與 v3 相同）：掉 n 格就花 `n × moveInterval`。
     */
    readonly moveInterval: number;

    /** 掉落的 easing；未設定時為等速。 */
    readonly easing?: MovementEasing;
}
