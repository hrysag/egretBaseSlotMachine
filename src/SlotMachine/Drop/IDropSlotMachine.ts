namespace slot_drop {
    /**
     * 流程層（manager）看到的掉落機台。
     *
     * 只列流程層實際用到的入口；逐軸通知以 `DropEvent` 監聽。
     * 實作者：`BaseDropSlotMachine`。
     */
    export interface IDropSlotMachine extends egret.IEventDispatcher {
        /** 是否有掉落指令還沒結束。 */
        readonly dropping: boolean;

        /** 是否全部軸都已掉出（可視區是空的）。 */
        readonly allReelsDroppedOut: boolean;

        dropOut(fastMode?: boolean): Promise<void>;

        dropIn(
            boards: slot_core.SymbolData[][],
            fastMode?: boolean,
        ): Promise<void>;

        dropRefill(
            removePositions: number[][],
            refillCells: slot_core.SymbolData[][],
        ): Promise<void>;

        quickStop(): void;
    }
}
