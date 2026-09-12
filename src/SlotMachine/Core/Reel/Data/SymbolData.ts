/** Symbol 美術資源的實際尺寸。 */
export interface SymbolVisualSize {
    readonly width: number;
    readonly height: number;
}

/**
 * 遊戲用來辨識一張 Symbol 的原始資料。
 *
 * BaseReel 會保留原始資料參考；遊戲可繼承此介面加入額外欄位。
 */
export interface SymbolData {
    /** 遊戲定義的 Symbol ID。 */
    readonly id: number;

    /** 選用的美術實際尺寸，只作驗證或顯示參考。 */
    readonly visualSize?: SymbolVisualSize;
}
