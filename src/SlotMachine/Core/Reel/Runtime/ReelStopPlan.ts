namespace slot_core {
    /** Reel 需要取消額外表演資料、讓正式結果盡早進場的原因。 */
    export enum ReelExpediteReason {
        None = "None",
        ServerLate = "ServerLate",
        QuickStop = "QuickStop",
    }

    /** 建立單軸停止計畫需要的純計算資料。 */
    export interface ReelStopPlanInput {
        /** 企劃設定：從 startRoll() 起算的目標停止秒數。 */
        readonly targetStopTime: number;

        /** Server 結果送入時，Reel 已累積運行的秒數。 */
        readonly resultReceivedTime: number;

        /** 移動一個完整基礎 Cell 所需秒數。 */
        readonly moveInterval: number;

        /** 正式結果與必要尾牌完成進場至少需要的 Cell 數。 */
        readonly resultTravelCells: number;

        /** 結果提交當下，既有 Cell Movement 尚未完成的秒數。 */
        readonly currentMovementTime: number;

        /** Start Effect 未推進資料所形成的量化補償秒數。 */

        /**
         * 已依實際 Symbol cellSpan 取得的表演 Cell 數。
         *
         * 未提供時由 Planner 依剩餘時間計算預算；提供時則用來回報
         * 1×N Symbol 量化後真正會執行的停止時間。
         */
        readonly retainedPerformanceCellCount?: number;

        /** 玩家是否已在結果送入前或送入後要求 Quick Stop。 */
        readonly quickStopRequested: boolean;
    }

    /** Server 結果送入時建立的一次性單軸停止計畫。 */
    export interface ReelStopPlan {
        readonly resultReceivedTime: number;
        readonly requestedStopTime: number;
        readonly currentMovementTime: number;
        readonly minimumResultTravelTime: number;
        readonly earliestStopTime: number;
        readonly actualStopTime: number;
        readonly performanceCellCount: number;
        readonly quickStopSkippedDataCount: number;
        readonly quickStopSkippedCellCount: number;
        readonly lateBy: number;
        readonly expediteReason: ReelExpediteReason;
    }
}
