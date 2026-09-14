import { SymbolData } from "../SlotMachine/Core/Reel/BaseReel";

/**
 * 測試場景用的 Symbol 對照表。
 *
 * 素材實測尺寸：1×1 為 160×128，062 為 160×256（2 格），
 * 073 為 160×384（3 格）—— 都是精確整數倍。
 *
 * 這裡只服務 src/test，正式遊戲的 Symbol 表由遊戲自己定義。
 */
export interface TestSymbolDefinition {
    readonly id: number;
    readonly resKey: string;
    readonly cellSpan: number;
}

/** 一個 1×1 Cell 的軸向長度。 */
export const TEST_CELL_PITCH = 128;

/** 一條軸的寬度（跨軸方向），與素材寬度相同。 */
export const TEST_COLUMN_WIDTH = 160;

export const TEST_SYMBOLS: TestSymbolDefinition[] = [
    { id: 1, resKey: "symbol_01_png", cellSpan: 1 },
    { id: 2, resKey: "symbol_02_png", cellSpan: 1 },
    { id: 3, resKey: "symbol_03_png", cellSpan: 1 },
    { id: 4, resKey: "symbol_04_png", cellSpan: 1 },
    { id: 5, resKey: "symbol_05_png", cellSpan: 1 },
    { id: 6, resKey: "symbol_06_png", cellSpan: 1 },
    { id: 7, resKey: "symbol_07_png", cellSpan: 1 },
    { id: 8, resKey: "symbol_08_png", cellSpan: 1 },
    { id: 9, resKey: "symbol_09_png", cellSpan: 1 },
    { id: 10, resKey: "symbol_10_png", cellSpan: 1 },
    { id: 62, resKey: "symbol_062_png", cellSpan: 2 },
    { id: 73, resKey: "symbol_073_png", cellSpan: 3 },
];

const BY_ID = new Map<number, TestSymbolDefinition>();

for (const item of TEST_SYMBOLS) {
    BY_ID.set(item.id, item);
}

/** 查 Symbol 定義；找不到直接丟例外，測試階段不要靜默略過。 */
export function getTestSymbol(id: number): TestSymbolDefinition {
    const found = BY_ID.get(id);

    if (found === undefined) {
        throw new Error(`Test symbol ${id} is not defined.`);
    }

    return found;
}

/** 產生框架要的 SymbolData（只需要 id）。 */
export function symbolData(id: number): SymbolData {
    getTestSymbol(id);
    return { id };
}

/** 一次產生多筆。 */
export function symbolDataList(ids: number[]): SymbolData[] {
    return ids.map(symbolData);
}

/** 交給 BaseReel.registerSymbolCells() 的格式。 */
export function testCellDefinitions(): { symbolId: number; cellSpan: number }[] {
    return TEST_SYMBOLS.map(item => ({
        symbolId: item.id,
        cellSpan: item.cellSpan,
    }));
}
