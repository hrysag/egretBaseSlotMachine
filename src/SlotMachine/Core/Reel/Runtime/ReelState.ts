namespace slot_core {
    /**
     * 單一 Reel 目前所處的生命週期狀態。
     *
     * State 只描述 Reel 正在做什麼；收到停止要求後要採用哪一種停止方式，
     * 則由 ReelStopMode 獨立描述，避免狀態與停止策略互相綁死。
     */
    export enum ReelState {
        Idle = "idle",
        Rolling = "rolling",
        Stopping = "stopping",
        Stopped = "stopped",
    }

    /** Reel 收到停止要求時所使用的策略。 */
    export enum ReelStopMode {
        /**
         * 正式遊戲使用的結果對齊停止。
         *
         * 只有正式結果完整覆蓋可視 Cell，且 ID、cellSpan 與位置全部對齊後才能停止。
         */
        ResultAligned = "result-aligned",

        /**
         * 即停策略。
         *
         * 不硬切目前正在執行的 Movement，而是完成當前完整 Cell 後停止；
         * 此模式不要求正式結果完整對齊。
         *
         * Immediate 不等於玩家急停。玩家急停仍需保留正式結果，
         * 只略過結果前不必要的亂數資料，最後仍以 ResultAligned 完成停止。
         */
        Immediate = "immediate",
    }
}
