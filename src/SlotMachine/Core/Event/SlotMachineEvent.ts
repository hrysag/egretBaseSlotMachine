namespace slot_core {
    /**
     * `BaseSlotMachine` 對外的通知。
     *
     * 發送時機與順序見各常數；沒人聽時機台不建立事件物件。
     */
    export class SlotMachineEvent extends egret.Event {
        /** 控制器呼叫單軸 `startRoll()` 後。帶 `reelIndex`、`reel`。 */
        public static readonly REEL_STARTED: string = "reelStarted";

        /** 本輪全部有效軸都已啟動後。 */
        public static readonly ALL_REELS_STARTED: string = "allReelsStarted";

        /** 單軸完成停止後（對齊結果那一刻）。帶 `reelIndex`、`reel`、`stopMode`。 */
        public static readonly REEL_STOPPED: string = "reelStopped";

        /** 本輪全部有效軸完成停止後。 */
        public static readonly ALL_REELS_STOPPED: string = "allReelsStopped";

        /** 指定軸真正進入本輪聽牌狀態時。帶 `reelIndex`、`reel`。 */
        public static readonly LISTEN_START: string = "listenStart";

        /** 指定軸完成本輪聽牌並停止時。帶 `reelIndex`、`reel`。 */
        public static readonly LISTEN_END: string = "listenEnd";

        /** 哪一軸；整台的通知為 -1。 */
        public reelIndex: number = -1;

        /** 哪一軸；整台的通知為 null。 */
        public reel: BaseReel | null = null;

        /** 停止方式；只有 `REEL_STOPPED` 有意義。 */
        public stopMode: ReelStopMode = ReelStopMode.ResultAligned;

        public constructor(
            type: string,
            bubbles: boolean = false,
            cancelable: boolean = false,
        ) {
            super(type, bubbles, cancelable);
        }
    }
}
