namespace slot_core {
    /**
     * 流程層（manager）看到的滾輪機台。
     *
     * 只列流程層實際用到的入口；逐軸通知以 `SlotMachineEvent` 監聽。
     * 實作者：`BaseSlotMachine`。
     */
    export interface ISlotMachine extends egret.IEventDispatcher {
        /** 是否在轉（起轉到全部停下之間）。 */
        readonly spinning: boolean;

        startSpin(
            mode: SpinMode,
            reelIndexes?: number[],
        ): Promise<void>;

        stopSpin(resultByReel: SymbolData[][]): Promise<void>;

        quickStop(): void;

        waitForSettledAsync(): Promise<void>;
    }
}
