/**
 * Core 幾何與資料層的純 TypeScript 斷言驗證。
 *
 * 刻意不接任何顯示層 —— Core 目前零引擎相依，因此可以直接
 * 編譯成 CommonJS 用 node 執行，不需要 egret stub，也不必開瀏覽器。
 *
 * 執行方式見 doc；輸出為每項斷言的 PASS／FAIL 與最終統計。
 */

/* 必須排在最前面：Core 載入時就會求值 eui.Component。 */
import "./EgretStub";

import { ReelDataFlow } from "../src/SlotMachine/Core/Reel/Internal/ReelDataFlow";
import { ReelIconManager } from "../src/SlotMachine/Core/Reel/Internal/ReelIconManager";
import { ReelSymbolRegistry } from "../src/SlotMachine/Core/Reel/Data/ReelSymbolRegistry";
import { SymbolData } from "../src/SlotMachine/Core/Reel/Data/SymbolData";

/** 專案沒有裝 @types/node，只宣告本檔用得到的那一個。 */
declare const process: { exit(code: number): void };

// ───────────────────────── 極簡斷言 ─────────────────────────

let passCount = 0;
let failCount = 0;
let currentGroup = "";

function group(name: string): void {
    currentGroup = name;
    console.log(`\n── ${name}`);
}

function check(label: string, actual: any, expected: any): void {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);

    if (a === e) {
        passCount++;
        console.log(`   PASS  ${label}`);
    } else {
        failCount++;
        console.log(`   FAIL  ${label}`);
        console.log(`         期望 ${e}`);
        console.log(`         實際 ${a}`);
    }
}

function checkThrows(label: string, fn: () => void): void {
    try {
        fn();
        failCount++;
        console.log(`   FAIL  ${label}（預期丟出例外，但沒有）`);
    } catch (error) {
        passCount++;
        console.log(`   PASS  ${label}`);
    }
}

// ───────────────────────── 測試資料 ─────────────────────────

/** 1～5 為 1×1；6 為 1×2；7 為 1×3。與 resource/assets/symbols 的素材一致。 */
const CELL_SIZE = 128;

function symbol(id: number): SymbolData {
    return { id };
}

function createRegistry(): ReelSymbolRegistry {
    const registry = new ReelSymbolRegistry();
    registry.register([
        { symbolId: 1, cellSpan: 1 },
        { symbolId: 2, cellSpan: 1 },
        { symbolId: 3, cellSpan: 1 },
        { symbolId: 4, cellSpan: 1 },
        { symbolId: 5, cellSpan: 1 },
        { symbolId: 6, cellSpan: 2 },
        { symbolId: 7, cellSpan: 3 },
    ]);
    return registry;
}

function createManager(
    registry: ReelSymbolRegistry,
    visibleCellCount = 3,
): ReelIconManager {
    const manager = new ReelIconManager();
    manager.configure(
        visibleCellCount,
        CELL_SIZE,
        0,
        0.0001,
        registry.getMaxCellSpan(),
        registry,
    );
    return manager;
}

function groupOffsets(manager: ReelIconManager): number[] {
    return manager.symbols.map((runtime) => runtime.groupOffset);
}

function symbolIds(manager: ReelIconManager): number[] {
    return manager.symbols.map((runtime) => runtime.data.id);
}

// ───────────────────────── 1. Registry ─────────────────────────

group("1. ReelSymbolRegistry");

{
    const registry = createRegistry();
    check("1×1 的 cellSpan", registry.getCellSpan(1), 1);
    check("1×2 的 cellSpan", registry.getCellSpan(6), 2);
    check("1×3 的 cellSpan", registry.getCellSpan(7), 3);
    check("getMaxCellSpan", registry.getMaxCellSpan(), 3);
    checkThrows("未註冊的 ID 要丟例外", () => registry.getCellSpan(99));

    const empty = new ReelSymbolRegistry();
    check("空 Registry 的 maxCellSpan 為 1", empty.getMaxCellSpan(), 1);
}

// ───────────────────────── 2. 初始 Layout ─────────────────────────

group("2. 初始 Layout 與 strip 幾何");

{
    const registry = createRegistry();
    const manager = createManager(registry);

    // maxCellSpan = 3、visible = 3 → strip = 3 + 3 + 3 = 9
    check("stripCellCount", manager.stripCellCount, 9);
    check("firstVisibleIndex", manager.firstVisibleIndex, 3);
    check("cellPitch", manager.cellPitch, 128);

    manager.initialize({
        entryBuffer: [symbol(7)],           // 1×3 → 3 格
        visible: [symbol(1), symbol(2), symbol(3)],
        exitBuffer: [symbol(6), symbol(4)],  // 1×2 + 1×1 → 3 格
    });

    check("展開後總格數", manager.symbols.length, 9);
    check("逐格 Symbol ID", symbolIds(manager), [7, 7, 7, 1, 2, 3, 6, 6, 4]);
    check(
        "逐格 groupOffset（head 在進場側，沿陣列遞增）",
        groupOffsets(manager),
        [0, 1, 2, 0, 0, 0, 0, 1, 0],
    );

    // axis(k) = (k - maxCellSpan - visible/2 + 0.5) * pitch = (k - 4) * 128
    check("進場端最外格位置 axis(0)", manager.getAxisPosition(0), -512);
    check("顯示區第一格 axis(3)", manager.getAxisPosition(3), -128);
    check("顯示區中間格 axis(4)", manager.getAxisPosition(4), 0);
    check("顯示區最後格 axis(5)", manager.getAxisPosition(5), 128);
    check("退場端最外格 axis(8)", manager.getAxisPosition(8), 512);

    check("可視逐 Cell ID", manager.getVisibleCellSymbolIds(), [1, 2, 3]);
}

group("2b. 初始 Layout 的格數驗證");

{
    const registry = createRegistry();
    const manager = createManager(registry);

    checkThrows("visible 格數不足要丟例外", () => {
        manager.initialize({
            entryBuffer: [symbol(7)],
            visible: [symbol(1), symbol(2)],   // 只有 2 格
            exitBuffer: [symbol(7)],
        });
    });

    checkThrows("buffer 格數不符要丟例外", () => {
        manager.initialize({
            entryBuffer: [symbol(1)],          // 只有 1 格，需要 3
            visible: [symbol(1), symbol(2), symbol(3)],
            exitBuffer: [symbol(7)],
        });
    });
}

// ───────────────────────── 3. 位移與交接計數 ─────────────────────────

group("3. stripOffset 取模與交接計數");

{
    const registry = createRegistry();
    const manager = createManager(registry);
    manager.initialize({
        entryBuffer: [symbol(7)],
        visible: [symbol(1), symbol(2), symbol(3)],
        exitBuffer: [symbol(7)],
    });

    check("起始 stripOffset", manager.stripOffset, 0);
    check("走 0 距離不需交接", manager.applyMovementValue(0), 0);

    check("走半格：不交接", manager.applyMovementValue(64), 0);
    check("走半格後的 stripOffset", manager.stripOffset, 64);
    check("半格時整軸位移反映到位置", manager.getAxisPosition(4), 64);

    check("走滿一格：欠 1 次交接", manager.applyMovementValue(128), 1);
    check("走滿一格後 stripOffset 歸零", manager.stripOffset, 0);

    // 尚未執行交接，所以欠的次數會持續累積
    check("再走兩格：累積欠 3 次", manager.applyMovementValue(384), 3);

    manager.recycleExitedCell(symbol(5));
    check("交接一次後剩 2 次", manager.applyMovementValue(384), 2);
}

group("3b. stripOffset 不累積誤差");

{
    const registry = createRegistry();
    const manager = createManager(registry);
    manager.initialize({
        entryBuffer: [symbol(7)],
        visible: [symbol(1), symbol(2), symbol(3)],
        exitBuffer: [symbol(7)],
    });

    // 模擬一萬次半格推進；stripOffset 由取模得到，不應漂移
    let value = 0;

    for (let i = 0; i < 10000; i++) {
        value += 64;
        const pending = manager.applyMovementValue(value);

        for (let n = 0; n < pending; n++) {
            manager.recycleExitedCell(symbol(1));
        }
    }

    check("一萬次半格後 stripOffset 精確為 0", manager.stripOffset, 0);
    check("總行進距離", value, 640000);
}

// ───────────────────────── 4. groupOffset 推導 ─────────────────────────

group("4. handoff 的 groupOffset 推導");

{
    const registry = createRegistry();
    const manager = createManager(registry);
    manager.initialize({
        entryBuffer: [symbol(1), symbol(2), symbol(3)],
        visible: [symbol(1), symbol(2), symbol(3)],
        exitBuffer: [symbol(1), symbol(2), symbol(3)],
    });

    // 連續送入三格 1×3：退場側先進場，offset 應為 2 → 1 → 0
    manager.recycleExitedCell(symbol(7));
    check("1×3 第一格（最先進場）offset = 2", manager.symbols[0].groupOffset, 2);

    manager.recycleExitedCell(symbol(7));
    check("1×3 第二格 offset = 1", manager.symbols[0].groupOffset, 1);

    manager.recycleExitedCell(symbol(7));
    check("1×3 第三格 offset = 0（head）", manager.symbols[0].groupOffset, 0);

    check(
        "整組讀起來是 head → follower",
        groupOffsets(manager).slice(0, 3),
        [0, 1, 2],
    );

    // 不同 ID 緊接著要開新組
    manager.recycleExitedCell(symbol(5));
    check("換 ID 後開新組 offset = 0", manager.symbols[0].groupOffset, 0);

    // 同 ID 但前一組已湊滿，也要開新組
    manager.recycleExitedCell(symbol(6));
    manager.recycleExitedCell(symbol(6));
    check("1×2 湊滿後 offset", groupOffsets(manager).slice(0, 2), [0, 1]);

    manager.recycleExitedCell(symbol(6));
    check(
        "同 ID 但前組已滿 → 開新組 offset = 1",
        manager.symbols[0].groupOffset,
        1,
    );
}

// ───────────────────────── 5. 結果對齊 ─────────────────────────

group("5. isAligned");

{
    const registry = createRegistry();
    const manager = createManager(registry);
    manager.initialize({
        entryBuffer: [symbol(7)],
        visible: [symbol(1), symbol(2), symbol(3)],
        exitBuffer: [symbol(7)],
    });

    check(
        "盤面相符即對齊",
        manager.isAligned([symbol(1), symbol(2), symbol(3)]),
        true,
    );
    check(
        "盤面不符不對齊",
        manager.isAligned([symbol(1), symbol(2), symbol(4)]),
        false,
    );
    check("長度不符不對齊", manager.isAligned([symbol(1)]), false);

    // 要求輪次標記，但目前 runtime 沒有標記
    check(
        "輪次標記不符不對齊",
        manager.isAligned([symbol(1), symbol(2), symbol(3)], 7),
        false,
    );

    // 停在半格時不得判定為對齊
    manager.applyMovementValue(64);
    check(
        "半格位置不得對齊",
        manager.isAligned([symbol(1), symbol(2), symbol(3)]),
        false,
    );
}

// ───────────────────────── 6. 進場 buffer 的 group 完整性 ─────────────────────────

group("6. getReplaceableEntryRuntimes（跨輪不得砍掉 group 的 head）");

{
    const registry = createRegistry();
    const manager = createManager(registry);

    // 進場 buffer 剛好放滿一個 1×3 → 整組都在 buffer 內，三格都可換
    manager.initialize({
        entryBuffer: [symbol(7)],
        visible: [symbol(1), symbol(2), symbol(3)],
        exitBuffer: [symbol(7)],
    });
    check(
        "整組都在 buffer 內 → 三格皆可換",
        manager.getReplaceableEntryRuntimes().length,
        3,
    );

    // buffer 內是 1×1 + 1×2，也都在 buffer 內
    manager.initialize({
        entryBuffer: [symbol(1), symbol(6)],
        visible: [symbol(1), symbol(2), symbol(3)],
        exitBuffer: [symbol(7)],
    });
    check(
        "1×1 + 1×2 皆在 buffer 內 → 三格皆可換",
        manager.getReplaceableEntryRuntimes().length,
        3,
    );

    // 模擬上一輪停在截斷盤面：1×3 的 head 在 buffer 最內側，
    // 兩個 follower 已經進入顯示區
    manager.initialize({
        entryBuffer: [symbol(1), symbol(2), symbol(3)],
        visible: [symbol(1), symbol(2), symbol(3)],
        exitBuffer: [symbol(7)],
    });
    manager.recycleExitedCell(symbol(7));
    manager.recycleExitedCell(symbol(7));
    manager.recycleExitedCell(symbol(7));
    // 此時 index 0,1,2 是 1×3 的 head/1/2，整組仍在 buffer 內
    check(
        "剛進場的 1×3 整組在 buffer 內 → 可換",
        manager.getReplaceableEntryRuntimes().length,
        3,
    );

    // 再推進一格，head 仍在 buffer 但第三格已落入顯示區
    manager.recycleExitedCell(symbol(5));
    check(
        "1×3 跨越 buffer 邊界時，越界那組之後不得再換",
        manager.getReplaceableEntryRuntimes().length,
        1,
    );
    check(
        "可換的只有最外側那格",
        manager.getReplaceableEntryRuntimes()[0].data.id,
        5,
    );
}

// ───────────────────────── 7. commitResult 收尾補格 ─────────────────────────

group("7. ReelDataFlow.commitResult 的 group 收尾");

{
    const registry = createRegistry();
    const resolver = (data: SymbolData) => registry.getCellSpan(data.id);
    const validator = () => undefined;
    const provider = () => symbol(1);

    // [7,7,1]：7 是 1×3，只露出兩格 → 需要補 1 格 7 當 head
    const flow = new ReelDataFlow();
    flow.setPerformanceDataBank([symbol(1)], resolver);
    flow.beginSpin();

    const retained = flow.commitResult(
        [symbol(7), symbol(7), symbol(1)],
        [],
        0,               // 不保留表演 Cell
        true,            // 進場端在畫面開頭 → 結果需反轉成進場順序
        0,               // 進場端沒有未湊滿的 group
        resolver,
        provider,
        validator,
    );

    check("不保留表演 Cell", retained, 0);
    check(
        "結果佇列（進場順序）＝ 1,7,7 再補一格 7",
        flow.dataList.remainingData.map((d) => d.id),
        [1, 7, 7, 7],
    );

    // [7,7,7,7]：7 是 1×3 時 → 掃描為 3+1，最後一格 offset = 2，補 2 格
    const flow2 = new ReelDataFlow();
    flow2.setPerformanceDataBank([symbol(1)], resolver);
    flow2.beginSpin();
    flow2.commitResult(
        [symbol(7), symbol(7), symbol(7), symbol(7)],
        [],
        0,
        true,
        0,               // 進場端沒有未湊滿的 group
        resolver,
        provider,
        validator,
    );
    check(
        "[7,7,7,7] 補足第二組",
        flow2.dataList.remainingData.map((d) => d.id),
        [7, 7, 7, 7, 7, 7],
    );

    // 全 1×1 不需補格
    const flow3 = new ReelDataFlow();
    flow3.setPerformanceDataBank([symbol(1)], resolver);
    flow3.beginSpin();
    flow3.commitResult(
        [symbol(1), symbol(2), symbol(3)],
        [],
        0,
        true,
        0,               // 進場端沒有未湊滿的 group
        resolver,
        provider,
        validator,
    );
    check(
        "全 1×1 不補格",
        flow3.dataList.remainingData.map((d) => d.id),
        [3, 2, 1],
    );
}

group("7b. 表演資料展開成 Cell");

{
    const registry = createRegistry();
    const resolver = (data: SymbolData) => registry.getCellSpan(data.id);

    const flow = new ReelDataFlow();
    flow.setPerformanceDataBank([symbol(7), symbol(1)], resolver);

    check(
        "1×3 展開成 3 筆、1×1 展開成 1 筆",
        flow.dataList.remainingData.map((d) => d.id),
        [7, 7, 7, 1],
    );
    check("牌庫本身仍以 Symbol 為單位", flow.getNextPerformanceData().id, 7);
}

group("7c. 依 Cell 預算保留表演資料");

{
    const registry = createRegistry();
    const resolver = (data: SymbolData) => registry.getCellSpan(data.id);
    const validator = () => undefined;
    const provider = () => symbol(1);

    const flow = new ReelDataFlow();
    flow.setPerformanceDataBank([symbol(1), symbol(1), symbol(1)], resolver);
    flow.beginSpin();

    const retained = flow.commitResult(
        [symbol(1), symbol(2), symbol(3)],
        [],
        5,               // 預算 5 格，但牌庫只剩 3 格 → 不足處由 provider 補
        true,
        0,               // 進場端沒有未湊滿的 group
        resolver,
        provider,
        validator,
    );

    check("保留的表演 Cell 數等於預算", retained, 5);
    check(
        "表演 Cell 在結果之前",
        flow.dataList.remainingData.length,
        5 + 3,
    );
}

// ────────── 7f. 截斷盤面：進場端與退場端都要補 ──────────

/*
 * head 恆在進場側，所以大 Symbol 進場時 head 最後到（截在進場端），
 * 出場時 head 最後走（截在退場端）。兩端都是滾動的必經狀態。
 * 詳見 doc/Slot-Base-Unit-Refactor-1x1.md 決議 4 與 §2.3。
 */
group("7f. 截斷盤面：進場端與退場端都要補");

{
    const registry = createRegistry();
    const resolver = (data: SymbolData) => registry.getCellSpan(data.id);
    const validator = () => undefined;
    const provider = () => symbol(1);

    /** 提交盤面（畫面上→下），回傳整條 strip 對齊後的 id:offset。 */
    function settle(board: number[]): string[] {
        const manager = createManager(registry);
        manager.initialize({
            entryBuffer: [symbol(1), symbol(1), symbol(1)],
            visible: [symbol(1), symbol(1), symbol(1)],
            exitBuffer: [symbol(1), symbol(1), symbol(1)],
        });

        const flow = new ReelDataFlow();
        flow.setPerformanceDataBank([symbol(1)], resolver);
        flow.beginSpin();
        flow.commitResult(
            board.map(symbol),
            [],
            0,
            true,
            0,
            resolver,
            provider,
            validator,
        );

        const queued = flow.dataList.remainingData.length;

        for (let index = 0; index < queued; index++) {
            const consumed = flow.consumeNextData(
                provider,
                validator,
                resolver,
            );
            manager.recycleExitedCell(consumed.data, consumed.resultSpinId);
        }

        /*
         * 全部消耗完之後，最後進場的是進場端補格，它停在 idx0；
         * 結果的可視段因此落在 idx(補格數) 起算，還差
         * firstVisibleIndex - 補格數 次回收才會走進可視區。
         */
        const exitPad = flow.countExitTruncationCells(
            board.map(symbol),
            true,
            resolver,
        );
        const entryPad = queued - board.length - exitPad;

        for (
            let index = 0;
            index < manager.firstVisibleIndex - entryPad;
            index++
        ) {
            manager.recycleExitedCellKeepingData();
        }

        return manager.symbols
            .slice(
                manager.firstVisibleIndex,
                manager.firstVisibleIndex + manager.visibleCellCount,
            )
            .map((r) => `${r.data.id}:${r.groupOffset}`);
    }

    check(
        "進場端截斷 [7,7,2]：head 在畫面上方外，可視是 offset 1,2",
        settle([7, 7, 2]),
        ["7:1", "7:2", "2:0"],
    );
    check(
        "退場端截斷 [1,2,7]：head 在最下一格，身體在畫面下方外",
        settle([1, 2, 7]),
        ["1:0", "2:0", "7:0"],
    );
    check(
        "退場端截斷 [2,7,7]：露出 head 與第一個 follower",
        settle([2, 7, 7]),
        ["2:0", "7:0", "7:1"],
    );
    check(
        "完整一組 [7,7,7]：兩端都不必補",
        settle([7, 7, 7]),
        ["7:0", "7:1", "7:2"],
    );
    check(
        "全 1×1 不受影響",
        settle([1, 2, 3]),
        ["1:0", "2:0", "3:0"],
    );
}

// ────────── 7e. 預算切資料不得切在 group 中間 ──────────

/*
 * takePerformanceCellsByBudget() 逐「組」取，不逐格取。
 * 切一半會在正式結果正前面留下湊不滿的 group（doc §3.5、§6）。
 */
group("7e. 預算切資料不得切在 group 中間");

{
    const registry = createRegistry();
    const resolver = (data: SymbolData) => registry.getCellSpan(data.id);
    const validator = () => undefined;
    const provider = () => symbol(1);

    /** 結果固定是三張 1×1，所以佇列末三格恆為 [1,1,1]。 */
    function commitWithBudget(
        cellBudget: number,
        bank: SymbolData[],
        padProvider = provider,
    ): number[] {
        const flow = new ReelDataFlow();
        flow.setPerformanceDataBank(bank, resolver);
        flow.beginSpin();
        flow.commitResult(
            [symbol(1), symbol(1), symbol(1)],
            [],
            cellBudget,
            true,
            0,
            resolver,
            padProvider,
            validator,
        );
        return flow.dataList.remainingData.map((d) => d.id);
    }

    /* 佇列 = [7,7,7, 2]：開頭一張 1×3，後面一張 1×1。 */
    const mixedBank = [symbol(7), symbol(2)];

    check(
        "預算 2 放不下 1×3，整組跳過並改用 1×1 補滿，不切成兩格 7",
        commitWithBudget(2, mixedBank),
        [1, 1, 1, 1, 1],
    );
    check(
        "預算 3 剛好放得下整組 1×3",
        commitWithBudget(3, mixedBank),
        [7, 7, 7, 1, 1, 1],
    );
    check(
        "預算 4 放完 1×3 之後，佇列自己的 1×1 也放得下",
        commitWithBudget(4, mixedBank),
        [7, 7, 7, 2, 1, 1, 1],
    );
    check(
        "預算 0 一格表演牌都不留",
        commitWithBudget(0, mixedBank),
        [1, 1, 1],
    );

    /* 佇列 = [7,7,7]：用完之後零頭只能向牌庫要（provider 回 1×1）。 */
    check(
        "佇列用完後零頭由牌庫的 1×1 補滿",
        commitWithBudget(4, [symbol(7)]),
        [7, 7, 7, 1, 1, 1, 1],
    );
    check(
        "牌庫只剩放不下的大牌時，接受低於預算而不切壞它",
        commitWithBudget(2, [symbol(7)], () => symbol(7)).length,
        3,
    );
}

// ────────── 7d. 決議 30：拆掉進場端沒湊滿的那一組 ──────────

/*
 * 情境：表演牌庫裡有一張 1×3（id 7），它只進場了兩格，head 還沒進來。
 * 這時候正式結果也是 7 —— resolveGroupOffset() 只比對 id 與 offset，
 * 不拆掉的話結果的第一格會被接進那組沒湊滿的表演牌裡。
 *
 * 詳見 doc/Slot-Base-Unit-Refactor-1x1.md §2.2.2。
 */
group("7d. 決議 30：拆掉進場端沒湊滿的那一組");

{
    const registry = createRegistry();
    const resolver = (data: SymbolData) => registry.getCellSpan(data.id);
    const validator = () => undefined;
    const provider = () => symbol(1);

    /** 建出「1×3 表演牌只進場兩格」的狀態。 */
    function createPartiallyEnteredGroup(): {
        manager: ReelIconManager;
        flow: ReelDataFlow;
    } {
        const manager = createManager(registry);
        manager.initialize({
            entryBuffer: [symbol(1), symbol(1), symbol(1)],
            visible: [symbol(1), symbol(1), symbol(1)],
            exitBuffer: [symbol(1), symbol(1), symbol(1)],
        });

        const flow = new ReelDataFlow();
        flow.setPerformanceDataBank([symbol(7), symbol(1)], resolver);
        flow.beginSpin();

        for (let index = 0; index < 2; index++) {
            const consumed = flow.consumeNextData(
                provider,
                validator,
                resolver,
            );
            manager.recycleExitedCell(consumed.data, consumed.resultSpinId);
        }

        return { manager, flow };
    }

    /** 把結果三格實際餵進場，回傳整條 strip 的 groupOffset。 */
    function enterResultCells(
        manager: ReelIconManager,
        flow: ReelDataFlow,
    ): number[] {
        for (let index = 0; index < 3; index++) {
            const consumed = flow.consumeNextData(
                provider,
                validator,
                resolver,
            );
            manager.recycleExitedCell(consumed.data, consumed.resultSpinId);
        }

        return groupOffsets(manager);
    }

    // ── 拆解本身
    {
        const { manager, flow } = createPartiallyEnteredGroup();

        check(
            "進場端最外格回報還缺 1 格",
            manager.incompleteEntryGroupPendingCellCount,
            1,
        );
        check(
            "拆解前進場端是 1×3 的兩格 follower",
            groupOffsets(manager).slice(0, 2),
            [1, 2],
        );

        const filler = flow.takeSingleCellPerformanceSymbol(
            resolver,
            provider,
            validator,
        );

        check("牌庫取得的 filler 是 1×1", resolver(filler), 1);
        check(
            "改寫格數 = 已進場的格數",
            manager.dissolveIncompleteEntryGroup(filler),
            2,
        );
        check(
            "拆解後那兩格各自成組",
            groupOffsets(manager).slice(0, 2),
            [0, 0],
        );
        check(
            "拆解後進場端邊界乾淨",
            manager.incompleteEntryGroupPendingCellCount,
            0,
        );
        checkThrows("filler 不是 1×1 就丟例外", () => {
            const another = createPartiallyEnteredGroup();
            another.manager.dissolveIncompleteEntryGroup(symbol(6));
        });
    }

    // ── 拆解之後提交結果：group 不再被吸走
    {
        const { manager, flow } = createPartiallyEnteredGroup();
        const pendingCellCount =
            manager.incompleteEntryGroupPendingCellCount;
        const filler = flow.takeSingleCellPerformanceSymbol(
            resolver,
            provider,
            validator,
        );
        manager.dissolveIncompleteEntryGroup(filler);

        flow.commitResult(
            [symbol(7), symbol(7), symbol(7)],
            [],
            0,
            true,
            pendingCellCount,
            resolver,
            provider,
            validator,
        );

        check(
            "被拆那組的未讀尾段一併從佇列丟棄",
            flow.dataList.remainingData.map((d) => d.id),
            [7, 7, 7],
        );
        check(
            "結果入場後 head 在進場側，offset 遞增",
            enterResultCells(manager, flow).slice(0, 3),
            [0, 1, 2],
        );
    }

    // ── 對照組：不拆就會被吸走（這條在修正前會通過，修正後仍應維持）
    {
        const { manager, flow } = createPartiallyEnteredGroup();

        flow.commitResult(
            [symbol(7), symbol(7), symbol(7)],
            [],
            0,
            true,
            0,               // 不告知拆解，等同修正前的行為
            resolver,
            provider,
            validator,
        );

        check(
            "不拆的話結果被沒湊滿的那組吸走，錯位成 1,2,0",
            enterResultCells(manager, flow).slice(0, 3),
            [1, 2, 0],
        );
    }
}

// ───────────────────────── 統計 ─────────────────────────

console.log("\n" + "═".repeat(52));
console.log(`  通過 ${passCount}　失敗 ${failCount}`);
console.log("═".repeat(52));

if (failCount > 0) {
    process.exit(1);
}
