namespace slot_drop {
    /**
     * 掉落的通知：機台（`BaseDropSlotMachine`）發逐軸的開始／到位，
     * 單軸（`BaseDropReel`）發自己的開始／到位。
     *
     * 沒人聽時不建立事件物件。
     */
    export class DropEvent extends egret.Event {
        /**
         * 機台：單軸開始掉落。帶 `reelIndex`、`reel`。
         *
         * 這批裡沒有要掉的軸（例如補牌時沒有要消的軸）不發。
         */
        public static readonly REEL_DROP_STARTED: string = "reelDropStarted";

        /**
         * 機台：單軸掉落到位（包含急停直接到位）。帶 `reelIndex`、`reel`。
         *
         * 在這批的 Promise resolve 之前發出。
         */
        public static readonly REEL_DROP_COMPLETED: string = "reelDropCompleted";

        /** 單軸：一次掉落開始。 */
        public static readonly DROP_STARTED: string = "dropStarted";

        /** 單軸：一次掉落全部到位；在這次掉落的 Promise resolve 之前發出。 */
        public static readonly DROP_COMPLETED: string = "dropCompleted";

        /** 哪一軸；單軸自己發的通知為 -1。 */
        public reelIndex: number = -1;

        /** 哪一軸；單軸自己發的通知為 null（發送者就是 `target`）。 */
        public reel: BaseDropReel | null = null;

        public constructor(
            type: string,
            bubbles: boolean = false,
            cancelable: boolean = false,
        ) {
            super(type, bubbles, cancelable);
        }
    }
}
