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
import { BaseReelIcon } from "../src/SlotMachine/Core/Reel/BaseReelIcon";
import { BaseReel } from "../src/SlotMachine/Core/Reel/BaseReel";
import { ReelIconDirection } from "../src/SlotMachine/Core/Reel/Config/ReelIconDirection";
import {
    ReelIconCell,
    ReelIconLayout,
} from "../src/SlotMachine/Core/Reel/Data/ReelData";

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

// ────────── 8. ReelIconCell 投影與 getGroupIcons ──────────

group("8. Icon 的 cell／layout 分離");

/** 記錄 hook 觸發次數的探針 Icon。 */
class ProbeIcon extends BaseReelIcon {
    public cellChangedCount = 0;
    public layoutChangedCount = 0;

    protected onCellChanged(cell: ReelIconCell): void {
        this.cellChangedCount++;
    }

    protected onLayoutChanged(layout: ReelIconLayout): void {
        this.layoutChangedCount++;
    }
}

function attachIcons(manager: ReelIconManager): ProbeIcon[] {
    const container = new egret.DisplayObjectContainer();
    manager.initializeIcons(container, () => new ProbeIcon());
    return manager.icons as ProbeIcon[];
}

/** Icon 物件有 parent 迴圈，不能直接 JSON 比較，一律換成索引。 */
function iconIndices(
    manager: ReelIconManager,
    icons: BaseReelIcon[],
): number[] {
    const all = manager.icons;
    return icons.map((icon) => all.indexOf(icon));
}

function createAttachedManager(): {
    manager: ReelIconManager;
    icons: ProbeIcon[];
} {
    const registry = createRegistry();
    const manager = createManager(registry);

    manager.initialize({
        entryBuffer: [symbol(7)],            // 1×3 → idx0~2
        visible: [symbol(1), symbol(2), symbol(3)],
        exitBuffer: [symbol(6), symbol(4)],  // 1×2 + 1×1 → idx6~8
    });

    return { manager, icons: attachIcons(manager) };
}

{
    const { icons } = createAttachedManager();

    check(
        "head 的 cell：groupOffset 0、cellSpan 3",
        [icons[0].cell.groupOffset, icons[0].cell.cellSpan],
        [0, 3],
    );
    check(
        "follower 的 cell：groupOffset 遞增，cellSpan 不變",
        [icons[2].cell.groupOffset, icons[2].cell.cellSpan],
        [2, 3],
    );
    check("1×1 的 cellSpan", icons[3].cell.cellSpan, 1);
    check("未註冊 displayPriority 時為 0", icons[0].cell.displayPriority, 0);

    check("isGroupHead 讀 cell", icons[0].isGroupHead, true);
    check("follower 不是 head", icons[1].isGroupHead, false);

    check(
        "layout.index 等於自己在陣列上的位置",
        icons.map((icon) => icon.layout.index),
        [0, 1, 2, 3, 4, 5, 6, 7, 8],
    );
}

group("8b. onCellChanged 只在該格的內容真的變了才觸發");

{
    const { manager, icons } = createAttachedManager();
    const baseCell = icons.map((icon) => icon.cellChangedCount);
    const baseLayout = icons.map((icon) => icon.layoutChangedCount);

    check("建立時每格各收到一次 cell", baseCell, [1, 1, 1, 1, 1, 1, 1, 1, 1]);

    // 只推進位置，不交接
    manager.applyMovementValue(CELL_SIZE * 0.5);
    manager.syncAllIcons();
    manager.applyMovementValue(CELL_SIZE * 0.75);
    manager.syncAllIcons();

    check(
        "位置動了兩次，cell 一次都沒重推",
        icons.map((icon) => icon.cellChangedCount),
        baseCell,
    );
    check(
        "layout 每次同步都推",
        icons.map(
            (icon, index) => icon.layoutChangedCount - baseLayout[index],
        ),
        [2, 2, 2, 2, 2, 2, 2, 2, 2],
    );

    /*
     * 交接只輪轉 _symbols，_icons 不動，所以第 k 格的 Icon 會換成
     * 顯示原本第 k-1 格的資料 —— 多數槽位的內容都變了。
     * idx4／idx5 前後都是 (groupOffset 0, cellSpan 1)，值沒變就不重推。
     */
    manager.recycleExitedCell(symbol(7));
    manager.syncAllIcons();

    check(
        "交接後只有 cell 內容真的不同的槽位重推",
        icons.map(
            (icon, index) => icon.cellChangedCount - baseCell[index],
        ),
        [1, 1, 1, 1, 0, 0, 1, 1, 1],
    );
}

{
    // 全 1×1 的 strip：交接完每一格的 cell 值都相同，一次都不該重推
    const registry = createRegistry();
    const manager = createManager(registry);

    manager.initialize({
        entryBuffer: [symbol(1), symbol(2), symbol(3)],
        visible: [symbol(1), symbol(2), symbol(3)],
        exitBuffer: [symbol(1), symbol(2), symbol(3)],
    });
    const icons = attachIcons(manager);
    const baseCell = icons.map((icon) => icon.cellChangedCount);

    manager.recycleExitedCell(symbol(4));
    manager.syncAllIcons();

    check(
        "全 1×1 時交接不觸發任何 cell 重推",
        icons.map(
            (icon, index) => icon.cellChangedCount - baseCell[index],
        ),
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
    );
}

group("8c. getGroupIcons");

{
    const { manager } = createAttachedManager();
    const symbols = manager.symbols;

    check(
        "從 head 取 1×3 整組",
        iconIndices(manager, manager.getGroupIcons(symbols[0])),
        [0, 1, 2],
    );
    check(
        "從 follower 取也是同一組",
        iconIndices(manager, manager.getGroupIcons(symbols[2])),
        [0, 1, 2],
    );
    check(
        "1×1 自成一組",
        iconIndices(manager, manager.getGroupIcons(symbols[4])),
        [4],
    );
    check(
        "1×2 取得兩格",
        iconIndices(manager, manager.getGroupIcons(symbols[7])),
        [6, 7],
    );
    check(
        "整組裡 head 只有一個且在最前",
        manager.getGroupIcons(symbols[1]).map((icon) => icon.isGroupHead),
        [true, false, false],
    );

    checkThrows("不在 strip 上的 runtime 要丟例外", () => {
        manager.getGroupIcons({
            data: symbol(1),
            groupOffset: 0,
            cellOffset: 0,
        });
    });
}

group("8d. getGroupIcons 在 strip 兩端截斷時");

{
    // 進場端：一張 1×3 只進來最尾巴那格，head 還在佇列裡
    const { manager } = createAttachedManager();

    manager.recycleExitedCell(symbol(7));
    manager.syncAllIcons();

    check(
        "剛進場的那格是 follower（offset = cellSpan - 1）",
        manager.symbols[0].groupOffset,
        2,
    );
    check(
        "head 不在 strip 上，只取得已進場的一格",
        iconIndices(manager, manager.getGroupIcons(manager.symbols[0])),
        [0],
    );
    check(
        "取得的那格不是 head",
        manager.getGroupIcons(manager.symbols[0])[0].isGroupHead,
        false,
    );
    check(
        "headIndex 算出來是負數，代表尚未進場",
        manager.icons[0].layout.index - manager.symbols[0].groupOffset,
        -2,
    );
}

{
    // 退場端：把初始那張 1×3 推到 strip 尾端，follower 陸續被回收
    const { manager } = createAttachedManager();

    for (let count = 0; count < 7; count++) {
        manager.recycleExitedCell(symbol(1));
    }
    manager.syncAllIcons();

    check(
        "推 7 格之後 1×3 的 head 落在 idx7",
        [manager.symbols[7].data.id, manager.symbols[7].groupOffset],
        [7, 0],
    );
    check(
        "只取得還在 strip 上的兩格",
        iconIndices(manager, manager.getGroupIcons(manager.symbols[7])),
        [7, 8],
    );
    check(
        "head 仍在其中，且是最前面那個",
        manager.getGroupIcons(manager.symbols[7])[0].isGroupHead,
        true,
    );

    manager.recycleExitedCell(symbol(1));
    manager.syncAllIcons();

    check(
        "再推一格只剩 head",
        iconIndices(manager, manager.getGroupIcons(manager.symbols[8])),
        [8],
    );
}

{
    // 相鄰兩個同 id 的 group 不可以被黏成一組
    const registry = createRegistry();
    const manager = createManager(registry);

    manager.initialize({
        entryBuffer: [symbol(7)],
        visible: [symbol(7)],
        exitBuffer: [symbol(1), symbol(2), symbol(3)],
    });
    attachIcons(manager);

    check(
        "兩組 1×3 相鄰時 offset 各自歸零",
        groupOffsets(manager),
        [0, 1, 2, 0, 1, 2, 0, 0, 0],
    );
    check(
        "前一組只取到自己這三格",
        iconIndices(manager, manager.getGroupIcons(manager.symbols[1])),
        [0, 1, 2],
    );
    check(
        "後一組也只取到自己這三格",
        iconIndices(manager, manager.getGroupIcons(manager.symbols[4])),
        [3, 4, 5],
    );
}

// ────────── 9. getVisibleIcons：不完整大圖的盤面 ──────────

/*
 * 「可視段的每一格」與「圖有露出來的 group」在截斷盤面上會分岔：
 * follower 不畫圖，真正畫著圖的 head 可能待在 buffer 裡。
 * getVisibleIcons() 回傳的是後者，一個 group 只回一個載體。
 */
group("9. getVisibleIcons 在截斷盤面上");

{
    const registry = createRegistry();
    const resolver = (data: SymbolData) => registry.getCellSpan(data.id);
    const validator = () => undefined;
    const provider = () => symbol(1);

    /** 提交盤面（畫面上→下）並讓它停穩，回傳接好 Icon 的 manager。 */
    function settleWithIcons(board: number[]): ReelIconManager {
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

        attachIcons(manager);
        return manager;
    }

    /** 把 getVisibleIcons() 印成「索引:id」，與測試場景的狀態列同格式。 */
    function describe(manager: ReelIconManager): string[] {
        const all = manager.icons;

        return manager.getVisibleIcons().map((icon) => {
            return `${all.indexOf(icon)}:${icon.data.id}`;
        });
    }

    /** 可視段的每一格，用來對照。 */
    function visibleCells(manager: ReelIconManager): string[] {
        return manager.getVisibleRuntimes()
            .map((r) => `${r.data.id}:${r.groupOffset}`);
    }

    {
        const manager = settleWithIcons([7, 7, 7]);
        check("完整 1×3：可視段三格", visibleCells(manager), ["7:0", "7:1", "7:2"]);
        check("完整 1×3：只回 head 一個載體", describe(manager), ["3:7"]);
    }

    {
        const manager = settleWithIcons([7, 7, 2]);
        check(
            "進場端截斷 [7,7,2]：可視段是兩個不畫圖的 follower",
            visibleCells(manager),
            ["7:1", "7:2", "2:0"],
        );
        check(
            "進場端截斷 [7,7,2]：head 在 idx2（buffer 內）也要回傳",
            describe(manager),
            ["2:7", "5:2"],
        );
    }

    {
        const manager = settleWithIcons([7, 1, 1]);
        check(
            "只露一格 [7,1,1]：可視段第一格是 offset 2",
            visibleCells(manager),
            ["7:2", "1:0", "1:0"],
        );
        check(
            "只露一格 [7,1,1]：head 落在 idx1，更深的 buffer 位置",
            describe(manager),
            ["1:7", "4:1", "5:1"],
        );
    }

    {
        const manager = settleWithIcons([2, 7, 7]);
        check(
            "退場端截斷 [2,7,7]：可視段是 head 與第一個 follower",
            visibleCells(manager),
            ["2:0", "7:0", "7:1"],
        );
        check(
            "退場端截斷 [2,7,7]：兩格屬同一組，只回一次",
            describe(manager),
            ["3:2", "4:7"],
        );
    }

    {
        const manager = settleWithIcons([1, 2, 7]);
        check(
            "退場端截斷 [1,2,7]：只露 head",
            visibleCells(manager),
            ["1:0", "2:0", "7:0"],
        );
        check(
            "退場端截斷 [1,2,7]：三組各回一個",
            describe(manager),
            ["3:1", "4:2", "5:7"],
        );
    }

    {
        const manager = settleWithIcons([1, 2, 3]);
        check(
            "純 1×1：兩種查詢等長",
            describe(manager),
            ["3:1", "4:2", "5:3"],
        );
    }
}

group("9b. 滾動中 stripOffset > 0 時多露一格");

{
    const { manager } = createAttachedManager();

    check(
        "對齊時進場 buffer 的 1×3 不列入",
        manager.getVisibleIcons().length,
        3,
    );

    // 滑動不到一格，進場側再外面那一格會露出一部分
    manager.applyMovementValue(CELL_SIZE * 0.5);
    manager.syncAllIcons();

    check(
        "滑動後 idx2 露出一部分，它那組的 head（idx0）要列入",
        iconIndices(manager, manager.getVisibleIcons()),
        [0, 3, 4, 5],
    );

    // 走完一整格回到對齊
    manager.applyMovementValue(CELL_SIZE);
    manager.syncAllIcons();

    check(
        "回到對齊時邊緣交集為零，不列入",
        manager.getVisibleIcons().length,
        3,
    );
}

// ────────── 10. 四個滾動方向 ──────────

/*
 * 方向只影響三個地方：mapAxisToLocal()（軸向映射到哪個座標軸與正負號）、
 * createDisplayMaskRect()（長邊擺哪一軸）、resultEntryAtDisplayStart()
 * （結果的閱讀順序要不要反轉）。其餘幾何完全不含方向。
 *
 * 第三項原本從 Cocos 版一字不改搬過來（`Vertical ? !inverse : inverse`），
 * 但 Cocos 的水平正向是右→左，移植時 mapAxisToLocal() 改成左→右卻沒同步，
 * 於是 Horizontal 整個反掉。以下是那個回歸的守門斷言。
 */
group("10. 四方向：方向慣例的單一來源");

{
    function directionOf(
        layoutType: ReelIconDirection,
        inverseDirection: boolean,
    ): { exitPositive: boolean; entryAtStart: boolean } {
        const manager = createManager(createRegistry());
        manager.configureDisplay(layoutType, inverseDirection);

        return {
            exitPositive: manager.exitTowardPositiveAxis,
            entryAtStart: manager.resultEntryAtDisplayStart,
        };
    }

    const V = ReelIconDirection.Vertical;
    const H = ReelIconDirection.Horizontal;

    check("垂直正向：退場往 +y（下），進場在閱讀順序開頭", directionOf(V, false), {
        exitPositive: true,
        entryAtStart: true,
    });
    check("垂直反向：退場往 -y（上），進場在結尾", directionOf(V, true), {
        exitPositive: false,
        entryAtStart: false,
    });
    check("水平正向：退場往 +x（右），進場在閱讀順序開頭", directionOf(H, false), {
        exitPositive: true,
        entryAtStart: true,
    });
    check("水平反向：退場往 -x（左），進場在結尾", directionOf(H, true), {
        exitPositive: false,
        entryAtStart: false,
    });

    check(
        "layoutType 原樣讀得回來",
        [directionOf(V, false), directionOf(H, false)].length === 2
            && createManager(createRegistry()).layoutType === V,
        true,
    );
}

group("10b. 軸向映射與 mask");

{
    function layoutAt(
        layoutType: ReelIconDirection,
        inverseDirection: boolean,
        index: number,
    ): { x: number; y: number } {
        const registry = createRegistry();
        const manager = createManager(registry);
        manager.configureDisplay(layoutType, inverseDirection);
        manager.initialize({
            entryBuffer: [symbol(7)],
            visible: [symbol(1), symbol(2), symbol(3)],
            exitBuffer: [symbol(6), symbol(4)],
        });
        attachIcons(manager);

        const layout = manager.icons[index].layout;
        return { x: layout.x, y: layout.y };
    }

    const V = ReelIconDirection.Vertical;
    const H = ReelIconDirection.Horizontal;

    // axis(3) = (3 - maxCellSpan - visible/2 + 0.5) * pitch = -128
    check("垂直正向：可視第一格在 -y", layoutAt(V, false, 3), { x: 0, y: -128 });
    check("垂直反向：翻號成 +y", layoutAt(V, true, 3), { x: 0, y: 128 });
    check("水平正向：同一個數值改走 x", layoutAt(H, false, 3), { x: -128, y: 0 });
    check("水平反向：翻號成 +x", layoutAt(H, true, 3), { x: 128, y: 0 });

    function maskOf(layoutType: ReelIconDirection): number[] {
        const manager = createManager(createRegistry());
        manager.configureDisplay(layoutType, false);
        const rect = manager.createDisplayMaskRect(160);
        return [rect.x, rect.y, rect.width, rect.height];
    }

    check("垂直：長邊在 y", maskOf(V), [-80, -192, 160, 384]);
    check("水平：長邊在 x", maskOf(H), [-192, -80, 384, 160]);
}

group("10c. 結果的閱讀順序（端對端）");

{
    /** 建一整條可用的 BaseReel，只給必要設定。 */
    function createReel(
        layoutType: ReelIconDirection,
        inverseDirection: boolean,
    ): BaseReel {
        const reel = new BaseReel();
        reel.registerSymbolCells([
            { symbolId: 1, cellSpan: 1 },
            { symbolId: 2, cellSpan: 1 },
            { symbolId: 3, cellSpan: 1 },
            { symbolId: 4, cellSpan: 1 },
            { symbolId: 6, cellSpan: 2 },
            { symbolId: 7, cellSpan: 3 },
        ]);
        reel.init({
            layoutType,
            inverseDirection,
            visibleCellCount: 3,
            cellSize: CELL_SIZE,
            moveInterval: 0.08,
        });
        reel.setInitialLayout({
            entryBuffer: [symbol(7)],
            visible: [symbol(1), symbol(2), symbol(3)],
            exitBuffer: [symbol(6), symbol(4)],
        });
        reel.configureIconDisplay({
            iconFactory: () => new BaseReelIcon(),
        });
        return reel;
    }

    const V = ReelIconDirection.Vertical;
    const H = ReelIconDirection.Horizontal;

    /*
     * ReelLayoutSource 是資料流方向（進場端 → 退場端），所以內部恆為
     * [1,2,3]；讀回來要不要反轉全看進場端在畫面的哪一側。
     */
    check(
        "垂直正向：進場在上，讀回來就是內部順序",
        createReel(V, false).getVisibleCellSymbolIds(),
        [1, 2, 3],
    );
    check(
        "垂直反向：進場在下，讀回來要反轉",
        createReel(V, true).getVisibleCellSymbolIds(),
        [3, 2, 1],
    );
    check(
        "水平正向：進場在左，不反轉（修正前這裡會是 [3,2,1]）",
        createReel(H, false).getVisibleCellSymbolIds(),
        [1, 2, 3],
    );
    check(
        "水平反向：進場在右，要反轉",
        createReel(H, true).getVisibleCellSymbolIds(),
        [3, 2, 1],
    );

    check(
        "getVisibleIcons 也依同一個方向排",
        createReel(H, false)
            .getVisibleIcons()
            .map((icon) => icon.data.id),
        [1, 2, 3],
    );
    check(
        "反向時 getVisibleIcons 跟著反轉",
        createReel(H, true)
            .getVisibleIcons()
            .map((icon) => icon.data.id),
        [3, 2, 1],
    );

    check(
        "BaseReel 轉手的方向出口",
        [
            createReel(H, false).exitTowardPositiveAxis,
            createReel(H, true).exitTowardPositiveAxis,
            createReel(H, false).layoutType === H,
        ],
        [true, false, true],
    );
}

// ───────────────────────── 統計 ─────────────────────────

console.log("\n" + "═".repeat(52));
console.log(`  通過 ${passCount}　失敗 ${failCount}`);
console.log("═".repeat(52));

if (failCount > 0) {
    process.exit(1);
}
