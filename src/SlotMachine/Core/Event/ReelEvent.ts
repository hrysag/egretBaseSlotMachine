namespace slot_core {
    /**
     * `BaseReel` 對外的通知。
     *
     * 每格、每半格都可能發出；沒人聽時單軸不建立事件物件。
     */
    export class ReelEvent extends egret.Event {
        /** 第一或第二個半 Cell 完成時。帶 `completedHalf`（1 或 2）。 */
        public static readonly HALF_CELL_COMPLETE: string = "halfCellComplete";

        /** 一個完整 Cell Movement 完成時。 */
        public static readonly CELL_MOVEMENT_COMPLETE: string = "cellMovementComplete";

        /** 本軸已進入 Rolling 且第一個 Cell Movement 已排入後。 */
        public static readonly ROLL_STARTED: string = "rollStarted";

        /**
         * 本軸已在完整 Cell 邊界進入 Stopped 後。帶 `stopMode`。
         *
         * 只代表 Reel 停止移動；停止效果完成是 `STOP_EFFECT_COMPLETED`。
         */
        public static readonly ROLL_STOPPED: string = "rollStopped";

        /** 正式結果停止後開始播放停止效果時。 */
        public static readonly STOP_EFFECT_STARTED: string = "stopEffectStarted";

        /** 停止效果已回到正式停止位置時。 */
        public static readonly STOP_EFFECT_COMPLETED: string = "stopEffectCompleted";

        /** 啟動效果完成、第一個 Cell Movement 即將排入時。 */
        public static readonly START_EFFECT_COMPLETED: string = "startEffectCompleted";

        /**
         * 某一格完成新資料綁定與位置計算後。帶 `runtime`、`previousData`。
         *
         * View 可在此更新顯示；BaseReel 本身不操作任何顯示物件。
         */
        public static readonly REEL_DATA_CHANGED: string = "reelDataChanged";

        /** 完成的是第幾個半 Cell；只有 `HALF_CELL_COMPLETE` 有意義。 */
        public completedHalf: number = 0;

        /** 停止方式；只有 `ROLL_STOPPED` 有意義。 */
        public stopMode: ReelStopMode = ReelStopMode.ResultAligned;

        /** 換了資料的那一格；只有 `REEL_DATA_CHANGED` 有值。 */
        public runtime: ReelSymbolRuntime | null = null;

        /** 那一格原本的資料；只有 `REEL_DATA_CHANGED` 有值。 */
        public previousData: SymbolData | null = null;

        public constructor(
            type: string,
            bubbles: boolean = false,
            cancelable: boolean = false,
        ) {
            super(type, bubbles, cancelable);
        }
    }
}
