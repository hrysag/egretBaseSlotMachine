import { ReelEffectConfig } from "./ReelEffectConfig";
import { ReelIconDirection } from "./ReelIconDirection";
import { BaseReelIcon } from "../BaseReelIcon";

/** 由遊戲提供的 Icon 載體建構器。 */
export type ReelIconFactory = () => BaseReelIcon;

/**
 * 單軸 Icon 顯示設定。
 *
 * 對應 Cocos 版 `ReelIconDisplayConfig.prefab`：那裡註明「Reel 固定
 * 建立的外層**載體** Prefab，根節點必須掛有 BaseReelIcon」，並特地
 * 聲明 Sprite／Spine／Animation 等 **Symbol 美術**由載體另外接收，
 * 不走這個欄位。Egret 沒有 Prefab，載體改由建構器提供，但「載體與
 * 美術是兩個注入點」這件事不變。
 *
 * Cocos 版的 `container` 已經不需要 —— BaseReel 本身就是
 * eui.Component，Icon 直接掛在自己底下（Cocos 那邊的預設值也是
 * `this.node`）。
 */
export interface ReelIconDisplayConfig {
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
     * 各軸不必一致 —— Turbo 同步是把剩餘的半格數補齊，幾何差異會被
     * 補牌吸收（實測見主線 doc §2.4 的更正）。真正必須一致的是
     * fastMode 各軸的 moveInterval，那由 BaseSlotMachine 守門。
     *
     * 仍然建議明寫：讓某一軸的牌庫剛好沒有大牌時，strip 長度不會
     * 隨牌庫悄悄改變，排錯時比較好對照。
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
