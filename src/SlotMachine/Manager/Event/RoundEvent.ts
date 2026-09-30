namespace slot_manager {
    /**
     * `BaseRoundManager` 對外的通知（GameViewManager-Reference-Study §9 G10）。
     *
     * 給沒有繼承 manager 的外部物件（Controller、UI）；manager 發了就繼續，不等。
     */
    export class RoundEvent extends egret.Event {
        /**
         * 五個環節各自進入時。帶 `stage`、`context`。
         *
         * `RoundEnd` 同時代表「需要下一個 round 的資料」。
         */
        public static readonly STAGE_ENTER: string = "stageEnter";

        /** 整局結束時一次（相當於 1016 的 `SHOW_END`）；在 `startGame()` resolve 之前發出。 */
        public static readonly GAME_END: string = "gameEnd";

        /** 進入的環節；只有 `STAGE_ENTER` 有意義。 */
        public stage: RoundStage = RoundStage.RoundStart;

        /** 所在位置；只有 `STAGE_ENTER` 有值。 */
        public context: RoundStepContext | null = null;

        public constructor(
            type: string,
            bubbles: boolean = false,
            cancelable: boolean = false,
        ) {
            super(type, bubbles, cancelable);
        }
    }
}
