import { BaseReelIcon } from "../Core/Reel/BaseReelIcon";
import { ReelIconDisplayConfig } from "../Core/Reel/Config/ReelConfig";
import { ReelIconDirection } from "../Core/Reel/Config/ReelIconDirection";
import {
    ReelLayoutSource,
    ReelSymbolRuntime,
} from "../Core/Reel/Data/ReelData";
import {
    ReelSymbolCellDefinition,
    ReelSymbolRegistry,
} from "../Core/Reel/Data/ReelSymbolRegistry";
import { SymbolData } from "../Core/Reel/Data/SymbolData";
import {
    BaseMovement,
    MovementEasing,
} from "../Core/Reel/Internal/BaseMovement";
import { ReelIconManager } from "../Core/Reel/Internal/ReelIconManager";
import {
    assertNonNegativeFiniteNumber,
    assertPositiveFiniteNumber,
    assertPositiveInteger,
} from "../Core/Internal/NumberAssert";
import { DropReelConfig } from "./Config/DropReelConfig";

/** 一組牌（一個 group）的一條掉落移動；數值就是這組每一格的 cellOffset。 */
interface GroupDrop {
    readonly movement: BaseMovement;
    readonly runtimes: ReelSymbolRuntime[];
}

/**
 * 單軸掉落（雛形）。
 *
 * 與滾動共用 strip 模型（`ReelIconManager`）：進場 buffer ＋ 可視區 ＋
 * 退場 buffer，牌一律往退場端掉。不繼承 `BaseReel`（Drop-Module-Readiness §7.6）。
 *
 * ## 已定案的規則（Drop-Module-Readiness §7.4）
 *
 * - 消除清單是**畫面上的格子位置**（畫面閱讀順序），大圖露出的格子要全部列上，
 *   整組一起消（Q1）
 * - 補進來的新牌由遊戲層給，數量 = 畫面上消掉的格數（Q2）
 * - 資料與空殼一起重排：空殼帶著自己的牌往下掉，被消掉的空殼搬到進場端換新牌（Q5）
 * - 掉落途中再下指令或重設盤面 → throw；不做掉落急停（Q6）
 * - 位置由框架算：每組一條移動推它的 `cellOffset`，每幀一次推給全部空殼；
 *   掉落途中查詢回傳掉完之後的盤面（Q7）
 * - 每幀由掉落機台呼叫 `update()`（Q10）
 *
 * ## 雛形未支援
 *
 * 被畫面邊緣截斷的大圖（頭或尾在 buffer 裡）一律 throw。那牽涉到 Q2／Q4
 * 「框架補齊畫面外那部分」，等實際跑起來再定。
 */
export class BaseDropReel extends eui.Component {
    private readonly _symbolRegistry = new ReelSymbolRegistry();
    private readonly _iconManager = new ReelIconManager();
    private _iconLayer?: egret.DisplayObjectContainer;

    private _inited = false;
    private _moveInterval = 0;
    private _easing: MovementEasing = BaseMovement.linear;

    private _drops: GroupDrop[] = [];
    private _dropping = false;

    /** 掉出之後、掉入之前，可視區是空的（牌都在退場端外面）。 */
    private _droppedOut = false;
    private _resolveDrop?: () => void;

    /** 一次掉落開始時通知。 */
    public onDropStarted?: () => void;

    /** 一次掉落全部到位時通知。 */
    public onDropCompleted?: () => void;

    // ───────────────── 建立 ─────────────────

    /** 登記每個 Symbol ID 占幾格；必須在 init() 之前。 */
    public registerSymbolCells(
        definitions: ReelSymbolCellDefinition[],
    ): void {
        this.assertNotDropping("registerSymbolCells()");
        this._symbolRegistry.register(definitions);
    }

    public init(config: DropReelConfig): void {
        this.assertNotDropping("init()");
        assertPositiveInteger(config.visibleCellCount, "visibleCellCount");
        assertPositiveFiniteNumber(config.cellSize, "cellSize");
        assertPositiveFiniteNumber(config.moveInterval, "moveInterval");

        const cellSpacing = config.cellSpacing !== undefined
            ? config.cellSpacing
            : 0;
        const alignmentEpsilon = config.alignmentEpsilon !== undefined
            ? config.alignmentEpsilon
            : 0.0001;
        const maxCellSpan = config.maxCellSpan !== undefined
            ? config.maxCellSpan
            : this._symbolRegistry.getMaxCellSpan();

        assertNonNegativeFiniteNumber(cellSpacing, "cellSpacing");
        assertNonNegativeFiniteNumber(alignmentEpsilon, "alignmentEpsilon");
        assertPositiveInteger(maxCellSpan, "maxCellSpan");

        this._iconManager.configure(
            config.visibleCellCount,
            config.cellSize,
            cellSpacing,
            alignmentEpsilon,
            maxCellSpan,
            this._symbolRegistry,
        );
        this._iconManager.configureDisplay(
            config.layoutType,
            config.inverseDirection,
        );
        this._moveInterval = config.moveInterval;
        this._easing = config.easing !== undefined
            ? config.easing
            : BaseMovement.linear;
        this._inited = true;
    }

    /** 套用初始盤面；三段皆以資料流方向（進場端 → 退場端）排列。 */
    public setInitialLayout(source: ReelLayoutSource): void {
        this.assertInitialized();
        this.assertNotDropping("setInitialLayout()");
        this._iconManager.initialize(source);
        this._droppedOut = false;
        this._iconManager.syncAllIcons();
    }

    /** 建立空殼並掛到自己底下；必須在 setInitialLayout() 之後。 */
    public configureIconDisplay(config: ReelIconDisplayConfig): void {
        this.assertInitialized();
        this.assertNotDropping("configureIconDisplay()");

        if (this._iconLayer === undefined) {
            this._iconLayer = new egret.DisplayObjectContainer();
            this.addChild(this._iconLayer);
        }

        this._iconManager.initializeIcons(
            this._iconLayer,
            config.iconFactory,
        );
    }

    /** 產生顯示區裁切矩形，由呼叫端指定給容器的 mask。 */
    public createDisplayMaskRect(crossSize: number): egret.Rectangle {
        this.assertInitialized();
        return this._iconManager.createDisplayMaskRect(crossSize);
    }

    // ───────────────── 掉落 ─────────────────

    /**
     * 整個可視區往退場端掉出畫面（v3 `startDropOut()`）。
     *
     * 每組都掉 `visibleCellCount` 格，同時到位。掉完之後可視區是空的，
     * 要先 `startDropIn()` 才能再補牌。
     */
    public startDropOut(): Promise<void> {
        this.assertCanStartDrop("startDropOut()");

        if (this._droppedOut) {
            throw new Error("startDropOut() requires a board on screen.");
        }

        const visible = this._iconManager.visibleCellCount;
        const pitch = this._iconManager.cellPitch;
        const drops: GroupDrop[] = [];

        for (const runtimes of this.collectVisibleGroups()) {
            drops.push(this.createGroupDrop(
                runtimes,
                0,
                visible * pitch,
                visible * this._moveInterval,
            ));
        }

        this._droppedOut = true;
        return this.beginDrop(drops);
    }

    /**
     * 新盤面從進場端掉進畫面（v3 `startDropIn()`）。
     *
     * @param board 畫面閱讀順序的逐格結果，長度 = visibleCellCount
     */
    public startDropIn(board: SymbolData[]): Promise<void> {
        this.assertCanStartDrop("startDropIn()");
        this._iconManager.validateResultData(board);

        const visible = this._iconManager.visibleCellCount;
        const pitch = this._iconManager.cellPitch;
        const first = this._iconManager.firstVisibleIndex;
        const symbols = this._iconManager.symbols;
        const cells = this.toInternalOrder(board);
        const groupOffsets = this.deriveCompleteGroupOffsets(cells, "board");

        /*
         * 可視區的空殼換上新牌，整批搬到畫面進場端外面排好（一格疊一格），
         * 再一起掉 visibleCellCount 格進來。可視區之外的 buffer 不動。
         */
        for (let offset = 0; offset < visible; offset++) {
            const runtime = symbols[first + offset];
            runtime.data = cells[offset];
            runtime.groupOffset = groupOffsets[offset];
            runtime.resultSpinId = undefined;
        }

        const drops: GroupDrop[] = [];

        for (const runtimes of this.collectVisibleGroups()) {
            drops.push(this.createGroupDrop(
                runtimes,
                -visible * pitch,
                0,
                visible * this._moveInterval,
            ));
        }

        this._droppedOut = false;
        return this.beginDrop(drops);
    }

    /**
     * 消掉指定格子，上面的牌往下掉、新牌從進場端補進來（v3 `startDropRefill()`）。
     *
     * @param removePositions 畫面閱讀順序的格子位置；大圖露出的格子要全部列上
     * @param refillCells 補進來的新牌，畫面閱讀順序，張數 = 消掉的格數
     */
    public startDropRefill(
        removePositions: number[],
        refillCells: SymbolData[],
    ): Promise<void> {
        this.assertCanStartDrop("startDropRefill()");

        if (this._droppedOut) {
            throw new Error(
                "startDropRefill() requires a board on screen; call startDropIn() first.",
            );
        }

        const visible = this._iconManager.visibleCellCount;
        const pitch = this._iconManager.cellPitch;
        const first = this._iconManager.firstVisibleIndex;
        const symbols = this._iconManager.symbols;
        const removed = this.resolveRemovedIndexes(removePositions);

        if (refillCells.length !== removed.size) {
            throw new Error(
                `startDropRefill() requires ${removed.size} refill cells `
                + `(one per removed cell); received ${refillCells.length}.`,
            );
        }

        for (const data of refillCells) {
            this._iconManager.validateData(data, "refill SymbolData");
        }

        const newCells = this.toInternalOrder(refillCells);
        const newOffsets = this.deriveCompleteGroupOffsets(newCells, "refill");
        const removedCount = removed.size;

        /*
         * 可視區新的排列（進場端 → 退場端）：被消掉的空殼在前（換新牌），
         * 留下來的照原順序接在後面。buffer 不動。
         */
        const removedIndexes: number[] = [];
        const keptIndexes: number[] = [];

        for (let offset = 0; offset < visible; offset++) {
            const index = first + offset;
            (removed.has(index) ? removedIndexes : keptIndexes).push(index);
        }

        const order: number[] = [];

        for (let index = 0; index < symbols.length; index++) {
            order.push(index);
        }

        [...removedIndexes, ...keptIndexes].forEach((oldIndex, slot) => {
            order[first + slot] = oldIndex;
        });

        /* 掉落距離 = 新索引 − 舊索引 = 它朝退場端那一側被消掉的格數（§7.5）。 */
        const distanceByRuntime = new Map<ReelSymbolRuntime, number>();

        keptIndexes.forEach((oldIndex, rank) => {
            distanceByRuntime.set(
                symbols[oldIndex],
                first + removedCount + rank - oldIndex,
            );
        });

        this._iconManager.reorderCells(order);

        for (let slot = 0; slot < removedCount; slot++) {
            const runtime = symbols[first + slot];
            runtime.data = newCells[slot];
            runtime.groupOffset = newOffsets[slot];
            runtime.resultSpinId = undefined;
            distanceByRuntime.set(runtime, removedCount);
        }

        const drops: GroupDrop[] = [];

        for (const runtimes of this.collectVisibleGroups()) {
            const distance = distanceByRuntime.get(runtimes[0]) as number;

            if (distance > 0) {
                drops.push(this.createGroupDrop(
                    runtimes,
                    -distance * pitch,
                    0,
                    distance * this._moveInterval,
                ));
            }
        }

        return this.beginDrop(drops);
    }

    /**
     * 推進一幀；由掉落機台每幀呼叫（Q10）。
     *
     * 先推進全部移動，再一次把位置推給全部空殼。
     */
    public update(deltaTime: number): void {
        if (!this._dropping || !(deltaTime > 0)) {
            return;
        }

        for (const drop of this._drops) {
            drop.movement.update(deltaTime);
        }

        this._iconManager.syncAllIcons();

        if (this._drops.every((drop) => drop.movement.isIdle)) {
            this.completeDrop();
        }
    }

    // ───────────────── 查詢 ─────────────────

    public get inited(): boolean {
        return this._inited;
    }

    /** 是否正在掉落。 */
    public get dropping(): boolean {
        return this._dropping;
    }

    /** 掉出之後、掉入之前為 true（可視區是空的）。 */
    public get droppedOut(): boolean {
        return this._droppedOut;
    }

    public get visibleCellCount(): number {
        return this._iconManager.visibleCellCount;
    }

    public get maxCellSpan(): number {
        return this._iconManager.maxCellSpan;
    }

    public get cellPitch(): number {
        return this._iconManager.cellPitch;
    }

    public get moveInterval(): number {
        return this._moveInterval;
    }

    public get layoutType(): ReelIconDirection {
        return this._iconManager.layoutType;
    }

    public get exitTowardPositiveAxis(): boolean {
        return this._iconManager.exitTowardPositiveAxis;
    }

    /** 內部順序（進場端 → 退場端），與 `BaseReel.symbols` 相同。 */
    public get symbols(): ReelSymbolRuntime[] {
        return this._iconManager.symbols;
    }

    /** 與 symbols 同索引配對的空殼；回傳內部陣列本身，請勿增刪。 */
    public get icons(): BaseReelIcon[] {
        return this._iconManager.icons;
    }

    public get firstVisibleIndex(): number {
        return this._iconManager.firstVisibleIndex;
    }

    /**
     * 可視區逐格 id，畫面閱讀順序。
     *
     * **掉落途中回傳掉完之後的盤面**（Q7）—— 掉落一開始資料就已重排好，
     * 畫面位置靠 `cellOffset` 補回。
     */
    public getVisibleCellSymbolIds(): number[] {
        const ids = this._iconManager.getVisibleCellSymbolIds();
        return this._iconManager.resultEntryAtDisplayStart
            ? ids
            : ids.reverse();
    }

    /** 圖有出現在可視區的空殼（每組回傳 head），畫面閱讀順序；掉落途中同上。 */
    public getVisibleIcons(): BaseReelIcon[] {
        const icons = this._iconManager.getVisibleIcons();
        return this._iconManager.resultEntryAtDisplayStart
            ? icons
            : icons.reverse();
    }

    /** 釋放執行期資料；呼叫後必須重新 init()。 */
    public cleanup(): void {
        for (const drop of this._drops) {
            drop.movement.clear();
            drop.movement.onValueChanged = undefined;
        }

        this._drops = [];
        this._dropping = false;
        this._droppedOut = false;
        this._resolveDrop = undefined;
        this._iconManager.cleanup();
        this._symbolRegistry.clear();
        this.onDropStarted = undefined;
        this.onDropCompleted = undefined;
        this._inited = false;
    }

    // ───────────────── 內部 ─────────────────

    private beginDrop(drops: GroupDrop[]): Promise<void> {
        this._drops = drops;
        this._iconManager.syncAllIcons();

        if (drops.length === 0) {
            return Promise.resolve();
        }

        this._dropping = true;

        const promise = new Promise<void>((resolve) => {
            this._resolveDrop = resolve;
        });

        if (this.onDropStarted !== undefined) {
            this.onDropStarted();
        }

        return promise;
    }

    private completeDrop(): void {
        for (const drop of this._drops) {
            drop.movement.onValueChanged = undefined;
        }

        this._drops = [];
        this._dropping = false;

        const resolve = this._resolveDrop;
        this._resolveDrop = undefined;

        if (this.onDropCompleted !== undefined) {
            this.onDropCompleted();
        }

        if (resolve !== undefined) {
            resolve();
        }
    }

    /** 一組一條移動：從 `from` 移到 `to`，數值寫進整組每一格的 cellOffset。 */
    private createGroupDrop(
        runtimes: ReelSymbolRuntime[],
        from: number,
        to: number,
        duration: number,
    ): GroupDrop {
        const movement = new BaseMovement(from);

        for (const runtime of runtimes) {
            runtime.cellOffset = from;
        }

        movement.onValueChanged = (value: number): void => {
            for (const runtime of runtimes) {
                runtime.cellOffset = value;
            }
        };
        movement.moveTo(to, duration, this._easing);
        return { movement, runtimes };
    }

    /**
     * 可視區的 group，每組依 strip 順序列出 Runtime。
     *
     * 雛形只處理完整落在可視區內的組；頭或尾在 buffer 裡的截斷組 throw。
     */
    private collectVisibleGroups(): ReelSymbolRuntime[][] {
        const first = this._iconManager.firstVisibleIndex;
        const last = first + this._iconManager.visibleCellCount - 1;
        const symbols = this._iconManager.symbols;
        const groups: ReelSymbolRuntime[][] = [];

        for (let index = first; index <= last;) {
            const range = this.getCompleteGroupRange(index, first, last);
            groups.push(symbols.slice(range.start, range.end + 1));
            index = range.end + 1;
        }

        return groups;
    }

    /** 某格所屬 group 的索引區間；超出可視區（被截斷）時 throw。 */
    private getCompleteGroupRange(
        index: number,
        first: number,
        last: number,
    ): { start: number; end: number } {
        const runtime = this._iconManager.symbols[index];
        const start = index - runtime.groupOffset;
        const end = start + this._iconManager.getCellSpan(runtime.data) - 1;

        if (start < first || end > last) {
            throw new Error(
                "BaseDropReel prototype does not support Symbols truncated "
                + "by the display edge yet.",
            );
        }

        return { start, end };
    }

    /** 把消除清單（畫面位置）換成 strip 索引，驗證整組列齊（Q1）。 */
    private resolveRemovedIndexes(removePositions: number[]): Set<number> {
        const visible = this._iconManager.visibleCellCount;
        const first = this._iconManager.firstVisibleIndex;
        const last = first + visible - 1;
        const removed = new Set<number>();

        for (const position of removePositions) {
            if (
                !Number.isInteger(position)
                || position < 0
                || position >= visible
            ) {
                throw new Error(
                    `Remove position must be an integer in [0, ${visible}); received ${position}.`,
                );
            }

            removed.add(first + this.toInternalOffset(position));
        }

        if (removed.size !== removePositions.length) {
            throw new Error("Remove positions must not repeat.");
        }

        /* 專案 target 是 es5，Set 不能 for...of，改用 forEach。 */
        removed.forEach((index) => {
            const range = this.getCompleteGroupRange(index, first, last);

            for (let member = range.start; member <= range.end; member++) {
                if (!removed.has(member)) {
                    throw new Error(
                        "Every visible cell of a removed Symbol must be listed; "
                        + "the whole group is removed together.",
                    );
                }
            }
        });

        return removed;
    }

    /**
     * 逐格資料（進場端 → 退場端）推導 groupOffset；雛形要求每組完整。
     *
     * head 在進場側，所以從進場端往退場端掃：遇到 head 就要接滿 cellSpan 格。
     */
    private deriveCompleteGroupOffsets(
        cells: SymbolData[],
        label: string,
    ): number[] {
        const offsets: number[] = [];

        for (let index = 0; index < cells.length;) {
            const span = this._iconManager.getCellSpan(cells[index]);

            for (let offset = 0; offset < span; offset++) {
                const cell = cells[index + offset];

                if (cell === undefined || cell.id !== cells[index].id) {
                    throw new Error(
                        `BaseDropReel prototype requires complete Symbols in ${label}; `
                        + `Symbol ${cells[index].id} needs ${span} consecutive cells.`,
                    );
                }

                offsets.push(offset);
            }

            index += span;
        }

        return offsets;
    }

    /** 畫面閱讀順序 → 內部順序（進場端 → 退場端）。 */
    private toInternalOrder(cells: SymbolData[]): SymbolData[] {
        return this._iconManager.resultEntryAtDisplayStart
            ? [...cells]
            : [...cells].reverse();
    }

    private toInternalOffset(position: number): number {
        return this._iconManager.resultEntryAtDisplayStart
            ? position
            : this._iconManager.visibleCellCount - 1 - position;
    }

    private assertCanStartDrop(label: string): void {
        this.assertInitialized();
        this.assertNotDropping(label);
    }

    private assertInitialized(): void {
        if (!this._inited) {
            throw new Error("BaseDropReel.init() must be called first.");
        }
    }

    private assertNotDropping(label: string): void {
        if (this._dropping) {
            throw new Error(`${label} cannot be called while the reel is dropping.`);
        }
    }
}
