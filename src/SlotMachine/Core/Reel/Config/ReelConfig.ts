import { ReelEffectConfig } from "./ReelEffectConfig";
import { ReelIconDirection } from "./ReelIconDirection";
import { BaseReelIcon } from "../BaseReelIcon";

/** 由遊戲提供的 Icon 載體建構器。 */
export type ReelIconFactory = () => BaseReelIcon;

/**
 * 單軸 Icon 顯示設定。
 *
 * Cocos 版是 `prefab` + `container`；Egret 沒有 Prefab，改成由遊戲
 * 提供一個建構器。要用 exml 編排 Symbol 外觀時，在建構器內建立
 * 繼承 BaseReelIcon 的類別並指定 `skinName` 即可。
 */
export interface ReelIconDisplayConfig {
    /**
     * Icon 的父容器。
     *
     * 建議使用普通的 egret.DisplayObjectContainer；若直接傳 eui.Group，
     * 每次子項增刪與 setChildIndex 都會觸發 invalidateSize() 與
     * invalidateDisplayList()，滾輪每格都要重排，成本會累積。
     */
    readonly container: egret.DisplayObjectContainer;

    /** 建立單一 Icon 載體；會被呼叫 stripCellCount 次。 */
    readonly iconFactory: ReelIconFactory;
}

/**
 * BaseReel 初始化所需的純數值設定。
 *
 * Cocos 版的 `updateMode` 已移除 —— Egret 沒有 Component 的 update()，
 * 一律由上層每幀呼叫 `updateMovement(deltaTime)`。
 */
export interface BaseReelConfig {
    /** 使用 Y 軸或 X 軸排列；預設為 Vertical。 */
    readonly layoutType?: ReelIconDirection;

    /** 反轉目前軸向的滾動方向。 */
    readonly inverseDirection?: boolean;

    /** 可視區必須完整覆蓋的 Cell 數量。 */
    readonly visibleCellCount: number;

    /** 一個 1×1 Cell 在 Reel 軸上的實際長度。 */
    readonly cellSize: number;

    /** 相鄰 Cell 的額外間距，預設為 0。 */
    readonly cellSpacing?: number;

    /**
     * 進場／退場 buffer 各自的 Cell 數。
     *
     * 未設定時由 ReelSymbolRegistry 已註冊的最大 cellSpan 推得。
     * **多軸請明確指定** —— 否則某一軸的牌庫剛好沒有大牌時，該軸的
     * strip 會比其他軸短，Turbo 同步停輪的幾何前提就不成立。
     */
    readonly maxCellSpan?: number;

    /** 位置對齊允許的浮點誤差，預設為 0.0001。 */
    readonly alignmentEpsilon?: number;

    /**
     * 移動一個完整 Cell 所需秒數。
     *
     * 也可稍後由 setRollTiming() 設定；startRoll() 前至少要有一處提供。
     */
    readonly moveInterval?: number;

    /**
     * startRoll() 時播放的反方向拉動效果。
     *
     * 未提供時直接開始滾動，不產生額外顯示偏移。
     */
    readonly startEffect?: ReelEffectConfig;

    /**
     * 正式結果對齊停止後的顯示回彈。
     *
     * 未提供時不播放。與 startEffect 使用同一個設定型別，
     * 差別只在移出方向由 BaseReel 依滾動方向決定。
     */
    readonly stopEffect?: ReelEffectConfig;
}
