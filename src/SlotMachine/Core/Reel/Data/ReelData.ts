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
 * 「我在哪」—— 每一幀都會重新推給 Icon。
 *
 * BaseReelIcon 不需要知道 Reel 是水平、垂直、正向或反向；
 * 方向與座標轉換由 ReelIconManager 統一處理完才送過來。
 *
 * 尺寸與 group 歸屬不在這裡 —— 那些只有換人才變，走 ReelIconCell。
 */
export interface ReelIconLayout {
    readonly x: number;
    readonly y: number;

    /**
     * 本格在 `BaseReel.symbols` / `BaseReel.icons` 上的索引。
     *
     * 每次交接都會變 —— Icon 跟著資料一起輪轉（與 Cocos 版相同），
     * 同一個 Icon 一路往退場端走、索引每格加一，走出去之後回到 0
     * （進場端）換上新資料。因此這個值每幀都由 ReelIconManager 重推，
     * 不由 Icon 自己記住。
     *
     * 有了它，Icon 自己就算得出 head 在哪：
     * `headIndex = layout.index - cell.groupOffset`。
     * 但要取整組請用 `BaseReel.getGroupIcons()` —— head 尚未進場時
     * headIndex 會是負數，直接拿去 `Array.slice()` 會從陣列尾端倒數。
     */
    readonly index: number;
}

/**
 * 「我是什麼」—— 只有這一格換人才會重新推給 Icon。
 *
 * 位置每幀都在變，但「我是 head 還是 follower、這組多長、要畫在第幾層」
 * 只有交接把新資料綁上來時才變。分成兩個介面，遊戲端昂貴的換圖與
 * 改尺寸才不必每幀重算一次。
 *
 * 三個欄位都是投影，不是第二份真相：`groupOffset` 來自
 * `ReelSymbolRuntime`，`cellSpan` 與 `displayPriority` 每次都由
 * `ReelSymbolRegistry` 重新取得，因此 registry 中途被重新註冊時
 * 會在下一次同步自動跟上。
 */
export interface ReelIconCell {
    /** 同 ReelSymbolRuntime.groupOffset；`0` 為 head，大於 `0` 為 follower。 */
    readonly groupOffset: number;

    /**
     * 本格所屬 group 應該占幾格。
     *
     * head 據此決定大圖尺寸（`cellSpan * cellPitch`，往退場方向延伸）。
     * 這是「應該」的長度，不是「目前 strip 上有幾格」—— 一個 group
     * 進場或出場時會有幾格還在 strip 外。
     */
    readonly cellSpan: number;

    /** 同一軸 Icon 容器內的繪製排序權重；未註冊時為 0。 */
    readonly displayPriority: number;
}
