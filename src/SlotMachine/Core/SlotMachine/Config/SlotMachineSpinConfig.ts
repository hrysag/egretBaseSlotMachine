namespace slot_core {
    /** BaseSlotMachine 使用的模式識別字，由遊戲自行定義內容。 */
    export type SpinMode = string;

    /** 單一 Reel 在本輪使用的聽牌設定。 */
    export interface ListenReelConfig {
        /** BaseSlotMachine 內的 Reel 索引。 */
        reelIndex: number;

        /**
         * 聽牌持續的秒數：從停止順序中前一軸的**規劃**停輪時刻起算，到本軸停止。
         *
         * 加速時會多走幾格把時間補回 duration（決議 42）；fastMode 或急停時
         * 框架不排聽牌時間，但 SlotMachineEvent.LISTEN_START／LISTEN_END 照發。
         */
        duration: number;

        /**
         * 聽牌期間的速度倍率；1 維持原速，大於 1 加速。**必須 `>= 1`**，框架
         * 不支援聽牌減速。
         *
         * 加速在規劃時就排在「不晚於聽牌開始的最後一個 Cell 邊界」；聽牌途中
         * 急停依照當下速度走完（已加速就維持，尚未加速就不再加速）。
         */
        speedMultiplier: number;
    }

    /**
     * 單軸在一個 Spin mode 中使用的開始與運行時間。
     *
     * ## 填值前必須知道的一件事：停輪時間會被量化
     *
     * 停輪只能發生在完整 Cell 邊界（主線 doc 決議 15），所以框架會把剩餘
     * 時間量化成整數格。量化一律**向下取整**（`ReelStopFlow` 內兩個
     * `Math.floor`），語意是：
     *
     * > **實際停輪不晚於 `targetStopSeconds`，最壞早一個 `moveIntervalSeconds`。**
     *
     * 誤差範圍 `(−1 格, 0]`，**永遠不會晚**。選早停而不是就近取整（誤差可
     * 砍半成 ±0.5 格），是因為企劃真正在意的是「整輪要在 N 秒內停完」這條
     * **上界** —— 只會早不會晚，整輪才不可能超出預算。
     *
     * 1596 組實測，零違反。換算成畫面（專案 `frameRate = 30`）：
     *
     * | `moveIntervalSeconds` | 最壞誤差 | ≈ 幾個畫格 |
     * |---|---|---|
     * | 0.016 | 0.016s | 0.5　← 低於一個畫格，看不出來 |
     * | 0.05  | 0.05s  | 1.5 |
     * | 0.08  | 0.08s  | 2.4 |
     * | 0.12  | 0.12s  | 3.6 |
     *
     * 這只影響**何時**停，不影響**停在哪** —— 盤面永遠是送進來的結果。
     */
    export interface SlotMachineReelTiming {
        /** 對應 BaseSlotMachine Reel 清單中的索引。 */
        readonly reelIndex: number;

        /**
         * 相對前一個啟動 Reel 的等待秒數；第一軸通常為 0。
         *
         * **填值建議：設成 `moveIntervalSeconds` 的整數倍。**
         *
         * 各軸的停輪時刻是各自量化的，誤差各在 `(−1 格, 0]`，所以**相鄰兩軸
         * 的實際間隔**是兩個誤差相減 —— 範圍 `(−1 格, +1 格)`，是單軸的兩倍
         * 且雙向。`mi = 0.08` 時就是 ±2.4 個畫格，看得出來抖。
         *
         * 比值整除時兩軸量化到同相位，間隔誤差趨近 0。實測 `staggerStart`
         * 與 `moveInterval` 整除的組合誤差只有 ±0.004 格。
         *
         * ```text
         * moveInterval 0.08  →  0.16 / 0.24 / 0.32
         * moveInterval 0.05  →  0.15 / 0.20 / 0.25
         * ```
         *
         * 反例：1016 的 `staggerStop 0.2` 對 `moveInterval 0.053`（比值 3.77），
         * 不整除所以軸間隔會抖。
         *
         * 框架**不擋**非整數倍，這只是填值建議。
         */
        readonly startDelaySeconds: number;

        /**
         * 本軸從 startRoll() 起算的目標運作秒數。
         *
         * **有物理下限**：正式結果的第一格要走完
         * `firstVisibleIndex + visibleCellCount − 1` 次交接才進得了可視段，
         * 再加上退場端截斷要墊的格數（隨盤面變動）。也就是
         *
         * ```text
         * 下限 ≈ (maxCellSpan + visibleCellCount − 1 + 退場端墊格) × moveIntervalSeconds
         * ```
         *
         * 填得比下限小（或伺服器結果晚到）不會報錯：資料到達時框架沿停止順序
         * 推算，每軸 = max(本值, 前一軸停輪 + 軸間隔, 本軸最早能停)，所以
         * 停輪順序與軸間隔照樣保留，只是整體從「最早能停」起算。
         */
        readonly targetStopSeconds: number;

        /**
         * 該軸移動一個完整 Cell 所需秒數。
         *
         * 這個值同時是**停輪時間的量化粒度**（見本介面開頭），所以它愈小、
         * 時間愈準。`fastMode` 的各軸必須相同，否則 Turbo 同步停輪不成立
         * （由 `BaseSlotMachine.assertUniformMoveInterval()` 守門）。
         */
        readonly moveIntervalSeconds: number;
    }

    /**
     * 單軸在停止順序中的位置與間隔（主線 doc 決議 44）。
     *
     * 與 `SlotMachineReelTiming.startDelaySeconds` 對稱：陣列順序就是停止
     * 順序，每軸相對停止順序中的前一軸再等 `stopDelaySeconds` 秒。
     */
    export interface SlotMachineReelStopTiming {
        /** 對應 BaseSlotMachine Reel 清單中的索引。 */
        readonly reelIndex: number;

        /**
         * 相對停止順序中前一軸的停輪間隔秒數；第一軸不使用。
         *
         * **`fastMode`（Turbo）時一律當 0**，與 `startDelaySeconds` 在 Turbo
         * 被略過同理（見 `SlotMachineSpinConfig.fastMode`）。
         *
         * 伺服器結果晚到時，間隔從前一軸**實際**停下起算，照樣保留。
         */
        readonly stopDelaySeconds: number;
    }

    /** 一種 Spin mode 的完整多軸時間設定。 */
    export interface SlotMachineSpinConfig {
        /**
         * 快速模式（Turbo）：所有 Reel 同時啟動、同時停。
         *
         * - 不等待各軸的 `startDelaySeconds`（全軸 0 秒啟動）
         * - **停止間隔為 0**：`stopTimings` 的 `stopDelaySeconds` 一律當 0，
         *   只保留停止**順序**（同一幀停下時回調照它發）
         * - **全軸同一刻停**：資料到時全軸排到其中最晚的那一刻 —— 各軸
         *   `targetStopSeconds` 不同時取最晚的；某軸盤面要多墊格、比較晚才能停
         *   時，其他軸都等它。急停也是全軸一起縮短
         *
         * 與 1016 相同（資料到時補牌數全盤取最大值）。
         */
        fastMode: boolean;

        /** 啟動上拉與停止 Bounce 的時間倍率；未設定時為 1。 */
        effectTimeScale?: number;

        /**
         * 依陣列順序啟動的 Reel；未設定 `stopTimings` 時也是停止順序。
         */
        readonly reelTimings: SlotMachineReelTiming[];

        /**
         * 停止順序與間隔；未設定時停止順序等於 `reelTimings` 的順序。
         *
         * 設定後，停止順序中的**第一軸**停在「自己的實際啟動時刻 +
         * `targetStopSeconds`」，之後每軸 = 前一軸 + `stopDelaySeconds`；
         * 其餘軸的 `targetStopSeconds` 不使用。`reelIndex` 必須與
         * `reelTimings` 一對一。用途：同時啟動、依序停止（例如右到左）。
         *
         * `fastMode`（Turbo）時只用它的順序，間隔一律為 0。
         */
        readonly stopTimings?: SlotMachineReelStopTiming[];
    }
}
