import { BaseReelIcon } from "../BaseReelIcon";
import { ReelIconFactory } from "../Config/ReelConfig";
import { ReelIconDirection } from "../Config/ReelIconDirection";
import {
    ReelLayoutSource,
    ReelSymbolRuntime,
} from "../Data/ReelData";
import { ReelSymbolRegistry } from "../Data/ReelSymbolRegistry";
import { SymbolData } from "../Data/SymbolData";
import {
    assertPositiveFiniteNumber,
} from "../../Internal/NumberAssert";

/**
 * 單軸 Cell Strip 的幾何與資料綁定。
 *
 * 本階段只處理純數值：排列、位移、交接、group 推導與結果對齊判定。
 * Icon 載體、mask 與座標軸映射屬於顯示層，於後續階段接上。
 *
 * ## 位置模型
 *
 * 每個 Runtime 恆為一格，位置不逐格保存，而是由索引算出來：
 *
 * ```text
 * 位置(k) = axis(k) + stripOffset + cellOffset[k] + visualAxisOffset
 *
 * axis(k) = (k - maxCellSpan - visibleCellCount / 2 + 0.5) * cellPitch
 * ```
 *
 * - `k` 由進場端數起，`0` 是進場端最外格，`L - 1` 是退場端最外格
 * - 軸向座標一律「往退場方向遞增」，方向正負號留到顯示層才套用
 * - 顯示區固定是 `±visibleCellCount * cellPitch / 2`，與 buffer 大小無關
 *
 * `stripOffset` 不累加，直接由 Movement 的值取模得到，因此沒有累積誤差；
 * 交接由「已走完幾個完整 Cell」的計數器驅動，不做幾何比較。
 */
export class ReelIconManager {
    private readonly _symbols: ReelSymbolRuntime[] = [];

    private _visibleCellCount = 0;
    private _maxCellSpan = 1;
    private _cellSize = 0;
    private _cellSpacing = 0;
    private _alignmentEpsilon = 0.0001;
    private _symbolRegistry?: ReelSymbolRegistry;

    /** 整軸位移，恆在 [0, cellPitch) 內。 */
    private _stripOffset = 0;

    /** 已經完成交接的完整 Cell 數，用來判斷還欠幾次交接。 */
    private _handedOffCellCount = 0;

    /** 依最近一次 applyMovementValue() 算出的已走完完整 Cell 數。 */
    private _travelledCellCount = 0;

    /** 啟動效果與停止效果的整軸顯示偏移，不影響幾何判定。 */
    private _visualAxisOffset = 0;

    /** 顯示層：與 _symbols 永久同索引配對的 Icon 載體。 */
    private readonly _icons: BaseReelIcon[] = [];
    private _iconContainer?: egret.DisplayObjectContainer;
    private _layoutType = ReelIconDirection.Vertical;
    private _inverseDirection = false;

    /** 內部陣列固定為「進場端 → 退場端」。 */
    public get symbols(): ReelSymbolRuntime[] {
        return this._symbols;
    }

    public get visibleCellCount(): number {
        return this._visibleCellCount;
    }

    public get maxCellSpan(): number {
        return this._maxCellSpan;
    }

    public get cellPitch(): number {
        return this._cellSize + this._cellSpacing;
    }

    public get alignmentEpsilon(): number {
        return this._alignmentEpsilon;
    }

    /** Strip 總格數 = 兩端 buffer 加上顯示區。 */
    public get stripCellCount(): number {
        return this._visibleCellCount + this._maxCellSpan * 2;
    }

    public get stripOffset(): number {
        return this._stripOffset;
    }

    /** 顯示區第一格在內部陣列中的索引。 */
    public get firstVisibleIndex(): number {
        return this._maxCellSpan;
    }

    public configure(
        visibleCellCount: number,
        cellSize: number,
        cellSpacing: number,
        alignmentEpsilon: number,
        maxCellSpan: number,
        symbolRegistry: ReelSymbolRegistry,
    ): void {
        this._visibleCellCount = visibleCellCount;
        this._cellSize = cellSize;
        this._cellSpacing = cellSpacing;
        this._alignmentEpsilon = alignmentEpsilon;
        this._maxCellSpan = maxCellSpan;
        this._symbolRegistry = symbolRegistry;
    }

    /**
     * 套用初始盤面。
     *
     * 三段都以**資料流方向**（進場端 → 退場端）排列，並各自展開成 Cell 後
     * 驗證格數：entryBuffer 與 exitBuffer 各為 maxCellSpan、visible 為
     * visibleCellCount。
     *
     * 手寫盤面不允許 group 跨越 buffer 與顯示區的邊界，因此三段可以
     * 獨立驗證；被截斷的盤面只會由上一輪滾動自然產生。
     */
    public initialize(source: ReelLayoutSource): void {
        const entryCells = this.expandSection(
            source.entryBuffer,
            this._maxCellSpan,
            "entryBuffer",
        );
        const visibleCells = this.expandSection(
            source.visible,
            this._visibleCellCount,
            "visible",
        );
        const exitCells = this.expandSection(
            source.exitBuffer,
            this._maxCellSpan,
            "exitBuffer",
        );

        this._symbols.length = 0;
        this._symbols.push(
            ...entryCells,
            ...visibleCells,
            ...exitCells,
        );
        this.resetMovement();
    }

    /** 清除本輪位移狀態；每輪開始與重置 Movement 時呼叫。 */
    public resetMovement(): void {
        this._stripOffset = 0;
        this._handedOffCellCount = 0;
        this._travelledCellCount = 0;
    }

    /**
     * 套用 Movement 的目前值，回傳尚欠幾次交接。
     *
     * `value` 是本輪累積的行進距離（永遠往退場方向遞增，不帶方向正負號）。
     * stripOffset 由取模得到而非逐次累加，因此不會有浮點漂移；
     * 交接次數也直接由整除部分決定，不需要任何幾何比較或容差。
     */
    public applyMovementValue(value: number): number {
        const travelled = Math.max(0, value);
        const cellPitch = this.cellPitch;

        this._travelledCellCount = Math.floor(travelled / cellPitch);
        this._stripOffset =
            travelled - this._travelledCellCount * cellPitch;

        return this.pendingHandoffCount;
    }

    /**
     * 尚欠幾次交接。
     *
     * 位置每幀都要更新，但交接只在完整 Cell 邊界執行，所以兩者分開：
     * `applyMovementValue()` 負責位置，呼叫端在完整 Cell 邊界才依此
     * 數值把欠的交接補完。
     */
    public get pendingHandoffCount(): number {
        return Math.max(
            0,
            this._travelledCellCount - this._handedOffCellCount,
        );
    }

    /**
     * 把退場端最外格搬回進場端並綁定新資料。
     *
     * group 歸屬以 O(1) 的鄰居規則推導：朝退場方向的隔壁若是同一個
     * Symbol 且該 group 尚未湊滿，就接續；否則開新組。head 因此落在
     * group 的進場側，是整組中最後進場的一格。
     */
    public recycleExitedCell(
        nextData: SymbolData,
        resultSpinId?: number,
    ): {
        runtime: ReelSymbolRuntime;
        previousData: SymbolData;
    } {
        this.validateData(nextData, "nextData");

        if (this._symbols.length < 2) {
            throw new Error(
                "BaseReel requires at least two runtime cells.",
            );
        }

        const runtime = this._symbols.pop() as ReelSymbolRuntime;
        const previousData = runtime.data;
        const neighbourTowardExit = this._symbols[0];

        runtime.data = nextData;
        runtime.groupOffset = this.resolveGroupOffset(
            nextData,
            neighbourTowardExit,
        );
        runtime.resultSpinId = resultSpinId;
        runtime.cellOffset = 0;
        this._symbols.unshift(runtime);
        this._handedOffCellCount++;

        return { runtime, previousData };
    }

    /**
     * 沒有下一筆資料時，仍把已出場的載體搬回進場端。
     *
     * 只整理 strip 結構，不更換資料 —— 否則退場端會堆積，
     * 下一輪也會缺少進場 buffer。
     */
    public recycleExitedCellKeepingData(): ReelSymbolRuntime {
        if (this._symbols.length < 2) {
            throw new Error(
                "BaseReel requires at least two runtime cells.",
            );
        }

        const runtime = this._symbols.pop() as ReelSymbolRuntime;
        const neighbourTowardExit = this._symbols[0];

        runtime.groupOffset = this.resolveGroupOffset(
            runtime.data,
            neighbourTowardExit,
        );
        runtime.cellOffset = 0;
        this._symbols.unshift(runtime);
        this._handedOffCellCount++;

        return runtime;
    }

    /**
     * 把上一輪留在進場 buffer 的 Runtime 改綁新一輪資料。
     *
     * 只有**整組都在 buffer 內**的格子可以換；跨越 buffer 與顯示區
     * 邊界的 group 必須整組保留，否則會把仍在顯示區的 follower
     * 變成沒有 head 的孤兒，那張圖會直接消失。
     *
     * 回傳順序為進場端由外往內。
     */
    public getReplaceableEntryRuntimes(): ReelSymbolRuntime[] {
        const result: ReelSymbolRuntime[] = [];
        const lastBufferIndex = this._maxCellSpan - 1;

        for (let index = 0; index <= lastBufferIndex; index++) {
            const runtime = this._symbols[index];

            if (runtime === undefined) {
                break;
            }

            if (runtime.groupOffset === 0) {
                const span = this.getCellSpan(runtime.data);

                if (index + span - 1 > lastBufferIndex) {
                    break;
                }
            }

            result.push(runtime);
        }

        return result;
    }

    /** 依鄰居重新推導 group 歸屬並換上新資料。 */
    public rebindEntryRuntime(
        runtime: ReelSymbolRuntime,
        nextData: SymbolData,
    ): SymbolData {
        this.validateData(nextData, "nextData");

        const index = this._symbols.indexOf(runtime);

        if (index < 0 || index >= this._symbols.length - 1) {
            throw new Error(
                "Carryover runtime must be inside the entry buffer.",
            );
        }

        const previousData = runtime.data;
        runtime.data = nextData;
        runtime.groupOffset = this.resolveGroupOffset(
            nextData,
            this._symbols[index + 1],
        );
        runtime.resultSpinId = undefined;
        runtime.cellOffset = 0;
        return previousData;
    }

    /**
     * 取得顯示區逐 Cell 的 Symbol ID，依畫面閱讀順序之前的內部順序
     * （進場端 → 退場端）排列。方向轉換由呼叫端負責。
     */
    public getVisibleCellSymbolIds(): number[] {
        const result: number[] = [];
        const start = this.firstVisibleIndex;

        for (let offset = 0; offset < this._visibleCellCount; offset++) {
            const runtime = this._symbols[start + offset];

            if (runtime === undefined) {
                break;
            }

            result.push(runtime.data.id);
        }

        return result;
    }

    /** 取得完整落在顯示區內的 Runtime。 */
    public getVisibleRuntimes(): ReelSymbolRuntime[] {
        const start = this.firstVisibleIndex;
        return this._symbols.slice(
            start,
            start + this._visibleCellCount,
        );
    }

    /**
     * 判斷本輪正式結果是否已經完整對齊顯示區。
     *
     * 只在完整 Cell 邊界成立（stripOffset 回到 0），此時顯示格就是
     * 固定的索引區間，因此純粹比對 id 與輪次標記，不碰任何幾何。
     *
     * @param result 依內部順序（進場端 → 退場端）排列的逐 Cell 結果
     */
    public isAligned(
        result: SymbolData[],
        requiredResultSpinId?: number,
    ): boolean {
        if (
            result.length === 0
            || result.length !== this._visibleCellCount
        ) {
            return false;
        }

        if (this._stripOffset > this._alignmentEpsilon) {
            return false;
        }

        const start = this.firstVisibleIndex;

        for (let offset = 0; offset < result.length; offset++) {
            const runtime = this._symbols[start + offset];

            if (runtime === undefined) {
                return false;
            }

            if (runtime.data.id !== result[offset].id) {
                return false;
            }

            if (
                requiredResultSpinId !== undefined
                && runtime.resultSpinId !== requiredResultSpinId
            ) {
                return false;
            }
        }

        return true;
    }

    /**
     * 第 k 格的軸向位置。
     *
     * 座標往退場方向遞增、顯示區中心為 0；方向正負號與軸向映射
     * 由顯示層處理。
     */
    public getAxisPosition(index: number): number {
        const runtime = this._symbols[index];
        const cellOffset = runtime === undefined
            ? 0
            : runtime.cellOffset;

        return this.getBaseAxisPosition(index)
            + this._stripOffset
            + cellOffset
            + this._visualAxisOffset;
    }

    /** 套用整軸顯示偏移（啟動效果與停止效果）。 */
    public setVisualAxisOffset(value: number): void {
        if (!Number.isFinite(value)) {
            throw new Error(
                "visualAxisOffset must be a finite number.",
            );
        }

        this._visualAxisOffset = value;
    }

    /** 驗證 Server 逐 Cell 結果；筆數必須等於顯示區 Cell 數。 */
    public validateResultData(data: SymbolData[]): void {
        if (data.length === 0) {
            throw new Error("Result SymbolData cannot be empty.");
        }

        if (data.length !== this._visibleCellCount) {
            throw new Error(
                "Result SymbolData must contain exactly "
                + `${this._visibleCellCount} visible cells; `
                + `received ${data.length}.`,
            );
        }

        for (const item of data) {
            this.validateData(item, "result SymbolData");
        }
    }

    public validateData(data: SymbolData, label: string): void {
        if (data === null || data === undefined) {
            throw new Error(`${label} is required.`);
        }

        this.getCellSpan(data);

        if (data.visualSize !== undefined) {
            assertPositiveFiniteNumber(
                data.visualSize.width,
                `${label}.visualSize.width`,
            );
            assertPositiveFiniteNumber(
                data.visualSize.height,
                `${label}.visualSize.height`,
            );
        }
    }

    public getCellSpan(data: SymbolData): number {
        if (this._symbolRegistry === undefined) {
            throw new Error(
                "ReelIconManager requires a ReelSymbolRegistry.",
            );
        }

        return this._symbolRegistry.getCellSpan(data.id);
    }

    // ───────────────── 顯示層 ─────────────────

    /** 由 BaseReel 建立並綁定的 Icon，與 _symbols 永久同索引配對。 */
    public get icons(): BaseReelIcon[] {
        return this._icons;
    }

    /**
     * 正式結果是否由畫面閱讀順序的開頭側進場。
     *
     * 方向只有這個類別持有一份，所以這個推導也放在這裡；
     * BaseReel 透過同名 getter 轉手，不再自己存 layoutType。
     */
    public get resultEntryAtDisplayStart(): boolean {
        return this._layoutType === ReelIconDirection.Vertical
            ? !this._inverseDirection
            : this._inverseDirection;
    }

    /**
     * 設定軸向映射。
     *
     * 幾何運算完全不含方向，方向只在這裡把「軸向數值」轉成
     * Egret 的 x 或 y，以及決定正負號。
     *
     * 傳 undefined 代表沿用目前值 —— 重複 init() 時的預設行為。
     */
    public configureDisplay(
        layoutType?: ReelIconDirection,
        inverseDirection?: boolean,
    ): void {
        this._layoutType = layoutType ?? this._layoutType;
        this._inverseDirection =
            inverseDirection ?? this._inverseDirection;

        if (this._icons.length > 0) {
            this.syncAllIcons();
        }
    }

    /**
     * 依目前 strip 長度建立 Icon 載體。
     *
     * Icon 全部掛在傳入的容器底下。若該容器是 eui.Group，強烈建議
     * 另外包一層普通的 egret.DisplayObjectContainer 再傳進來 ——
     * Group 在子項增刪與 setChildIndex 時會觸發 invalidateSize()
     * 與 invalidateDisplayList()，滾輪每格都要重排層級，成本會累積。
     */
    public initializeIcons(
        container: egret.DisplayObjectContainer,
        iconFactory: ReelIconFactory,
    ): void {
        this.clearIcons();
        this._iconContainer = container;

        for (let index = 0; index < this._symbols.length; index++) {
            const icon = iconFactory();

            if (!(icon instanceof BaseReelIcon)) {
                this.clearIcons();
                throw new Error(
                    "Reel icon factory must return a BaseReelIcon.",
                );
            }

            icon.setupCell(this.cellPitch);
            container.addChild(icon);
            this._icons.push(icon);
        }

        this.syncAllIcons();
    }

    /** 把目前全部排列同步到 Icon。 */
    public syncAllIcons(): void {
        let displayPriorityChanged = false;

        for (let index = 0; index < this._icons.length; index++) {
            if (this.syncIcon(index)) {
                displayPriorityChanged = true;
            }
        }

        if (displayPriorityChanged) {
            this.sortIconDisplayLayers();
        }
    }

    /** 產生顯示區的裁切矩形；交由呼叫端指定給容器的 mask。 */
    public createDisplayMaskRect(crossSize: number): egret.Rectangle {
        const axisLength = this._visibleCellCount * this.cellPitch;
        const isVertical =
            this._layoutType === ReelIconDirection.Vertical;
        const width = isVertical ? crossSize : axisLength;
        const height = isVertical ? axisLength : crossSize;

        return new egret.Rectangle(
            -width * 0.5,
            -height * 0.5,
            width,
            height,
        );
    }

    /** 移除本類別建立的 Icon，保留純數值 strip。 */
    public clearIcons(): void {
        for (const icon of this._icons) {
            icon.resetIcon();

            if (icon.parent !== null) {
                icon.parent.removeChild(icon);
            }
        }

        this._icons.length = 0;
        this._iconContainer = undefined;
    }

    public cleanup(): void {
        this.clearIcons();
        this._symbols.length = 0;
        this._stripOffset = 0;
        this._handedOffCellCount = 0;
        this._travelledCellCount = 0;
        this._visualAxisOffset = 0;
    }

    /**
     * 把第 index 格同步到對應 Icon。
     *
     * @returns 資料是否變更（變更時需要重排顯示層級）
     */
    private syncIcon(index: number): boolean {
        const icon = this._icons[index];
        const runtime = this._symbols[index];

        if (icon === undefined || runtime === undefined) {
            return false;
        }

        const dataChanged = icon.data !== runtime.data;

        if (dataChanged) {
            icon.setData(runtime.data);
        }

        const axis = this.getAxisPosition(index);
        const mapped = this.mapAxisToLocal(axis);

        icon.applyLayout({
            x: mapped.x,
            y: mapped.y,
            groupOffset: runtime.groupOffset,
        });

        return dataChanged;
    }

    /**
     * 軸向數值 → Egret 局部座標。
     *
     * 軸向一律往退場方向遞增；Egret 的 y 也是往下遞增，因此垂直
     * 正向（上進下出）可以直接對應，反向才需要翻號。
     */
    private mapAxisToLocal(axis: number): { x: number; y: number } {
        const directed = this._inverseDirection ? -axis : axis;

        return this._layoutType === ReelIconDirection.Vertical
            ? { x: 0, y: directed }
            : { x: directed, y: 0 };
    }

    /**
     * 依 displayPriority 重排 Icon 的繪製順序。
     *
     * 用 setChildIndex 而非 zIndex：zIndex 會實際重排容器的 $children
     * 陣列，之後 getChildIndex() 的結果就與本類別維護的索引脫節。
     * 同權重時以目前順序為次要鍵，避免每次重排都洗牌。
     */
    private sortIconDisplayLayers(): void {
        const registry = this._symbolRegistry;
        const container = this._iconContainer;

        if (registry === undefined || container === undefined) {
            return;
        }

        const sorted = this._icons.slice();
        sorted.sort((first, second) => {
            const firstPriority = first.data === undefined
                ? 0
                : registry.getDisplayPriority(first.data.id);
            const secondPriority = second.data === undefined
                ? 0
                : registry.getDisplayPriority(second.data.id);

            if (firstPriority !== secondPriority) {
                return firstPriority - secondPriority;
            }

            return container.getChildIndex(first)
                - container.getChildIndex(second);
        });

        for (let index = 0; index < sorted.length; index++) {
            container.setChildIndex(sorted[index], index);
        }
    }

    /** 不含任何位移的基準位置。 */
    private getBaseAxisPosition(index: number): number {
        return (
            index
            - this._maxCellSpan
            - this._visibleCellCount * 0.5
            + 0.5
        ) * this.cellPitch;
    }

    /**
     * group 歸屬的 O(1) 規則。
     *
     * 朝退場方向的隔壁若是同一個 Symbol 且該 group 尚未湊滿
     * （groupOffset > 0），本格就是它的下一格；否則開新組，
     * 從 cellSpan - 1 起算。
     */
    private resolveGroupOffset(
        data: SymbolData,
        neighbourTowardExit?: ReelSymbolRuntime,
    ): number {
        if (
            neighbourTowardExit !== undefined
            && neighbourTowardExit.data.id === data.id
            && neighbourTowardExit.groupOffset > 0
        ) {
            return neighbourTowardExit.groupOffset - 1;
        }

        return this.getCellSpan(data) - 1;
    }

    /**
     * 把一段以 Symbol 為單位的資料展開成 Cell，並驗證總格數。
     *
     * 每個 Symbol 都展開成完整的一組，所以段落之間的邊界永遠落在
     * group 邊界上，不會出現跨段的半組。
     */
    private expandSection(
        data: SymbolData[],
        expectedCellCount: number,
        label: string,
    ): ReelSymbolRuntime[] {
        if (!Array.isArray(data) || data.length === 0) {
            throw new Error(`${label} SymbolData cannot be empty.`);
        }

        const cells: ReelSymbolRuntime[] = [];

        for (const symbol of data) {
            this.validateData(symbol, `${label} SymbolData`);
            const cellSpan = this.getCellSpan(symbol);

            /*
             * head 在 group 的進場側，內部陣列又是進場端 → 退場端，
             * 所以 groupOffset 沿陣列方向遞增：0（head）, 1, 2 …
             * 與 resolveGroupOffset() 的「鄰居 - 1」方向一致。
             */
            for (let offset = 0; offset < cellSpan; offset++) {
                cells.push({
                    data: symbol,
                    groupOffset: offset,
                    cellOffset: 0,
                });
            }
        }

        if (cells.length !== expectedCellCount) {
            throw new Error(
                `${label} must expand to exactly ${expectedCellCount} `
                + `cells; received ${cells.length}.`,
            );
        }

        return cells;
    }
}
