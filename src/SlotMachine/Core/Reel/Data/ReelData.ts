import { SymbolData } from "./SymbolData";

/**
 * 初始盤面資料。
 *
 * 三段各自獨立驗證，展開後的 Cell 數必須分別等於
 * maxCellSpan、visibleCellCount、maxCellSpan。
 *
 * 手寫的初始盤面**不允許**大 Symbol 跨越 buffer 與顯示區的邊界；
 * 被截斷的盤面只會由上一輪滾動自然產生，不經過 setInitialLayout()。
 *
 * entry／exit 以資料流方向命名，四種滾動方向共用同一組欄位，
 * 不使用上下左右等方向相依的字眼。
 */
export interface ReelLayoutSource {
    /** 進場端預備區；展開後的 Cell 數必須等於 maxCellSpan。 */
    readonly entryBuffer: SymbolData[];

    /** 顯示區；展開後的 Cell 數必須等於 visibleCellCount。 */
    readonly visible: SymbolData[];

    /** 退場端預備區；展開後的 Cell 數必須等於 maxCellSpan。 */
    readonly exitBuffer: SymbolData[];
}

/**
 * Strip 上一個 1×1 Cell 的執行期狀態。
 *
 * 每個 Runtime 恆為一格。大於一格的 Symbol 由 N 個連續 Cell 組成一個
 * group，group 內各格以 groupOffset 表示自己離 head 幾格。
 *
 * 位置不存在這裡 —— 由 ReelIconManager 依索引計算：
 *   位置(k) = axis(k) + stripOffset + cellOffset + visualAxisOffset
 */
export interface ReelSymbolRuntime {
    /**
     * BaseReel 只保證 SymbolData 的核心欄位。
     *
     * 遊戲若擴充 SymbolData，取用自訂欄位時需自行轉型：
     * `const gameData = runtime.data as GameReelData;`
     *
     * BaseReel 會保留原始資料參考，不會 clone，也不會移除自訂欄位。
     */
    data: SymbolData;

    /**
     * 本格離 group head 的距離。
     *
     * `0` 代表自己就是 head，負責顯示整張圖，圖沿退場方向延伸
     * `registry.getCellSpan(data.id)` 格；大於 `0` 代表 follower，不顯示。
     *
     * head 位於 group 的進場側，因此是整組中最後進場的一格。
     * 不另外保存 group 總長，需要時查 ReelSymbolRegistry，
     * 以免 reconfigureStoppedLayout() 重新註冊 cellSpan 後留下髒資料。
     */
    groupOffset: number;

    /** BaseReel 內部使用；標記此 Runtime 所屬的正式結果輪次。 */
    resultSpinId?: number;

    /**
     * 本格專屬的額外軸向偏移。
     *
     * 滾動期恆為 `0`（整軸位移由 stripOffset 表示）。
     * 保留給未來的掉落式：掉落時每格移動距離與時間各不相同，
     * 屆時由此欄位承載，stripOffset 則維持 `0`。
     */
    cellOffset: number;
}

/**
 * View 將 Reel 的一維軸向位置映射完成後，交給 Icon 的局部座標。
 *
 * BaseReelIcon 不需要知道 Reel 是水平、垂直、正向或反向；
 * 方向與座標轉換由整軸的 View 統一處理。
 *
 * 尺寸不在這裡 —— Icon 載體恆為 1×1，head 的大圖由遊戲繼承類別
 * 自行查 Registry 決定尺寸與偏移。
 */
export interface ReelIconLayout {
    readonly x: number;
    readonly y: number;

    /** 同 ReelSymbolRuntime.groupOffset；`0` 為 head，大於 `0` 為 follower。 */
    readonly groupOffset: number;
}
