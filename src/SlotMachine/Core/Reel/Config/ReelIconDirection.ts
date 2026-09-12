/**
 * Reel 的排列軸向。
 *
 * 與 `inverseDirection` 組合成四種滾動方向：
 * 垂直正向（上→下）、垂直反向（下→上）、
 * 水平正向（左→右）、水平反向（右→左）。
 *
 * 只影響「軸向數值映射到哪一個座標軸」這一步；幾何運算本身
 * 不含方向 —— 軸向座標一律往退場方向遞增。
 *
 * 原本定義在 ReelConfig.ts，與 Prefab／容器等顯示設定放在同一檔。
 * 移植時拆成獨立檔案，讓顯示映射不必相依尚未移植的引擎型別。
 */
export enum ReelIconDirection {
    Vertical,
    Horizontal,
}
