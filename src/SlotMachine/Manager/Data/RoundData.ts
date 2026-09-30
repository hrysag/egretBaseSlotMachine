namespace slot_manager {
    /**
     * 一次消除：消哪些格、補進來的新牌（GameViewManager-Reference-Study §9 G4）。
     *
     * 框架只定這個樣式；伺服器怎麼送由遊戲層轉手。
     */
    export interface RoundCascade {
        /** 每軸一份，畫面閱讀順序的格子位置；大圖露出的格子要全部列上。 */
        readonly removePositions: number[][];

        /** 每軸一份，畫面閱讀順序；張數 = 該軸消掉的格數。 */
        readonly refillCells: slot_core.SymbolData[][];
    }

    /** 一個 round 的資料（§9 G3／G4）。 */
    export interface RoundData {
        /** 遊戲自訂的狀態（NG／FG／bonus……）；框架不解讀，原樣傳給各環節。 */
        readonly state: any;

        /** 初始盤面：每軸一份，畫面閱讀順序。 */
        readonly board: slot_core.SymbolData[][];

        /** 依序的每一次消除；沒有消除時省略或給空陣列。 */
        readonly cascades?: RoundCascade[];
    }

    /** 五個環節（§9 G5）。 */
    export enum RoundStage {
        /** 每一 round 開始前：設定這個 round 要用的資料。 */
        RoundStart = 1,

        /** 旋轉前／掉入前／消除前：可依模式再改各軸的演出。 */
        BeforeStep = 2,

        /** 旋轉中／掉入中／消除中。 */
        Step = 3,

        /** 旋轉結束／掉入結束／掉落結束：全部到位（滾輪含停止效果播完）。 */
        AfterStep = 4,

        /** 每一 round 結束；同時代表「需要下一個 round 的資料」（G10）。 */
        RoundEnd = 5,
    }

    /**
     * 環節 2～4 的所在位置。
     *
     * 初始盤面是第 0 步，第 k 次消除是第 k 步；1 與 5 每個 round 只走一次，
     * 2～4 每一步各走一遍（§9 G5）。
     */
    export interface RoundStepContext {
        readonly round: RoundData;

        /** 0 = 初始盤面；k = 第 k 次消除（對應 `round.cascades[k - 1]`）。 */
        readonly stepIndex: number;
    }

    /** round 資料相關的常數。 */
    export class RoundDataConst {
        /** 逐軸事件發生時，這個 round 的資料還沒到（§10.5）。 */
        public static readonly PENDING_STEP_INDEX: number = -1;
    }

    /**
     * 逐軸事件（§10.5）附帶的所在位置。
     *
     * 滾輪一局的第一個 round 在資料到之前就起轉，那時的起轉事件沒有 round 可附：
     * `round` 為 `null`、`stepIndex` 為 `RoundDataConst.PENDING_STEP_INDEX`。
     */
    export interface RoundReelEventContext {
        readonly round: RoundData | null;

        /** 同 `RoundStepContext.stepIndex`；資料還沒到時為 `RoundDataConst.PENDING_STEP_INDEX`。 */
        readonly stepIndex: number;
    }
}
