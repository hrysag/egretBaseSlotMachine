import { SymbolData } from "../Data/SymbolData";
import { assertNonNegativeInteger } from "../../Internal/NumberAssert";

/**
 * Reel 單輪資料列表。
 *
 * 內部只使用普通陣列與 readIndex。消耗資料時不刪除陣列前端，
 * 而是推進讀取位置，因此同一輪內可以直接檢視完整資料、已消耗資料與剩餘資料。
 */
export class ReelDataList {
    private readonly _data: SymbolData[] = [];
    private _readIndex = 0;

    /** 下一筆待讀資料在完整陣列中的索引。 */
    public get readIndex(): number {
        return this._readIndex;
    }

    /** 本輪完整資料筆數，包含已消耗及尚未消耗的資料。 */
    public get length(): number {
        return this._data.length;
    }

    /** 尚未消耗的 Symbol 資料筆數。 */
    public get remainingCount(): number {
        return this._data.length - this._readIndex;
    }

    /**
     * 回傳本輪完整資料的切片。
     *
     * 不回傳內部陣列本身，避免外部 push、splice 或排序破壞讀取位置。
     */
    public get allData(): SymbolData[] {
        return this._data.slice();
    }

    /** 回傳目前已消耗資料的切片。 */
    public get consumedData(): SymbolData[] {
        return this._data.slice(0, this._readIndex);
    }

    /** 回傳目前尚未消耗資料的切片。 */
    public get remainingData(): SymbolData[] {
        return this._data.slice(this._readIndex);
    }

    /**
     * 將資料加入列表尾端，不改變目前 readIndex。
     *
     * SymbolData 視為不可變資料，這裡直接保存參考，避免每次進牌產生新物件。
     */
    public append(data: SymbolData[]): void {
        for (const item of data) {
            this.validateData(item);
            this._data.push(item);
        }
    }

    /**
     * 保留已消耗的歷史資料，只替換尚未執行的尾段。
     *
     * Server 結果抵達後，BaseReel 會依目標停止時間決定還需要多少
     * 表演資料，再以「保留的表演資料＋正式結果」取代原本未讀尾段。
     */
    public replaceRemaining(data: SymbolData[]): void {
        const consumedCount = this._readIndex;
        this._data.length = consumedCount;
        this.append(data);
    }

    /**
     * 查看下一筆或後方指定 offset 的資料，不推進 readIndex。
     *
     * 超出剩餘範圍時回傳 undefined。
     */
    public peek(offset = 0): SymbolData | undefined {
        assertNonNegativeInteger(offset, "offset");
        return this._data[this._readIndex + offset];
    }

    /**
     * 預覽後續資料，不推進 readIndex。
     *
     * 未傳入 count 時回傳全部剩餘資料；傳入 count 時最多回傳指定筆數。
     */
    public preview(count?: number): SymbolData[] {
        if (count === undefined) {
            return this.remainingData;
        }

        assertNonNegativeInteger(count, "count");
        return this._data.slice(
            this._readIndex,
            this._readIndex + count,
        );
    }

    /**
     * 取得下一筆資料並將 readIndex 推進一格。
     *
     * 已消耗資料仍保留在完整陣列中，方便本輪預覽、除錯及追蹤資料歷史。
     */
    public consume(): SymbolData | undefined {
        const result = this._data[this._readIndex];

        if (result !== undefined) {
            this._readIndex++;
        }

        return result;
    }

    /**
     * 略過指定資料筆數，只推進 readIndex，不刪除陣列內容。
     *
     * 實際略過量不會超過剩餘資料筆數，回傳值可供 BaseReel 驗證急停處理結果。
     */
    public skip(count: number): number {
        assertNonNegativeInteger(count, "count");

        const actualCount = Math.min(count, this.remainingCount);
        this._readIndex += actualCount;
        return actualCount;
    }

    /**
     * 清除本輪全部資料並重設讀取位置。
     *
     * 同一輪期間保留完整資料，只有下一輪開始或明確清理時才整體重設。
     */
    public reset(): void {
        this._data.length = 0;
        this._readIndex = 0;
    }

    /**
     * 只擋 null／undefined。
     *
     * `visualSize` 的數值檢查由 ReelIconManager.validateData() 負責 ——
     * 那一層才認識 Registry，錯誤訊息也帶得出呼叫端的 label。這裡是
     * 純容器，資料格式不歸它管。
     */
    private validateData(data: SymbolData): void {
        if (data === null || data === undefined) {
            throw new Error("SymbolData is required.");
        }
    }
}
