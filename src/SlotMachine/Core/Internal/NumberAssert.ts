namespace slot_core {
    /**
     * 數值參數斷言。
     *
     * 這些檢查原本以 private helper 的形式散在 7 個類別裡，共 15 份、
     * 去重後只有 5 種，且逐字元相同。集中於此之後錯誤訊息只有一個來源。
     *
     * 全部是純函式，不持有狀態，也不依賴呼叫端的 this。
     */

    /** value 必須是有限數。 */
    export function assertFiniteNumber(value: number, label: string): void {
        if (!Number.isFinite(value)) {
            throw new Error(`${label} must be a finite number.`);
        }
    }

    /** value 必須是大於 0 的有限數。 */
    export function assertPositiveFiniteNumber(
        value: number,
        label: string,
    ): void {
        if (!Number.isFinite(value) || value <= 0) {
            throw new Error(`${label} must be a positive finite number.`);
        }
    }

    /** value 必須是不小於 0 的有限數。 */
    export function assertNonNegativeFiniteNumber(
        value: number,
        label: string,
    ): void {
        if (!Number.isFinite(value) || value < 0) {
            throw new Error(`${label} must be a non-negative finite number.`);
        }
    }

    /** value 必須是大於 0 的整數。 */
    export function assertPositiveInteger(value: number, label: string): void {
        if (!Number.isInteger(value) || value <= 0) {
            throw new Error(`${label} must be a positive integer.`);
        }
    }

    /** value 必須是不小於 0 的整數。 */
    export function assertNonNegativeInteger(
        value: number,
        label: string,
    ): void {
        if (!Number.isInteger(value) || value < 0) {
            throw new Error(`${label} must be a non-negative integer.`);
        }
    }
}
