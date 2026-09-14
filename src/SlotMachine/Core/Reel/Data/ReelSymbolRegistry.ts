/** 一種 Symbol 固定占用的 Cell 數量。 */
export interface ReelSymbolCellDefinition {
    readonly symbolId: number;
    readonly cellSpan: number;

    /**
     * 同一 Reel Container 內的顯示排序權重。
     *
     * 數字越大越晚繪製；未設定時使用 0。
     * 此值不是 Cocos Node.layer，也不是絕對 siblingIndex。
     */
    readonly displayPriority?: number;
}

/**
 * 保存 Symbol ID 與占用 Cell 數量的關係。
 *
 * SymbolData 只描述「這次要顯示哪張牌」；尺寸規則統一由此處管理，
 * 避免同一 Symbol ID 在不同資料中帶入互相矛盾的 cellSpan。
 */
export class ReelSymbolRegistry {
    private readonly _cellSpans = new Map<number, number>();
    private readonly _displayPriorities = new Map<number, number>();

    public register(definitions: ReelSymbolCellDefinition[]): void {
        for (const definition of definitions) {
            if (!Number.isInteger(definition.symbolId)) {
                throw new Error("symbolId must be an integer.");
            }

            if (
                !Number.isInteger(definition.cellSpan)
                || definition.cellSpan <= 0
            ) {
                throw new Error("cellSpan must be a positive integer.");
            }

            const displayPriority =
                definition.displayPriority !== undefined
                    ? definition.displayPriority
                    : 0;

            if (!Number.isInteger(displayPriority)) {
                throw new Error(
                    "displayPriority must be an integer.",
                );
            }

            this._cellSpans.set(
                definition.symbolId,
                definition.cellSpan,
            );
            this._displayPriorities.set(
                definition.symbolId,
                displayPriority,
            );
        }
    }

    public getCellSpan(symbolId: number): number {
        const cellSpan = this._cellSpans.get(symbolId);

        if (cellSpan === undefined) {
            throw new Error(
                `Symbol ID ${symbolId} has not registered its cellSpan.`,
            );
        }

        return cellSpan;
    }

    /** 取得 Symbol 在同一軸 Icon Container 內的顯示排序權重。 */
    public getDisplayPriority(symbolId: number): number {
        const priority = this._displayPriorities.get(symbolId);
        return priority !== undefined ? priority : 0;
    }

    /**
     * 目前已註冊的最大 cellSpan。
     *
     * BaseReel 用它決定進場／退場 buffer 各要幾格：整組必須能完整
     * 容納在 buffer 內，玩家才不會看到 group 組裝到一半的樣子。
     *
     * 多軸情境建議由 Config 明寫 maxCellSpan 覆蓋此值 —— 否則某一軸
     * 的牌庫剛好沒有大牌時，該軸的 strip 會比其他軸短，Turbo 同步
     * 停輪的幾何前提就不成立。
     *
     * 尚未註冊任何 Symbol 時回傳 1。
     */
    public getMaxCellSpan(): number {
        let maxCellSpan = 1;

        this._cellSpans.forEach((cellSpan) => {
            if (cellSpan > maxCellSpan) {
                maxCellSpan = cellSpan;
            }
        });

        return maxCellSpan;
    }

    public clear(): void {
        this._cellSpans.clear();
        this._displayPriorities.clear();
    }
}
