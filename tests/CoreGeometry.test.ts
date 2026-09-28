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
import { BaseMovement } from "../src/SlotMachine/Core/Reel/Internal/BaseMovement";
import { ReelSymbolRegistry } from "../src/SlotMachine/Core/Reel/Data/ReelSymbolRegistry";
import { SymbolData } from "../src/SlotMachine/Core/Reel/Data/SymbolData";
import { BaseReelIcon } from "../src/SlotMachine/Core/Reel/BaseReelIcon";
import { BaseReel } from "../src/SlotMachine/Core/Reel/BaseReel";
import { ReelIconDirection } from "../src/SlotMachine/Core/Reel/Config/ReelIconDirection";
import { ReelEffectConfig } from "../src/SlotMachine/Core/Reel/Config/ReelEffectConfig";
import { BaseSlotMachine } from "../src/SlotMachine/Core/BaseSlotMachine";
import { BaseDropReel } from "../src/SlotMachine/Drop/BaseDropReel";
import { BaseDropSlotMachine } from "../src/SlotMachine/Drop/BaseDropSlotMachine";
import { ReelState } from "../src/SlotMachine/Core/Reel/Runtime/ReelState";
import {
    SlotMachineReelStopTiming,
    SlotMachineReelTiming,
} from "../src/SlotMachine/Core/SlotMachine/Config/SlotMachineSpinConfig";
import {
    ReelIconCell,
    ReelIconLayout,
} from "../src/SlotMachine/Core/Reel/Data/ReelData";
import { RoundManagerMachines } from "../src/SlotMachine/Manager/BaseRoundManager";
import { RollRoundManager } from "../src/SlotMachine/Manager/RollRoundManager";
import { DropRoundManager } from "../src/SlotMachine/Manager/DropRoundManager";
import {
    RoundData,
    RoundStage,
    RoundStepContext,
} from "../src/SlotMachine/Manager/Data/RoundData";

/** 專案沒有裝 @types/node，只宣告本檔用得到的那一個。 */
declare const process: { exit(code: number): void };
declare function setTimeout(handler: () => void, timeout?: number): number;

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

group("3c. BaseMovement：判定走完的那一段，不能因浮點相加差一點點被當成沒走完");

{
    /*
     * 0.0023 + (0.04 − 0.0023) 在浮點下比 0.04 小。以前用 += 累加，
     * 這一段會被當成沒走完而中斷本幀：剩下的 0.0014 秒被丟掉、
     * 緊接的回呼（交接）拖到下一幀，畫面整條軸倒退半格一幀。
     * 幀長不規則時才會碰到，固定幀長的驗算掃不到。
     */
    const movement = new BaseMovement(0);
    let callbackCount = 0;
    movement.moveBy(100, 0.04);
    movement.addCallback(() => {
        callbackCount++;
    });
    movement.moveBy(100, 0.04);

    movement.update(0.0023);
    movement.update(0.0391);

    check("緊接的回呼在同一幀執行", callbackCount, 1);
    check(
        "剩下的 0.0014 秒交給下一段（值 ≈ 103.5）",
        Math.abs(movement.value - 103.5) < 1e-9,
        true,
    );
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
     * 交接時 Icon 跟著資料一起輪轉（與 Cocos 版相同）：每個 Icon 帶著
     * 自己那張牌往退場端移一格，只有走出去的那一個回到進場端換新資料。
     * `icons` 就是內部陣列本身，會跟著轉，所以先存交接前的順序再比。
     */
    const beforeHandoff = icons.slice();
    const cellBefore = beforeHandoff.map((icon) => icon.cellChangedCount);
    const dataBefore = beforeHandoff.map((icon) => icon.data);
    manager.recycleExitedCell(symbol(7));
    manager.syncAllIcons();

    check(
        "每個 Icon 往退場端移一格，最外面那個回到進場端",
        beforeHandoff.map((icon) => manager.icons.indexOf(icon)),
        [1, 2, 3, 4, 5, 6, 7, 8, 0],
    );
    check(
        "只有回到進場端的那個 Icon 換資料，其餘帶著原本的牌",
        beforeHandoff.map((icon, index) => icon.data === dataBefore[index]),
        [true, true, true, true, true, true, true, true, false],
    );
    check(
        "cell 只重推回到進場端的那一個",
        beforeHandoff.map(
            (icon, index) => icon.cellChangedCount - cellBefore[index],
        ),
        [0, 0, 0, 0, 0, 0, 0, 0, 1],
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
// ────────── 11. 多軸協調（機台層） ──────────

/*
 * 這是斷言第一次碰到 BaseSlotMachine。
 *
 * 能測的前提是決議 37：推進抽成 update(deltaTime)，內建心跳只是預設的
 * 那層殼。測試子類別把 startTicking() 覆寫成不做事，整條路就完全不碰
 * 引擎 —— egret 在 BaseSlotMachine 只出現三次，全在 startTicking() /
 * stopTicking() 裡面。
 *
 * 時間因此是決定性的：不依賴牆上時鐘，不會因為機器快慢或分頁節流而 flaky。
 */

/** 只覆寫必要 Hook 的最小機台；不建 Icon，本節不需要顯示層。 */
class HeadlessSlotMachine extends BaseSlotMachine {
    public readonly startLog: { reelIndex: number; at: number }[] = [];
    public readonly stopLog:
        { reelIndex: number; at: number; elapsed: number }[] = [];
    public clock = 0;

    public constructor(
        private readonly _timings: SlotMachineReelTiming[],
        private readonly _fastMode = false,
        private readonly _geometry?: {
            maxCellSpan: number;
            visible: number;
        }[],
        private readonly _stopTimings?: SlotMachineReelStopTiming[],
        private readonly _startEffect?: ReelEffectConfig,
        private readonly _stopEffect?: ReelEffectConfig,
    ) {
        super();
        this.onReelStarted = (reelIndex) => {
            this.startLog.push({ reelIndex, at: this.clock });
        };
        this.onReelStopped = (reelIndex) => {
            this.stopLog.push({
                reelIndex,
                at: this.clock,
                elapsed: this.reelList[reelIndex].elapsedRollTime,
            });
        };
    }

    /** 由測試驅動 update()，不註冊引擎心跳。 */
    protected startTicking(): void {
        // 測試自己推進。
    }

    protected registerInitialReelData(): void {
        this.reelList.forEach((reel, index) => {
            const geometry = this._geometry !== undefined
                ? this._geometry[index]
                : undefined;

            reel.registerSymbolCells([
                { symbolId: 1, cellSpan: 1 },
                { symbolId: 2, cellSpan: 1 },
                { symbolId: 3, cellSpan: 1 },
                { symbolId: 4, cellSpan: 1 },
                { symbolId: 6, cellSpan: 2 },
                { symbolId: 7, cellSpan: 3 },
            ]);
            reel.init({
                visibleCellCount:
                    geometry !== undefined ? geometry.visible : 3,
                cellSize: CELL_SIZE,
                maxCellSpan:
                    geometry !== undefined
                        ? geometry.maxCellSpan
                        : undefined,
                moveInterval: this._timings[index].moveIntervalSeconds,
                startEffect: this._startEffect,
                stopEffect: this._stopEffect,
            });
            reel.setPerformanceDataBank(boardOf([1, 2, 3, 4]));
        });
    }

    protected registerInitialSpinConfigs(): void {
        this.registerSpinConfig("normal", {
            fastMode: this._fastMode,
            reelTimings: this._timings,
            stopTimings: this._stopTimings,
        });
    }

    protected applyInitialLayout(): void {
        this.reelList.forEach((reel, index) => {
            const geometry = this._geometry !== undefined
                ? this._geometry[index]
                : undefined;

            if (geometry === undefined) {
                reel.setInitialLayout({
                    entryBuffer: [symbol(7)],
                    visible: [symbol(1), symbol(2), symbol(3)],
                    exitBuffer: [symbol(6), symbol(4)],
                });
                return;
            }

            reel.setInitialLayout({
                entryBuffer: fill(1, geometry.maxCellSpan),
                visible: fill(2, geometry.visible),
                exitBuffer: fill(3, geometry.maxCellSpan),
            });
        });
    }
}

/** 產生 n 格同一個 1×1 Symbol。 */
function fill(id: number, count: number): SymbolData[] {
    const result: SymbolData[] = [];

    for (let index = 0; index < count; index++) {
        result.push(symbol(id));
    }

    return result;
}

function boardOf(ids: number[]): SymbolData[] {
    return ids.map(symbol);
}

function timing(
    reelIndex: number,
    startDelaySeconds: number,
    targetStopSeconds: number,
): SlotMachineReelTiming {
    return {
        reelIndex,
        startDelaySeconds,
        targetStopSeconds,
        moveIntervalSeconds: 0.08,
    };
}

function createMachine(
    reelCount: number,
    timings: SlotMachineReelTiming[],
    fastMode = false,
    geometry?: { maxCellSpan: number; visible: number }[],
    stopTimings?: SlotMachineReelStopTiming[],
    startEffect?: ReelEffectConfig,
    stopEffect?: ReelEffectConfig,
): HeadlessSlotMachine {
    const machine = new HeadlessSlotMachine(
        timings,
        fastMode,
        geometry,
        stopTimings,
        startEffect,
        stopEffect,
    );
    const reels: BaseReel[] = [];

    for (let index = 0; index < reelCount; index++) {
        reels.push(new BaseReel());
    }

    machine.init(reels);
    return machine;
}

/** 讓 promise 鏈往前走一格。 */
function flush(): Promise<void> {
    return new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
    });
}

/** 以固定步長推進虛擬時間，模擬真實幀切碎。 */
async function advance(
    machine: HeadlessSlotMachine,
    seconds: number,
    step = 1 / 60,
): Promise<void> {
    let remaining = seconds;

    while (remaining > 1e-9) {
        const slice = Math.min(step, remaining);

        /*
         * 先加時鐘再推進：update() 內部是 _spinElapsed += deltaTime 之後
         * 才 startDueReels()，所以 callback 觸發當下 clock 要已經含這一格，
         * 否則記到的啟動時刻會少一格。
         */
        machine.clock += slice;
        machine.update(slice);
        remaining -= slice;
        await flush();
    }
}

/** 推進到條件成立或超時；回傳是否成立。 */
async function advanceUntil(
    machine: HeadlessSlotMachine,
    done: () => boolean,
    limitSeconds = 12,
    step = 1 / 60,
): Promise<boolean> {
    let spent = 0;

    while (spent < limitSeconds) {
        if (done()) {
            return true;
        }

        machine.clock += step;
        machine.update(step);
        spent += step;
        await flush();
    }

    return done();
}

/** 四捨五入到 2 位，避免浮點雜訊進斷言。 */
function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

/**
 * 時刻比對容一格 tick。
 *
 * `_spinElapsed` 是逐格累加出來的，6 格 1/60 加起來是 0.0999…而不是
 * 0.1，所以 `startAt <= _spinElapsed` 會在下一格才成立 —— 軸晚一格啟動。
 * 這是累積 deltaTime 的固有行為，實機也一樣，不是缺陷。
 */
function nearly(actual: number[], expected: number[]): boolean[] {
    const tolerance = 1 / 60 + 1e-6;
    return expected.map(
        (value, index) => Math.abs(actual[index] - value) <= tolerance,
    );
}

async function runMultiReelSection(): Promise<void> {
    group("11. 多軸：錯開啟動");

    {
        const machine = createMachine(3, [
            timing(0, 0, 0.5),
            timing(1, 0.1, 0.5),
            timing(2, 0.1, 0.5),
        ]);

        check(
            "init() 之後還沒有任何軸啟動",
            machine.startLog.length,
            0,
        );

        machine.startSpin("normal");

        check(
            "startSpin() 內就啟動 startAt 為 0 的那一軸",
            machine.startLog.map((entry) => entry.reelIndex),
            [0],
        );

        await advance(machine, 0.05);
        check("0.05s 還沒到第二軸的 0.1s", machine.startLog.length, 1);

        await advance(machine, 0.07);
        check(
            "越過 0.1s 之後第二軸啟動",
            machine.startLog.map((entry) => entry.reelIndex),
            [0, 1],
        );

        await advance(machine, 0.1);
        check(
            "再越過 0.2s 之後第三軸啟動（delay 是累積的）",
            machine.startLog.map((entry) => entry.reelIndex),
            [0, 1, 2],
        );

        check(
            "各軸啟動時刻遞增且間隔約 0.1s",
            nearly(machine.startLog.map((entry) => entry.at), [0, 0.1, 0.2]),
            [true, true, true],
        );
    }

    group("11b. fastMode：同一個迴圈內全部啟動");

    {
        const machine = createMachine(
            3,
            [timing(0, 0, 0.5), timing(1, 0.1, 0.5), timing(2, 0.1, 0.5)],
            true,
        );

        machine.startSpin("normal");

        check(
            "fastMode 把 startAt 全部壓成 0，三軸同時啟動",
            machine.startLog.map((entry) => entry.reelIndex),
            [0, 1, 2],
        );
        check(
            "啟動時刻全為 0",
            machine.startLog.map((entry) => round2(entry.at)),
            [0, 0, 0],
        );
    }

    group("11c. 鎖軸：只轉指定的軸");

    {
        const machine = createMachine(3, [
            timing(0, 0, 0.5),
            timing(1, 0.1, 0.5),
            timing(2, 0.1, 0.5),
        ]);

        machine.startSpin("normal", [1, 2]);
        await advance(machine, 0.3);

        check(
            "只有被選中的軸啟動",
            machine.startLog.map((entry) => entry.reelIndex),
            [1, 2],
        );
        check(
            "本輪第一個啟動的軸不延遲，delay 從第二個才算",
            nearly(machine.startLog.map((entry) => entry.at), [0, 0.1]),
            [true, true],
        );
        check(
            "沒被選中的軸維持 Idle",
            machine.reelList[0].state,
            ReelState.Idle,
        );
    }

    group("11d. 停輪：依序停、間隔等於錯開啟動的間隔");

    /*
     * targetStopSeconds 必須大於「物理上最早可停」，否則各軸會被鉗到
     * 自己的 earliest，而 earliest 取決於 commitResult 當下該軸的相位 ——
     * 順序就不再保證（見 §11e）。1.2s 對 0.08s 的 moveInterval 綽綽有餘。
     */
    {
        const machine = createMachine(3, [
            timing(0, 0, 1.2),
            timing(1, 0.1, 1.2),
            timing(2, 0.1, 1.2),
        ]);

        machine.startSpin("normal");
        await advance(machine, 0.25);

        const board = boardOf([1, 2, 3]);
        machine.stopSpin([board, board, board]);

        const settled = await advanceUntil(
            machine,
            () => machine.stopLog.length === 3,
        );

        check("三軸都停下來了", settled, true);
        check(
            "停輪順序依 reelIndex",
            machine.stopLog.map((entry) => entry.reelIndex),
            [0, 1, 2],
        );

        const at = machine.stopLog.map((entry) => entry.at);
        const gaps = [at[1] - at[0], at[2] - at[1]];
        check(
            "停輪間隔維持錯開啟動的 0.1s（容一格 tick 誤差）",
            gaps.map((gap) => gap > 0.08 && gap < 0.12),
            [true, true],
        );
        check(
            "三軸的可視盤面都等於送進去的結果",
            machine.getAllVisibleSymbolIds(),
            [[1, 2, 3], [1, 2, 3], [1, 2, 3]],
        );

        /*
         * 實際停輪時間要等於計畫。修正 calculateResultEntryHalfCellCount()
         * 的柵欄錯誤之前這條不成立 —— 實際會比計畫早整整一個 moveInterval
         * （252 組參數實測，差距固定）。容差是本測試以 1/60 取樣的粒度。
         */
        check(
            "實際停輪時間等於 plan.actualStopTime",
            machine.stopLog.map((entry, index) => {
                const plan = machine.reelList[index].lastStopPlan;
                return Math.abs(entry.elapsed - plan.actualStopTime)
                    <= 1 / 60 + 1e-6;
            }),
            [true, true, true],
        );
        /*
         * 決議 45：每格邊界自我修正，以連續時間計準時停。停輪落在幀中間，
         * 所以**看到**的時刻（這一幀的結尾）最多晚一幀、不會早。
         * 以整輪時間軸比對：各軸規劃停在 startAt + 1.2。
         */
        check(
            "實際停輪以連續時間計準時：看到的時刻不早、最多晚一幀",
            machine.stopLog.map((entry, index) => {
                const late = entry.at - (index * 0.1 + 1.2);
                return late >= -1e-6 && late <= 1 / 60 + 1e-6;
            }),
            [true, true, true],
        );
        check(
            "停輪計畫就是要求的時間（修正前最多早一格）",
            machine.reelList.map((reel) => {
                const plan = reel.lastStopPlan;
                return Math.abs(plan.actualStopTime - plan.requestedStopTime)
                    < 1e-9;
            }),
            [true, true, true],
        );
    }

    group("11e. config 的停輪時間早於物理下限：從最早能停起算，間隔與順序保留（決議 47）");

    /*
     * earliest 是「結果實體上還要再走幾格才進得了可視區」，那是下限 ——
     * 補再多表演牌只會更晚停，不可能更早。
     *
     * 以前各軸各自被鉗到自己的 earliest，錯開啟動讓相位不同，軸間隔消失、
     * 先後在一格內隨機（Cocos 完成版相同）。決議 47：資料到達時沿停止順序
     * 推算，每軸 = max(規劃, 前一軸停輪 + 軸間距, 本軸 earliest)，所以
     * 送進 Reel 的 requested 本身就不早於 earliest，停輪計畫 = requested。
     */
    {
        const machine = createMachine(3, [
            timing(0, 0, 0.5),
            timing(1, 0.1, 0.5),
            timing(2, 0.1, 0.5),
        ]);

        machine.startSpin("normal");
        await advance(machine, 0.25);

        const board = boardOf([1, 2, 3]);
        machine.stopSpin([board, board, board]);
        await advanceUntil(machine, () => machine.stopLog.length === 3);

        const plans = machine.reelList.map((reel) => reel.lastStopPlan);
        check(
            "第一軸的 config 0.5 早於物理下限：requested 就是它的 earliest",
            Math.abs(plans[0].requestedStopTime - plans[0].earliestStopTime) < 1e-9
            && plans[0].earliestStopTime > 0.5,
            true,
        );
        check(
            "送進 Reel 的 requested 都不早於 earliest，停輪計畫 = requested",
            plans.map((plan) =>
                plan.requestedStopTime >= plan.earliestStopTime - 1e-9
                && Math.abs(plan.actualStopTime - plan.requestedStopTime) < 1e-9),
            [true, true, true],
        );

        const at = machine.stopLog
            .slice()
            .sort((a, b) => a.reelIndex - b.reelIndex)
            .map((entry) => entry.at);
        check(
            "停輪依序、軸間隔不小於 config 的 0.1（修正前各自鉗制、間隔消失）",
            [
                machine.stopLog.map((entry) => entry.reelIndex),
                [at[1] - at[0], at[2] - at[1]].every((gap) => gap >= 0.1 - 1 / 60 - 1e-6),
            ],
            [[0, 1, 2], true],
        );
        check(
            "盤面仍然正確（鉗制影響的是時間不是結果）",
            machine.getAllVisibleSymbolIds(),
            [[1, 2, 3], [1, 2, 3], [1, 2, 3]],
        );
    }

    group("11f. 守門：fastMode 的 moveInterval 必須一致");

    /*
     * Turbo 同步是把各軸剩餘的**半格數**補齊到最大值，補的是格數不是
     * 時間，所以一格要走多久必須一致。實測（見 §11g）幾何差異會被補牌
     * 吸收，只有時間差不會 —— 因此只擋 moveInterval，不擋幾何。
     */
    {
        checkThrows("fastMode 各軸 moveInterval 不同要丟例外", () => {
            createMachine(
                2,
                [
                    {
                        reelIndex: 0,
                        startDelaySeconds: 0,
                        targetStopSeconds: 1.2,
                        moveIntervalSeconds: 0.08,
                    },
                    {
                        reelIndex: 1,
                        startDelaySeconds: 0,
                        targetStopSeconds: 1.2,
                        moveIntervalSeconds: 0.06,
                    },
                ],
                true,
            );
        });

        let normalModeOk = true;
        try {
            createMachine(2, [
                {
                    reelIndex: 0,
                    startDelaySeconds: 0,
                    targetStopSeconds: 1.2,
                    moveIntervalSeconds: 0.08,
                },
                {
                    reelIndex: 1,
                    startDelaySeconds: 0.1,
                    targetStopSeconds: 1.2,
                    moveIntervalSeconds: 0.06,
                },
            ]);
        } catch (error) {
            normalModeOk = false;
        }

        check(
            "非 fastMode 允許各軸 moveInterval 不同（不是 Turbo 就沒這個前提）",
            normalModeOk,
            true,
        );
    }

    group("11g. 守門：幾何不同不擋 —— 3-4-5 機台是合法設定");

    {
        const timings = [
            timing(0, 0, 1.2),
            timing(1, 0, 1.2),
            timing(2, 0, 1.2),
        ];
        const geometry = [
            { maxCellSpan: 1, visible: 3 },
            { maxCellSpan: 3, visible: 4 },
            { maxCellSpan: 2, visible: 5 },
        ];

        let built: HeadlessSlotMachine | undefined;
        let buildOk = true;
        try {
            built = createMachine(3, timings, true, geometry);
        } catch (error) {
            buildOk = false;
        }

        check("各軸 maxCellSpan 與可視格數不同時仍建得起來", buildOk, true);

        if (built !== undefined) {
            const machine = built;
            check(
                "各軸 strip 長度確實不同",
                machine.reelList.map((reel) => reel.stripCellCount),
                [1 + 3 + 1, 3 + 4 + 3, 2 + 5 + 2],
            );

            machine.startSpin("normal");
            await advance(machine, 0.4);
            machine.quickStop();
            machine.stopSpin([
                fill(4, 3),
                fill(4, 4),
                fill(4, 5),
            ]);
            await advanceUntil(
                machine,
                () => machine.stopLog.length === 3,
            );

            const at = machine.stopLog.map((entry) => entry.at);
            const spread = Math.max(...at) - Math.min(...at);
            check(
                "Turbo 仍然同步停輪（幾何差異被半格補牌吸收）",
                spread <= 1 / 60 + 1e-6,
                true,
            );
            check(
                "各軸盤面都對，長度等於自己的可視格數",
                machine.getAllVisibleSymbolIds().map((ids) => ids.length),
                [3, 4, 5],
            );
        }
    }

    group("11h. 守門：stopSpin 的結果陣列以 reelIndex 為索引");

    {
        const machine = createMachine(3, [
            timing(0, 0, 1.2),
            timing(1, 0.1, 1.2),
            timing(2, 0.1, 1.2),
        ]);

        machine.startSpin("normal");
        await advance(machine, 0.3);

        const board = boardOf([1, 2, 3]);

        /*
         * stopSpin() 是 async，所以守門是以 rejection 形式出現而不是
         * 同步 throw —— 與 assertCanStop() 等既有守門一致。
         */
        let rejected = false;
        try {
            await machine.stopSpin([board, board]);
        } catch (error) {
            rejected = true;
        }

        check(
            "結果陣列少一軸要拒絕，而不是把 undefined 丟給該軸",
            rejected,
            true,
        );
        check(
            "被拒絕之後機台沒有進入 stopping，可以重試",
            machine.spinning,
            true,
        );
    }

    group("11i. Turbo 同步：各軸退場端墊格數不同時仍要同時停");

    /*
     * 退場端截斷會在結果前面墊格（createExitTruncationCells），墊幾格
     * 取決於盤面 —— 各軸不同。而 Turbo 補牌在 stopSpin() 內、
     * commitResult() 之後立刻決定，那時結果還沒寫進佇列，所以
     * calculateQuickStopHalfCellCount() 原本看不到這幾格，補牌會算成 0。
     *
     * 實測（修正前）：墊 0/1/2 格的三軸停在 0.8833 / 0.9667 / 1.05，
     * 差距精確等於墊格數。修正是把 pendingExitTruncationCellCount
     * 加進行程，走的是與 tryCommitResultAtHandoff() 同一個計算。
     */
    {
        const machine = createMachine(
            3,
            [timing(0, 0, 2.0), timing(1, 0, 2.0), timing(2, 0, 2.0)],
            true,
        );

        machine.startSpin("normal");
        await advance(machine, 0.4);
        machine.quickStop();

        // 墊 0 格 / 墊 1 格 / 墊 2 格
        machine.stopSpin([
            boardOf([1, 2, 3]),
            boardOf([1, 7, 7]),
            boardOf([1, 2, 7]),
        ]);
        const settled = await advanceUntil(
            machine,
            () => machine.stopLog.length === 3,
        );

        check("三軸都停下來了", settled, true);
        check(
            "三軸盤面都正確，含兩種退場端截斷",
            machine.getAllVisibleSymbolIds(),
            [[1, 2, 3], [1, 7, 7], [1, 2, 7]],
        );

        const at = machine.stopLog.map((entry) => entry.at);
        check(
            "停輪離散為 0（修正前是 0 / 1 / 2 格）",
            Math.max(...at) - Math.min(...at) <= 1 / 60 + 1e-6,
            true,
        );

        const perf = machine.reelList.map(
            (reel) => reel.lastStopPlan.performanceCellCount,
        );
        check(
            "補牌數各軸不同 —— 證明差異是被補平的，不是剛好一樣",
            perf[0] !== perf[2],
            true,
        );
    }

    group("11j. Turbo 同步：結果先到、玩家後按急停");

    /*
     * 急停有兩個進入順序，兩邊失步的成因不同：
     *
     *   玩家先按、結果後到 → prepareFastQuickStopPadding() 由 stopSpin()
     *     觸發，此時結果還沒寫進佇列 → 靠
     *     ReelStopFlow.pendingExitTruncationCellCount 補上墊格（§11i）
     *
     *   結果先到、玩家後按 → 由 quickStop() 觸發，此時結果已在佇列裡，
     *     而墊格被併在結果區段開頭，_resultStartIndex 指向墊格不是本體
     *     → 靠 ReelDataFlow.pendingCellCountBeforeResultBody() 算到本體
     *
     * 兩者互斥（clearResultEntry() 在資料提交的同一個函式尾端執行），
     * 所以不會重複計算。1080 組實測，兩條路的殘差都只剩次格量化。
     */
    {
        const machine = createMachine(
            3,
            [timing(0, 0, 2.0), timing(1, 0, 2.0), timing(2, 0, 2.0)],
            true,
        );

        machine.startSpin("normal");
        await advance(machine, 0.4);

        // 墊 0 格 / 墊 1 格 / 墊 2 格
        machine.stopSpin([
            boardOf([1, 2, 3]),
            boardOf([1, 7, 7]),
            boardOf([1, 2, 7]),
        ]);

        const committed = await advanceUntil(
            machine,
            () => machine.reelList.every(
                (reel) => reel.lastStopPlan !== undefined,
            ),
        );
        check("結果已經寫進各軸的佇列", committed, true);

        machine.quickStop();
        const settled = await advanceUntil(
            machine,
            () => machine.stopLog.length === 3,
        );

        check("三軸都停下來了", settled, true);

        const at = machine.stopLog.map((entry) => entry.at);
        check(
            "停輪離散為 0（修正前是 0 / 1 / 2 格）",
            Math.max(...at) - Math.min(...at) <= 1 / 60 + 1e-6,
            true,
        );

        /*
         * 這條同時守著另一件事：`skipPendingPerformanceData()` 只能砍到
         * `_resultStartIndex`，**墊格不可以被砍**。砍掉的話退場端截斷的
         * 那幾格就不見了，盤面會壞 —— 所以盤面正確本身就是那道防線。
         * 之後若有人把兩個 pending 計數合併掉，這裡會紅。
         */
        check(
            "急停砍掉表演牌之後，含兩種截斷的盤面仍然正確",
            machine.getAllVisibleSymbolIds(),
            [[1, 2, 3], [1, 7, 7], [1, 2, 7]],
        );
    }

    group("11k. 普通模式急停：錯開啟動時仍依序停（決議 43）");

    /*
     * 普通模式急停只把表演格砍光，之後每軸在自己的第一個可停邊界停下。
     * 錯開啟動讓相位不同，後面的軸會比前面的早停（Cocos 完成版一樣）。
     * 決議 43：砍完之後逐軸補上剛好足以「不早於前一軸」的格數。
     *
     * 兩個進入順序都要涵蓋（與 Turbo 的 §11i／§11j 同樣兩個呼叫點）：
     *   玩家先按、結果後到 → stopSpin() 內補，此時結果尚未寫進佇列（補的是預算）
     *   結果先到、玩家後按 → quickStop() 內補，此時結果已在佇列（直接插格）
     *
     * 參數取自驗算中會反轉的組合：moveInterval 0.08、錯開 0.16、含截斷盤面。
     */
    const staggeredBoards = [
        boardOf([7, 1, 1]),
        boardOf([1, 7, 7]),
        boardOf([6, 6, 1]),
        boardOf([1, 6, 6]),
        boardOf([7, 7, 7]),
    ];
    const staggeredTimings = [
        timing(0, 0, 2.0),
        timing(1, 0.16, 2.0),
        timing(2, 0.16, 2.0),
        timing(3, 0.16, 2.0),
        timing(4, 0.16, 2.0),
    ];

    for (const order of ["玩家先按", "結果先到"]) {
        const machine = createMachine(5, staggeredTimings);

        machine.startSpin("normal");
        await advance(machine, 0.75);

        if (order === "玩家先按") {
            machine.quickStop();
            machine.stopSpin(staggeredBoards);
        } else {
            machine.stopSpin(staggeredBoards);
            const committed = await advanceUntil(
                machine,
                () => machine.reelList.every(
                    (reel) => reel.lastStopPlan !== undefined,
                ),
            );
            check(`${order}：結果已經寫進各軸的佇列`, committed, true);
            machine.quickStop();
        }

        const settled = await advanceUntil(
            machine,
            () => machine.stopLog.length === 5,
        );
        check(`${order}：五軸都停下來了`, settled, true);

        const at = machine.stopLog
            .slice()
            .sort((a, b) => a.reelIndex - b.reelIndex)
            .map((entry) => entry.at);
        check(
            `${order}：停輪時刻依軸序不遞減（同一幀可並列）`,
            at.every((value, index) =>
                index === 0 || value >= at[index - 1] - 1e-9),
            true,
        );
        check(
            `${order}：onReelStopped 依軸序發出`,
            machine.stopLog.map((entry) => entry.reelIndex),
            [0, 1, 2, 3, 4],
        );
        check(
            `${order}：盤面正確，含退場端與進場端截斷`,
            machine.getAllVisibleSymbolIds(),
            staggeredBoards.map((board) => board.map((data) => data.id)),
        );
        check(
            `${order}：至少一軸被補了格 —— 證明順序是補出來的，不是剛好`,
            machine.reelList.some(
                (reel) => reel.lastStopPlan.performanceCellCount > 0,
            ),
            true,
        );
    }

    group("11l. 自訂停止順序：右到左（reelTimings 陣列順序）");

    /*
     * 停止順序 = SpinConfig.reelTimings 的陣列順序，與 reelIndex 無關。
     * 左到右時軸號順序剛好等於設定順序，下面兩個缺陷都測不出來：
     *
     *   同幀並列的回調照軸號發 —— update() 照 _runtimeReels 走訪，
     *     同一幀停下的軸 resolve 的先後就是軸號。改照 _updateOrder。
     *
     *   舊預算殘留 —— 急停發生在 stopSpin() 等待後面的軸啟動期間時，
     *     quickStop() 與 stopSpin() 各補一次；第二次沒碰到的軸留著第一次
     *     的預算，實際多走幾格跑到下一軸後面。改成能補的軸一律寫（0 也寫）。
     */
    const rightToLeft = (stagger: number): SlotMachineReelTiming[] => [
        timing(4, 0, 2.0),
        timing(3, stagger, 2.0),
        timing(2, stagger, 2.0),
        timing(1, stagger, 2.0),
        timing(0, stagger, 2.0),
    ];
    const reversedBoards = [
        boardOf([7, 1, 1]),
        boardOf([1, 7, 7]),
        boardOf([6, 6, 1]),
        boardOf([1, 6, 6]),
        boardOf([7, 7, 7]),
    ];
    const settleAll = async (machine: HeadlessSlotMachine): Promise<boolean> =>
        advanceUntil(machine, () => machine.stopLog.length === 5);
    const atInConfigOrder = (machine: HeadlessSlotMachine): number[] =>
        [4, 3, 2, 1, 0].map((reelIndex) =>
            machine.stopLog.filter((entry) => entry.reelIndex === reelIndex)[0].at);

    {
        const machine = createMachine(5, rightToLeft(0.16));

        machine.startSpin("normal");
        await advance(machine, 0.75);
        machine.stopSpin(reversedBoards);
        check("不急停：五軸都停下來了", await settleAll(machine), true);
        check(
            "不急停：onReelStopped 照設定順序（右到左）",
            machine.stopLog.map((entry) => entry.reelIndex),
            [4, 3, 2, 1, 0],
        );
    }

    {
        /* 不錯開、全 1×1（無截斷墊格）→ 相位與行程都相同，五軸必在同一幀停。 */
        const machine = createMachine(5, rightToLeft(0));

        machine.startSpin("normal");
        await advance(machine, 0.75);
        machine.stopSpin([1, 2, 3, 4, 1].map(() => boardOf([1, 2, 3])));
        machine.quickStop();
        check("同幀停下：五軸都停下來了", await settleAll(machine), true);

        const at = machine.stopLog.map((entry) => entry.at);
        check(
            "同幀停下：前提成立 —— 五軸真的在同一幀停",
            Math.max(...at) - Math.min(...at) < 1e-9,
            true,
        );
        check(
            "同幀停下：onReelStopped 仍照設定順序（修正前照軸號 0→4）",
            machine.stopLog.map((entry) => entry.reelIndex),
            [4, 3, 2, 1, 0],
        );
    }

    {
        const machine = createMachine(5, rightToLeft(0.25));

        machine.startSpin("normal");
        await advance(machine, 0.75);
        machine.stopSpin(reversedBoards);
        await advance(machine, 0.05);

        check(
            "急停在 stopSpin() 等待啟動期間：前提成立 —— 最後一軸還沒啟動",
            machine.startLog.length < 5,
            true,
        );

        machine.quickStop();
        check("急停在等待啟動期間：五軸都停下來了", await settleAll(machine), true);

        const at = atInConfigOrder(machine);
        check(
            "急停在等待啟動期間：停輪時刻照設定順序不遞減（修正前第 0 軸跑到第 1 軸前面）",
            at.every((value, index) =>
                index === 0 || value >= at[index - 1] - 1e-9),
            true,
        );
        check(
            "急停在等待啟動期間：onReelStopped 照設定順序",
            machine.stopLog.map((entry) => entry.reelIndex),
            [4, 3, 2, 1, 0],
        );
        check(
            "急停在等待啟動期間：盤面正確",
            machine.getAllVisibleSymbolIds(),
            reversedBoards.map((board) => board.map((data) => data.id)),
        );
    }

    group("11m. stopTimings：同時啟動、右到左停（決議 44）");

    /*
     * 啟動順序照 reelTimings、停止順序照 stopTimings。停止序列第一軸停在
     * 「自己的啟動時刻 + targetStopSeconds」，之後每軸 = 前一軸 + stopDelaySeconds。
     * 間隔取 0.16（= 2 × moveInterval），軸間隔的量化誤差才會趨近 0。
     */
    const simultaneous = [0, 1, 2, 3, 4].map((reelIndex) =>
        timing(reelIndex, 0, 2.0));
    const stopRightToLeft = (delay: number): SlotMachineReelStopTiming[] =>
        [4, 3, 2, 1, 0].map((reelIndex, index) => ({
            reelIndex,
            stopDelaySeconds: index === 0 ? 0 : delay,
        }));
    const plainBoards = [1, 2, 3, 4, 1].map(() => boardOf([1, 2, 3]));
    const stopAt = (machine: HeadlessSlotMachine, reelIndex: number): number =>
        machine.stopLog.filter((entry) => entry.reelIndex === reelIndex)[0].at;
    const oneCell = 0.08 + 1 / 60 + 1e-6;
    const oneFrame = 1 / 60 + 1e-6;

    {
        const machine = createMachine(
            5, simultaneous, false, undefined, stopRightToLeft(0.16),
        );

        machine.startSpin("normal");
        check(
            "同時啟動：五軸在同一刻啟動",
            machine.startLog.map((entry) => entry.at),
            [0, 0, 0, 0, 0],
        );

        await advance(machine, 0.75);
        machine.stopSpin(plainBoards);
        check("不急停：五軸都停下來了", await settleAll(machine), true);
        check(
            "不急停：onReelStopped 照 stopTimings（右到左）",
            machine.stopLog.map((entry) => entry.reelIndex),
            [4, 3, 2, 1, 0],
        );

        const first = machine.stopLog[0];
        check(
            "不急停：第一軸停在自己的 targetStopSeconds，不早、最多晚一幀（決議 45）",
            first.elapsed >= 2.0 - 1e-6 && first.elapsed <= 2.0 + oneFrame,
            true,
        );

        const gaps = [3, 2, 1, 0].map((reelIndex) =>
            stopAt(machine, reelIndex) - stopAt(machine, reelIndex + 1));
        check(
            "不急停：相鄰兩軸間隔等於 stopDelaySeconds（誤差一幀以內，修正前一格）",
            gaps.every((gap) => Math.abs(gap - 0.16) <= oneFrame),
            true,
        );
        check(
            "不急停：盤面正確",
            machine.getAllVisibleSymbolIds(),
            plainBoards.map((board) => board.map((data) => data.id)),
        );
    }

    {
        const machine = createMachine(
            5, simultaneous, false, undefined, stopRightToLeft(0.16),
        );

        machine.startSpin("normal");
        await advance(machine, 0.75);
        machine.stopSpin(reversedBoards);
        await advanceUntil(
            machine,
            () => machine.reelList.every(
                (reel) => reel.lastStopPlan !== undefined,
            ),
        );
        machine.quickStop();
        check("急停：五軸都停下來了", await settleAll(machine), true);

        const at = [4, 3, 2, 1, 0].map((reelIndex) => stopAt(machine, reelIndex));
        check(
            "急停：停輪時刻照 stopTimings 不遞減",
            at.every((value, index) =>
                index === 0 || value >= at[index - 1] - 1e-9),
            true,
        );
        check(
            "急停：onReelStopped 照 stopTimings",
            machine.stopLog.map((entry) => entry.reelIndex),
            [4, 3, 2, 1, 0],
        );
        check(
            "急停：盤面正確，含截斷",
            machine.getAllVisibleSymbolIds(),
            reversedBoards.map((board) => board.map((data) => data.id)),
        );
    }

    {
        /* 鎖軸：未作用的軸從停止序列移除，它的間隔一起消失。 */
        const machine = createMachine(
            5, simultaneous, false, undefined, stopRightToLeft(0.16),
        );

        machine.startSpin("normal", [0, 2, 4]);
        await advance(machine, 0.75);
        machine.stopSpin(plainBoards);
        check(
            "鎖軸：三軸都停下來了",
            await advanceUntil(machine, () => machine.stopLog.length === 3),
            true,
        );
        check(
            "鎖軸：只有作用軸、照 stopTimings 順序",
            machine.stopLog.map((entry) => entry.reelIndex),
            [4, 2, 0],
        );
    }

    group("11n. 守門：stopTimings 必須與 reelTimings 一對一");

    checkThrows("少一軸", () => {
        createMachine(3, [timing(0, 0, 2), timing(1, 0, 2), timing(2, 0, 2)],
            false, undefined, [
                { reelIndex: 2, stopDelaySeconds: 0 },
                { reelIndex: 1, stopDelaySeconds: 0.16 },
            ]);
    });
    checkThrows("重複", () => {
        createMachine(3, [timing(0, 0, 2), timing(1, 0, 2), timing(2, 0, 2)],
            false, undefined, [
                { reelIndex: 2, stopDelaySeconds: 0 },
                { reelIndex: 2, stopDelaySeconds: 0.16 },
                { reelIndex: 1, stopDelaySeconds: 0.16 },
            ]);
    });
    checkThrows("不在 reelTimings 裡的軸", () => {
        createMachine(3, [timing(0, 0, 2), timing(1, 0, 2), timing(2, 0, 2)],
            false, undefined, [
                { reelIndex: 2, stopDelaySeconds: 0 },
                { reelIndex: 1, stopDelaySeconds: 0.16 },
                { reelIndex: 3, stopDelaySeconds: 0.16 },
            ]);
    });
    checkThrows("stopDelaySeconds 為負", () => {
        createMachine(3, [timing(0, 0, 2), timing(1, 0, 2), timing(2, 0, 2)],
            false, undefined, [
                { reelIndex: 2, stopDelaySeconds: 0 },
                { reelIndex: 1, stopDelaySeconds: -0.1 },
                { reelIndex: 0, stopDelaySeconds: 0.16 },
            ]);
    });

    /*
     * 11o 用的輔助（群組標題在 11p 之後）。
     *
     * runOneListenReel() 等前一軸停下後，以前若聽牌軸已停就直接 return，
     * onListenStart／onListenEnd 兩個都不發。前一軸在某幀 update() 裡停下，
     * await 之後的續行要等同一幀所有軸推進完才跑 —— 聽牌軸同幀停下時
     * （Turbo 同步、急停）續行時已是 Stopped。修正前 fastMode 急停 0 發出。
     */
    const listenRun = async (
        fastMode: boolean,
        quickStop: "none" | "before" | "after",
    ): Promise<{ log: string[]; settled: boolean }> => {
        const machine = createMachine(
            5,
            [0, 1, 2, 3, 4].map((reelIndex) => timing(reelIndex, 0, 2.0)),
            fastMode,
        );
        const log: string[] = [];

        machine.onListenStart = (reelIndex) => log.push(`start${reelIndex}`);
        machine.onListenEnd = (reelIndex) => log.push(`end${reelIndex}`);
        machine.startSpin("normal");
        await advance(machine, 0.75);
        machine.setListenReels([
            { reelIndex: 2, duration: 0.6, speedMultiplier: 1 },
            { reelIndex: 3, duration: 0.6, speedMultiplier: 1 },
        ]);

        if (quickStop === "before") {
            machine.quickStop();
        }

        machine.stopSpin(plainBoards);

        if (quickStop === "after") {
            await advanceUntil(
                machine,
                () => machine.reelList.every(
                    (reel) => reel.lastStopPlan !== undefined,
                ),
            );
            machine.quickStop();
        }

        const settled = await settleAll(machine);
        await flush();
        return { log, settled };
    };

    group("11p. 聽牌時間：規劃時算定，加速後補格把時長補回 duration（決議 42）");

    /*
     * 修正前 runOneListenReel() 在前一軸停下時改目標（行程早已定案，無效）
     * 又改速度（生效），聽牌時長縮成 duration / m：m = 2 時 0.6 秒量到 0.333。
     * 現在由 stopSpin() 規劃時呼叫 BaseReel.planListenSpeedUp()：切速排在
     * 「不晚於聽牌開始的最後一個 Cell 邊界」，目標換成原速下的等效時間。
     *
     * 5 軸、錯開 0.16、targetStop 2.0、moveInterval 0.08，第 2 軸聽牌 0.6 秒：
     *   第 2 軸規劃 0.32 啟動；前一軸（第 1 軸）規劃停輪 0.16 + 2.0 = 2.16
     *   → 第 2 軸聽牌結束 = 2.16 + 0.6 = 2.76（整輪時間）
     *   換成本軸時間時減的是**實際**原點（啟動那一幀的開頭，略早於 0.32；決議 45）
     */
    const listenTimings = [0, 1, 2, 3, 4].map((reelIndex) =>
        timing(reelIndex, reelIndex === 0 ? 0 : 0.16, 2.0));
    const runListenTiming = async (
        speedMultiplier: number,
        options: { fastMode?: boolean; listen?: boolean; pressAt?: number } = {},
    ): Promise<HeadlessSlotMachine> => {
        const machine = createMachine(
            5,
            options.fastMode === true
                ? [0, 1, 2, 3, 4].map((reelIndex) => timing(reelIndex, 0, 2.0))
                : listenTimings,
            options.fastMode === true,
        );

        machine.startSpin("normal");
        await advance(machine, 0.75);

        if (options.listen !== false) {
            machine.setListenReels([
                { reelIndex: 2, duration: 0.6, speedMultiplier },
            ]);
        }

        machine.stopSpin(plainBoards);

        if (options.pressAt !== undefined) {
            await advance(machine, options.pressAt - machine.clock);
            machine.quickStop();
        }

        await settleAll(machine);
        return machine;
    };
    const elapsedAtStop = (machine: HeadlessSlotMachine, reelIndex: number): number =>
        machine.stopLog.filter((entry) => entry.reelIndex === reelIndex)[0].elapsed;

    for (const speedMultiplier of [1, 2, 3]) {
        const machine = await runListenTiming(speedMultiplier);
        const stopped = elapsedAtStop(machine, 2);

        /*
         * 決議 45：以整輪時間軸比對（本軸時間的原點是實際啟動那一幀的開頭，
         * 不是 0.32）。聽牌結束 = 前一軸規劃停輪 2.16 + 0.6 = 2.76；
         * 切速前、切速後兩段各自修正，看到的時刻不早、最多晚一幀。
         */
        const listenEnd = stopAt(machine, 2) - 2.76;
        check(
            `m = ${speedMultiplier}：聽牌軸停在 2.76（整輪時間），不早、最多晚一幀（修正前 m = 2 約 2.16 + 0.3）`,
            listenEnd >= -1e-6 && listenEnd <= oneFrame,
            true,
        );
        check(
            `m = ${speedMultiplier}：停輪順序不變、盤面正確`,
            [
                machine.stopLog.map((entry) => entry.reelIndex),
                machine.getAllVisibleSymbolIds(),
            ],
            [
                [0, 1, 2, 3, 4],
                plainBoards.map((board) => board.map((data) => data.id)),
            ],
        );

        if (speedMultiplier > 1) {
            const plan = machine.reelList[2].lastStopPlan;
            check(
                `m = ${speedMultiplier}：lastStopPlan.actualStopTime 反映切速後的真實時間（一格以內）`,
                Math.abs(plan.actualStopTime - stopped) <= oneCell,
                true,
            );
        }
    }

    {
        /* fastMode 不排聽牌時間：與不設聽牌逐軸相同（修正前最多相差 7.85 秒，Turbo 失步）。 */
        const withListen = await runListenTiming(2, { fastMode: true });
        const withoutListen = await runListenTiming(2, { fastMode: true, listen: false });

        check(
            "fastMode：設了聽牌也與不設聽牌逐軸同時停",
            withListen.stopLog.map((entry) => entry.at),
            withoutListen.stopLog.map((entry) => entry.at),
        );
    }

    {
        /*
         * 聽牌途中急停依照當下速度：
         *   切速前按（2.05 秒，切速邊界在 2.16）→ 取消切速，維持原速 0.08
         *
         * 切速前那一組**必須按在邊界前一刻**：按得太早（例如 1.0 秒），砍完
         * 表演格後這一軸在走到切速格之前就停了，取不取消都一樣 —— 還原
         * 「取消切速」時這項不會紅，等於沒測到。
         *   切速後按（2.3 秒，聽牌中）→ 維持聽牌速度 0.04
         */
        const before = await runListenTiming(2, { pressAt: 2.05 });
        const after = await runListenTiming(2, { pressAt: 2.3 });

        check(
            "切速前急停：預定切速被取消，維持原速",
            before.reelList[2].moveInterval,
            0.08,
        );
        check(
            "切速後急停：維持聽牌速度",
            after.reelList[2].moveInterval,
            0.04,
        );

        for (const [label, machine] of [["切速前急停", before], ["切速後急停", after]] as [string, HeadlessSlotMachine][]) {
            const at = [0, 1, 2, 3, 4].map((reelIndex) => stopAt(machine, reelIndex));
            check(
                `${label}：停輪時刻不遞減、盤面正確`,
                at.every((value, index) =>
                    index === 0 || value >= at[index - 1] - 1e-9)
                && JSON.stringify(machine.getAllVisibleSymbolIds())
                    === JSON.stringify(plainBoards.map((board) => board.map((data) => data.id))),
                true,
            );
        }
    }

    {
        const machine = createMachine(5, listenTimings);

        checkThrows("setListenReels：speedMultiplier < 1（不支援聽牌減速）", () => {
            machine.setListenReels([{ reelIndex: 2, duration: 0.6, speedMultiplier: 0.5 }]);
        });
        checkThrows("setListenReels：speedMultiplier 非有限數", () => {
            machine.setListenReels([{ reelIndex: 2, duration: 0.6, speedMultiplier: Number.NaN }]);
        });
        checkThrows("setListenReels：duration 為負", () => {
            machine.setListenReels([{ reelIndex: 2, duration: -0.1, speedMultiplier: 2 }]);
        });
        checkThrows("setListenReels：reelIndex 超出範圍", () => {
            machine.setListenReels([{ reelIndex: 9, duration: 0.6, speedMultiplier: 2 }]);
        });
    }

    group("11q. 量化誤差壓到 0：規劃同時停的軸真的同時停（決議 45）");

    /*
     * 決議 44 留下的現象（選 ③ 等本項）：錯開啟動 0.1、stopTimings 右到左、
     * stopDelaySeconds = 0，五軸規劃同時停在 2.4 + 0.4 = 2.8。
     *
     * 修正前各軸量化到自己的格邊界，先後在一格內隨機，回調發成 4,0,1,2,3。
     * 只做每格修正仍會反轉 —— 各軸原點差不到一幀，要以「實際原點」規劃才歸零；
     * 2.8 又剛好落在幀邊界上，浮點雜訊會把同一刻停下的軸拆到兩幀，要靠
     * BaseMovement.TIME_EPSILON 吸收。三者缺一，本組都會紅。
     */
    {
        const machine = createMachine(
            5,
            [0, 1, 2, 3, 4].map((reelIndex) =>
                timing(reelIndex, reelIndex === 0 ? 0 : 0.1, 2.4)),
            false,
            undefined,
            stopRightToLeft(0),
        );

        machine.startSpin("normal");
        await advance(machine, 0.75);
        machine.stopSpin(plainBoards);
        check("同時停：五軸都停下來了", await settleAll(machine), true);

        const at = machine.stopLog.map((entry) => entry.at);
        check(
            "同時停：五軸在同一幀停下",
            Math.max(...at) - Math.min(...at) < 1e-9,
            true,
        );
        check(
            "同時停：那一幀就是 2.8（不早、最多晚一幀）",
            at[0] >= 2.8 - 1e-6 && at[0] <= 2.8 + oneFrame,
            true,
        );
        check(
            "同時停：onReelStopped 照 stopTimings（修正前 4,0,1,2,3）",
            machine.stopLog.map((entry) => entry.reelIndex),
            [4, 3, 2, 1, 0],
        );
    }

    {
        /*
         * 錯開 0.13（不是幀長的整數倍）：軸在規劃時刻之後的第一幀才啟動，
         * 實際原點比規劃值早了一截。不用實際原點時各軸各自準時、卻準在
         * 不同的起點上，五軸被拆到兩幀（驗算 spread 0.0167）。
         */
        const machine = createMachine(
            5,
            [0, 1, 2, 3, 4].map((reelIndex) =>
                timing(reelIndex, reelIndex === 0 ? 0 : 0.13, 2.4)),
            false,
            undefined,
            stopRightToLeft(0),
        );

        machine.startSpin("normal");
        await advance(machine, 0.75);
        machine.stopSpin(plainBoards);
        check("錯開 0.13：五軸都停下來了", await settleAll(machine), true);

        const at = machine.stopLog.map((entry) => entry.at);
        check(
            "錯開 0.13：五軸在同一幀停下，且不早於 2.92、最多晚一幀",
            Math.max(...at) - Math.min(...at) < 1e-9
            && at[0] >= 2.92 - 1e-6 && at[0] <= 2.92 + oneFrame,
            true,
        );
    }

    {
        /*
         * 聽牌切速前那一段也要修正：聽牌在本軸**啟動效果還沒播完**時規劃，
         * 切速邊界只能估（第一格實際從效果播完那一幀的開頭起算，早於估計），
         * 格線因此比 switchAtSeconds 早。切速前不修正時，切速後那幾格
         * 補不回來，聽牌軸早停（驗算 −6.67e-3 秒，1/30 幀下看得到）。
         */
        const step = 1 / 30;
        const machine = createMachine(
            5,
            listenTimings,
            false,
            undefined,
            undefined,
            {
                enabled: true,
                distance: 10,
                outwardDuration: 0.13,
                returnDuration: 0.2,
            },
        );

        machine.startSpin("normal");
        machine.setListenReels([
            { reelIndex: 4, duration: 0.16, speedMultiplier: 2 },
        ]);
        machine.stopSpin(plainBoards);
        check(
            "啟動效果中規劃聽牌：五軸都停下來了",
            await advanceUntil(machine, () => machine.stopLog.length === 5, 12, step),
            true,
        );

        /* 第 3 軸規劃停在 0.48 + 2.0 = 2.48，聽牌 0.16 → 2.64。 */
        const late = stopAt(machine, 4) - 2.64;
        check(
            "啟動效果中規劃聽牌：聽牌軸不早於 2.64、最多晚一幀",
            late >= -1e-6 && late <= step + 1e-6,
            true,
        );
    }

    {
        /*
         * 低幀率（10 fps，一幀 0.1 秒 > moveInterval）：一幀內會跨過好幾個
         * Cell 邊界，每格修正仍以連續時間計，不受幀長影響。
         */
        const lowFps = 0.1;
        const machine = createMachine(3, [
            timing(0, 0, 1.23),
            timing(1, 0.1, 1.23),
            timing(2, 0.1, 1.23),
        ]);

        machine.startSpin("normal");
        await advance(machine, 0.3, lowFps);
        machine.stopSpin([boardOf([1, 2, 3]), boardOf([7, 1, 1]), boardOf([1, 6, 6])]);
        check(
            "低幀率：三軸都停下來了",
            await advanceUntil(machine, () => machine.stopLog.length === 3, 12, lowFps),
            true,
        );
        check(
            "低幀率：各軸看到的停輪不早、最多晚一幀（0.1 秒）",
            machine.stopLog.map((entry) => {
                const late = entry.at - (entry.reelIndex * 0.1 + 1.23);
                return late >= -1e-6 && late <= lowFps + 1e-6;
            }),
            [true, true, true],
        );
        check(
            "低幀率：停輪計畫就是要求的時間、盤面正確",
            [
                machine.reelList.map((reel) => Math.abs(
                    reel.lastStopPlan.actualStopTime
                    - reel.lastStopPlan.requestedStopTime,
                ) < 1e-9),
                machine.getAllVisibleSymbolIds(),
            ],
            [[true, true, true], [[1, 2, 3], [7, 1, 1], [1, 6, 6]]],
        );
    }

    group("11r. 聽牌從前一軸實際停下起算：伺服器晚到時聽牌仍完整（決議 46）");

    /*
     * targetStopSeconds 0.15、伺服器 3 秒才送結果：前面的軸被鉗到 earliest（實際晚停）。
     * 決議 42 以前一軸的**規劃**停輪（0.15）起算，聽牌軸目標 1.75 早已過去，
     * 聽牌只剩 0.017 秒；決議 46 改從前一軸**實際**停下起算。
     */
    const lateServerRun = async (
        listen: { reelIndex: number; duration: number; speedMultiplier: number }[],
        quickStopAfter?: number,
    ): Promise<{ machine: HeadlessSlotMachine; log: string[]; settled: boolean }> => {
        const machine = createMachine(
            5,
            [0, 1, 2, 3, 4].map((reelIndex) =>
                timing(reelIndex, reelIndex === 0 ? 0 : 0.1, 0.15)),
        );
        const log: string[] = [];

        machine.onListenStart = (reelIndex) => log.push(`start${reelIndex}`);
        machine.onListenEnd = (reelIndex) => log.push(`end${reelIndex}`);
        machine.setListenReels(listen);
        machine.startSpin("normal");
        await advance(machine, 3.0);
        machine.stopSpin(reversedBoards);

        if (quickStopAfter !== undefined) {
            await advance(machine, quickStopAfter);
            machine.quickStop();
        }

        const settled = await settleAll(machine);
        await flush();
        return { machine, log, settled };
    };
    const paired = (log: string[], reelIndexes: number[]): boolean =>
        reelIndexes.every((reelIndex) =>
            log.filter((entry) => entry === `start${reelIndex}`).length === 1
            && log.filter((entry) => entry === `end${reelIndex}`).length === 1
            && log.indexOf(`start${reelIndex}`) < log.indexOf(`end${reelIndex}`));

    {
        const { machine, log, settled } = await lateServerRun([
            { reelIndex: 1, duration: 1.5, speedMultiplier: 1.5 },
        ]);

        check("伺服器晚到、第 1 軸聽牌：五軸都停下來了", settled, true);
        check(
            "伺服器晚到：聽牌 = 前一軸實際停下 + 1.5（誤差一幀內；修正前 0.017）",
            Math.abs(stopAt(machine, 1) - stopAt(machine, 0) - 1.5) <= oneFrame,
            true,
        );
        check(
            "伺服器晚到：聽牌軸之後的第 2 軸保留原本軸間距 0.1",
            Math.abs(stopAt(machine, 2) - stopAt(machine, 1) - 0.1) <= oneFrame,
            true,
        );
        check(
            "伺服器晚到：聽牌回調成對、盤面正確",
            [
                paired(log, [1]),
                machine.getAllVisibleSymbolIds(),
            ],
            [true, reversedBoards.map((board) => board.map((data) => data.id))],
        );
    }

    {
        const { machine, log, settled } = await lateServerRun([
            { reelIndex: 1, duration: 1.5, speedMultiplier: 1.5 },
            { reelIndex: 2, duration: 1.0, speedMultiplier: 2 },
        ]);

        check("伺服器晚到、連續聽牌：五軸都停下來了", settled, true);
        check(
            "伺服器晚到、連續聽牌：兩軸各自完整（1.5、1.0，誤差一幀內）",
            [
                Math.abs(stopAt(machine, 1) - stopAt(machine, 0) - 1.5) <= oneFrame,
                Math.abs(stopAt(machine, 2) - stopAt(machine, 1) - 1.0) <= oneFrame,
            ],
            [true, true],
        );
        check("伺服器晚到、連續聽牌：回調成對", paired(log, [1, 2]), true);
    }

    {
        /*
         * 結果送出後 0.01 秒按急停：第 1 軸起都還在等前一軸（延後中）。
         * 延後的軸必須當下就提交 —— 不然它們之後照聽牌規劃提交，會在急停後
         * 被切速（驗算：第 1 軸變 0.053），違反「急停後依照當下速度」。
         */
        const { machine, log, settled } = await lateServerRun(
            [{ reelIndex: 1, duration: 1.5, speedMultiplier: 1.5 }],
            0.01,
        );
        const at = [0, 1, 2, 3, 4].map((reelIndex) => stopAt(machine, reelIndex));

        check("延後期間急停：五軸都停下來了", settled, true);
        check(
            "延後期間急停：聽牌時間取消（第 1 軸不再多轉 1.5 秒）",
            at[1] - at[0] < 0.5,
            true,
        );
        check(
            "延後期間急停：不再排聽牌切速，維持原速 0.08（急停後依照當下速度）",
            machine.reelList[1].moveInterval,
            0.08,
        );
        check(
            "延後期間急停：延後的軸停輪時刻不遞減、盤面正確、回調成對",
            [
                at.slice(1).every((value, index) =>
                    index === 0 || value >= at[index] - 1e-9),
                machine.getAllVisibleSymbolIds(),
                paired(log, [1]),
            ],
            [true, reversedBoards.map((board) => board.map((data) => data.id)), true],
        );
    }

    {
        /* 連續聽牌、0.05 秒按急停：不當下提交時停輪順序亂成 0,2,1,3,4。 */
        const { machine, settled } = await lateServerRun(
            [
                { reelIndex: 1, duration: 1.5, speedMultiplier: 1.5 },
                { reelIndex: 2, duration: 1.5, speedMultiplier: 1.5 },
            ],
            0.05,
        );

        check("延後期間急停、連續聽牌：五軸都停下來了", settled, true);
        check(
            "延後期間急停、連續聽牌：onReelStopped 依軸序、兩軸都維持原速",
            [
                machine.stopLog.map((entry) => entry.reelIndex),
                [machine.reelList[1].moveInterval, machine.reelList[2].moveInterval],
            ],
            [[0, 1, 2, 3, 4], [0.08, 0.08]],
        );
    }

    group("11s. 伺服器晚到：各軸照 config 的間隔與停止順序停（決議 47）");

    /*
     * 停輪時間 0.15、伺服器 3 秒才送：以前各軸都被鉗到自己的 earliest，
     * 間隔消失、先後隨機（1,215 次反轉／1,728 組）。現在資料到達時沿停止
     * 順序推算：第一軸停在 earliest，之後每軸接在前一軸之後 + config 間隔。
     */
    const lateGaps = async (
        stopTimings?: SlotMachineReelStopTiming[],
    ): Promise<{ machine: HeadlessSlotMachine; settled: boolean }> => {
        const machine = createMachine(
            5,
            [0, 1, 2, 3, 4].map((reelIndex) =>
                timing(reelIndex, reelIndex === 0 ? 0 : 0.1, 0.15)),
            false,
            undefined,
            stopTimings,
        );

        machine.startSpin("normal");
        await advance(machine, 3.0);
        machine.stopSpin(reversedBoards);
        return { machine, settled: await settleAll(machine) };
    };

    {
        const { machine, settled } = await lateGaps();
        const gaps = [1, 2, 3, 4].map((reelIndex) =>
            stopAt(machine, reelIndex) - stopAt(machine, reelIndex - 1));

        check("伺服器晚到、錯開 0.1：五軸都停下來了", settled, true);
        check(
            "伺服器晚到、錯開 0.1：依軸序停，相鄰間隔 0.1（誤差一幀內）",
            [
                machine.stopLog.map((entry) => entry.reelIndex),
                gaps.every((gap) => Math.abs(gap - 0.1) <= oneFrame),
            ],
            [[0, 1, 2, 3, 4], true],
        );
        check(
            "伺服器晚到、錯開 0.1：盤面正確",
            machine.getAllVisibleSymbolIds(),
            reversedBoards.map((board) => board.map((data) => data.id)),
        );
    }

    {
        const { machine, settled } = await lateGaps(stopRightToLeft(0.2));
        const gaps = [3, 2, 1, 0].map((reelIndex) =>
            stopAt(machine, reelIndex) - stopAt(machine, reelIndex + 1));

        check("伺服器晚到、stopTimings 右到左 0.2：五軸都停下來了", settled, true);
        check(
            "伺服器晚到、stopTimings 右到左 0.2：照 config 順序停，相鄰間隔 0.2（誤差一幀內）",
            [
                machine.stopLog.map((entry) => entry.reelIndex),
                gaps.every((gap) => Math.abs(gap - 0.2) <= oneFrame),
            ],
            [[4, 3, 2, 1, 0], true],
        );
    }

    {
        /*
         * 資料在啟動效果中途送到（測試場景的預設：0.05 秒）。第一格從效果
         * 結束那一刻起算，下一個邊界才推算得準 —— 以前第一格吃整幀、起點落在
         * 幀頭，推算出來的最早時刻會比真正的晚（最多一幀）。
         *
         * 五軸同時啟動（排停輪時都還在效果中），效果 0.33 秒不是幀長 1/30 的
         * 整數倍 —— 效果剛好在幀邊界結束時修不修都一樣，測不到。
         */
        const machine = createMachine(
            5,
            [0, 1, 2, 3, 4].map((reelIndex) => timing(reelIndex, 0, 0.15)),
            false,
            undefined,
            undefined,
            {
                enabled: true,
                distance: 50,
                outwardDuration: 0.2,
                returnDuration: 0.13,
            },
        );

        machine.startSpin("normal");
        await advance(machine, 0.05, 1 / 30);
        machine.stopSpin(reversedBoards);
        const settled = await advanceUntil(machine, () => machine.stopLog.length === 5, 12, 1 / 30);
        const plan = machine.reelList[0].lastStopPlan;

        check("啟動效果中送到：五軸都停下來了", settled, true);
        check(
            "啟動效果中送到：第一軸推算的最早時刻就是真正的最早時刻",
            Math.abs(plan.requestedStopTime - plan.earliestStopTime) < 1e-9,
            true,
        );
        check(
            "啟動效果中送到：依軸序停、盤面正確",
            [
                machine.stopLog.map((entry) => entry.reelIndex),
                machine.getAllVisibleSymbolIds(),
            ],
            [[0, 1, 2, 3, 4], reversedBoards.map((board) => board.map((data) => data.id))],
        );
    }

    group("11t. 結果先到後急停：砍表演格時也要拆掉進場端沒湊滿的那組");

    /*
     * 急停砍掉結果前的表演格時，若有一組大 Symbol 只進場了一半，留下的半組
     * 會待在進場 buffer；接著進場的結果若是同一張牌（這裡是第 3 軸 [1,7,7]
     * 的退場端墊格 7），就被接進那半組，groupOffset 錯位、可視段出現沒有
     * head 的空格（瀏覽器截圖：第 4 軸只剩一格）。id 看起來仍是 [1,7,7]，
     * 所以要檢查每一格都找得到自己的 head。
     *
     * 重現條件照測試場景：啟動效果、牌庫含 1×2／1×3、第 1 軸聽牌、
     * 第 4 幀送結果、第 46 幀急停。
     */
    {
        const machine = createMachine(
            5,
            [0, 1, 2, 3, 4].map((reelIndex) =>
                timing(reelIndex, reelIndex === 0 ? 0 : 0.1, 0.15)),
            false,
            undefined,
            undefined,
            {
                enabled: true,
                distance: 50,
                outwardDuration: 0.2,
                returnDuration: 0.1,
            },
        );
        const boards = [
            boardOf([7, 7, 7]),
            boardOf([7, 7, 1]),
            boardOf([7, 1, 1]),
            boardOf([1, 7, 7]),
            boardOf([6, 6, 1]),
        ];

        machine.reelList.forEach((reel) => {
            reel.setPerformanceDataBank(boardOf([1, 6, 3, 7, 2, 4, 6, 3, 7, 4]));
        });
        machine.setListenReels([
            { reelIndex: 1, duration: 1.5, speedMultiplier: 1.5 },
        ]);
        machine.startSpin("normal");

        for (let frame = 1; frame <= 900 && machine.stopLog.length < 5; frame++) {
            machine.clock += 1 / 60;
            machine.update(1 / 60);

            if (frame === 4) {
                machine.stopSpin(boards);
            }

            if (frame === 46) {
                machine.quickStop();
            }

            await flush();
        }

        const headsIntact = machine.reelList.map((reel) => {
            const symbols = reel.symbols;

            for (
                let index = reel.firstVisibleIndex;
                index < reel.firstVisibleIndex + reel.visibleCellCount;
                index++
            ) {
                const head = index - symbols[index].groupOffset;

                if (
                    head < 0
                    || symbols[head].groupOffset !== 0
                    || symbols[head].data.id !== symbols[index].data.id
                ) {
                    return false;
                }
            }

            return true;
        });

        check("結果先到後急停：五軸都停下來了", machine.stopLog.length, 5);
        check(
            "結果先到後急停：可視段每一格都找得到自己的 head（修正前第 3 軸錯位）",
            headsIntact,
            [true, true, true, true, true],
        );
        check(
            "結果先到後急停：盤面 id 正確",
            machine.getAllVisibleSymbolIds(),
            boards.map((board) => board.map((data) => data.id)),
        );
    }

    group("11u. Turbo 急停：結果已進場的軸不能再補牌（不然停不下來）");

    /*
     * Turbo 同步補牌是插在「目前讀到的位置」前面。某一軸的結果已經開始進場
     * 時再補，牌會插進結果中間、把結果切成兩段，這一軸永遠對不齊 —— 實測
     * 5 軸只停 4 軸（第 2 軸可視 [4,6,6]，要的是 [1,6,6]）。
     * Turbo 加上 stopTimings 之後各軸時間不同，才會碰到。
     */
    {
        const machine = createMachine(
            5,
            [0, 1, 2, 3, 4].map((reelIndex) => ({
                reelIndex,
                startDelaySeconds: reelIndex === 0 ? 0 : 0.1,
                targetStopSeconds: 0.15,
                moveIntervalSeconds: 0.05,
            })),
            true,
            undefined,
            stopRightToLeft(0.2),
        );
        const boards = [
            boardOf([1, 7, 7]),
            boardOf([6, 6, 1]),
            boardOf([1, 6, 6]),
            boardOf([1, 2, 3]),
            boardOf([7, 7, 7]),
        ];

        machine.reelList.forEach((reel) => {
            reel.setPerformanceDataBank(boardOf([1, 6, 3, 7, 2, 4, 6, 3, 7, 4]));
        });
        machine.startSpin("normal");
        await advance(machine, 0.5);
        machine.stopSpin(boards);
        await advance(machine, 0.5);
        machine.quickStop();

        check("Turbo 結果先到後急停：五軸都停下來了", await settleAll(machine), true);
        check(
            "Turbo 結果先到後急停：盤面正確",
            machine.getAllVisibleSymbolIds(),
            boards.map((board) => board.map((data) => data.id)),
        );
    }

    group("11v. Turbo 忽略 stopDelaySeconds：全軸同時停（照 Cocos 移植版）");

    /*
     * startDelaySeconds 在 fastMode 本來就被略過（全軸 0 秒啟動）；
     * stopDelaySeconds 同理當 0。Cocos 移植版沒有 stopTimings，Turbo 各軸都在
     * 0 + targetStopSeconds 停。不忽略的話各軸目標不同，每格修正拉長的量不同，
     * 格邊界錯開半格，Turbo 急停同步會有軸晚半格停。
     */
    {
        const machine = createMachine(
            5,
            [0, 1, 2, 3, 4].map((reelIndex) => timing(reelIndex, 0.1, 1.2)),
            true,
            undefined,
            stopRightToLeft(0.2),
        );

        machine.startSpin("normal");
        await advance(machine, 0.3);
        machine.stopSpin(plainBoards);
        check("Turbo + stopTimings：五軸都停下來了", await settleAll(machine), true);

        const at = machine.stopLog.map((entry) => entry.at);
        check(
            "Turbo + stopTimings 0.2：全軸同一幀停、回調照 stopTimings 順序",
            [
                Math.max(...at) - Math.min(...at) < 1e-9,
                machine.stopLog.map((entry) => entry.reelIndex),
            ],
            [true, [4, 3, 2, 1, 0]],
        );
    }

    group("11w. Turbo 全軸同一刻停：資料到時排到最晚那一軸、急停一起縮短");

    /*
     * 與 1016 相同：資料到時補牌數全盤取最大值，不能補的軸也算進去。
     * 以前沿停止順序推算，只有後面的軸會等前面的；急停又把結果已進場的軸
     * 排除在共同目標外，其他軸被砍短先停（Turbo-QuickStop-Order.md §7）。
     */
    const sameFrame = (machine: HeadlessSlotMachine): boolean => {
        const at = machine.stopLog.map((entry) => entry.at);
        return machine.stopLog.length === 5
            && Math.max(...at) - Math.min(...at) < 1e-9;
    };

    {
        const machine = createMachine(
            5,
            [0, 1, 2, 3, 4].map((reelIndex) => timing(reelIndex, 0, 0.9 + 0.1 * reelIndex)),
            true,
        );

        machine.startSpin("normal");
        await advance(machine, 0.3);
        machine.stopSpin(plainBoards);
        check("Turbo 各軸目標不同：五軸都停下來了", await settleAll(machine), true);
        check(
            "Turbo 各軸目標不同：全軸同一幀停在最晚的目標（修正前各停各的）",
            [sameFrame(machine), round2(stopAt(machine, 0))],
            [true, 1.3],
        );
    }

    /*
     * 第 1 軸盤面底部是 7 的頭，要往退場端墊 2 格，最早能停比別軸晚。
     * 目標填得比物理下限小，停輪由最早能停決定：修正前第 0 軸不等它先停。
     */
    const paddedBoards = [
        boardOf([1, 2, 3]),
        boardOf([1, 1, 7]),
        boardOf([1, 2, 3]),
        boardOf([1, 2, 3]),
        boardOf([1, 2, 3]),
    ];

    {
        const machine = createMachine(
            5,
            [0, 1, 2, 3, 4].map((reelIndex) => timing(reelIndex, 0, 0.15)),
            true,
        );

        machine.startSpin("normal");
        await advance(machine, 0.3);
        machine.stopSpin(paddedBoards);
        check("Turbo 某軸要多墊格：五軸都停下來了", await settleAll(machine), true);
        check(
            "Turbo 某軸要多墊格：排在它前面的軸也等它，全軸同一幀停",
            sameFrame(machine),
            true,
        );
    }

    /*
     * 同一盤面、結果送到後隔幾個時間點按急停：有的軸結果已進場（縮不了），
     * 有的還能補。修正前縮不了的軸不列入共同目標，其他軸被砍短先停。
     */
    for (const quickStopAfter of [0.05, 0.1, 0.15, 0.2, 0.25]) {
        const machine = createMachine(
            5,
            [0, 1, 2, 3, 4].map((reelIndex) => timing(reelIndex, 0, 0.15)),
            true,
        );

        machine.startSpin("normal");
        await advance(machine, 0.3);
        machine.stopSpin(paddedBoards);
        await advance(machine, quickStopAfter);
        machine.quickStop();

        const settled = await settleAll(machine);
        check(
            `Turbo 結果送到 ${quickStopAfter} 秒後急停：全軸同一幀停、盤面正確`,
            [
                settled,
                sameFrame(machine),
                machine.getAllVisibleSymbolIds(),
            ],
            [
                true,
                true,
                paddedBoards.map((board) => board.map((data) => data.id)),
            ],
        );
    }

    group("11o. 聽牌回調：有設定聽牌的軸一律成對發出");

    for (const [label, fastMode, quickStop] of [
        ["普通模式、不急停（對照）", false, "none"],
        ["普通模式、先按急停", false, "before"],
        ["fastMode、結果先到後急停", true, "after"],
        ["fastMode、先按急停", true, "before"],
    ] as [string, boolean, "none" | "before" | "after"][]) {
        const { log, settled } = await listenRun(fastMode, quickStop);

        check(`${label}：五軸都停下來了`, settled, true);
        check(
            `${label}：兩個聽牌軸各發一次開始與結束，且開始在結束之前`,
            [2, 3].every((reelIndex) =>
                log.filter((entry) => entry === `start${reelIndex}`).length === 1
                && log.filter((entry) => entry === `end${reelIndex}`).length === 1
                && log.indexOf(`start${reelIndex}`) < log.indexOf(`end${reelIndex}`)),
            true,
        );
        check(
            `${label}：照停止順序（第 2 軸的開始在第 3 軸之前）`,
            log.indexOf("start2") < log.indexOf("start3"),
            true,
        );
    }

    group("11x. 全部完全停下：停止效果播完才結束（GameViewManager §9 G9）");

    {
        const bounce: ReelEffectConfig = {
            enabled: true,
            distance: 20,
            outwardDuration: 0.1,
            returnDuration: 0.1,
        };
        const machine = createMachine(
            3,
            [timing(0, 0, 0.5), timing(1, 0.1, 0.5), timing(2, 0.1, 0.5)],
            false,
            undefined,
            undefined,
            undefined,
            bounce,
        );
        let effectCompletedCount = 0;
        machine.reelList.forEach((reel) => {
            reel.onStopEffectCompleted = () => {
                effectCompletedCount++;
            };
        });

        let settledBeforeSpin = false;
        let reelSettledBeforeSpin = false;
        machine.waitForSettledAsync().then(() => {
            settledBeforeSpin = true;
        });
        machine.reelList[0].waitForSettledAsync().then(() => {
            reelSettledBeforeSpin = true;
        });
        await flush();
        check(
            "還沒轉過任何一輪：機台與單軸都立即結束",
            [settledBeforeSpin, reelSettledBeforeSpin],
            [true, true],
        );

        machine.startSpin("normal");
        checkThrows(
            "轉動中呼叫會 throw（還沒啟動的軸看起來是靜止的）",
            () => machine.waitForSettledAsync(),
        );
        await advance(machine, 0.25);

        const board = boardOf([1, 2, 3]);
        let stopped = false;
        machine.stopSpin([board, board, board]).then(() => {
            stopped = true;
        });
        await advanceUntil(machine, () => stopped);

        let settled = false;
        let settledAt = -1;
        machine.waitForSettledAsync().then(() => {
            settled = true;
            settledAt = machine.clock;
        });
        await flush();

        const lastStop = machine.stopLog[machine.stopLog.length - 1];
        check(
            "stopSpin() 結束時：最後一軸的停止效果還在播、還沒完全停下",
            [machine.reelList[lastStop.reelIndex].stopEffectActive, settled],
            [true, false],
        );

        await advanceUntil(machine, () => settled, 2);
        check(
            "完全停下時：三軸的停止效果都已播完",
            machine.reelList.map((reel) => reel.stopEffectActive),
            [false, false, false],
        );
        check(
            "完全停下的時刻 = 最後一軸停下 + 停止效果長度 0.2 秒（容一格）",
            Math.abs(settledAt - (lastStop.at + 0.2)) <= 1 / 60 + 1e-6,
            true,
        );
        check(
            "遊戲自己掛的 onStopEffectCompleted 照常收到（三軸各一次）",
            effectCompletedCount,
            3,
        );
    }

    {
        const machine = createMachine(3, [
            timing(0, 0, 0.5),
            timing(1, 0.1, 0.5),
            timing(2, 0.1, 0.5),
        ]);

        machine.startSpin("normal");
        await advance(machine, 0.25);

        /* 滾動中就開始等：要靠停輪那一刻結束，不是事後查詢時的「已靜止」。 */
        let reelSettled = false;
        let reelSettledAt = -1;
        machine.reelList[0].waitForSettledAsync().then(() => {
            reelSettled = true;
            reelSettledAt = machine.clock;
        });

        const board = boardOf([1, 2, 3]);
        let stopped = false;
        machine.stopSpin([board, board, board]).then(() => {
            stopped = true;
        });
        await advanceUntil(machine, () => stopped);

        const reel0Stop = machine.stopLog.find((entry) => entry.reelIndex === 0);
        check(
            "沒有停止效果：滾動中開始等的單軸，在它停輪那一幀就完全停下",
            [reelSettled, reel0Stop !== undefined && reelSettledAt === reel0Stop.at],
            [true, true],
        );

        let settled = false;
        machine.waitForSettledAsync().then(() => {
            settled = true;
        });
        await flush();
        check(
            "沒有停止效果：stopSpin() 結束後不必再推進時間就完全停下",
            settled,
            true,
        );
    }

}

// ────────── 12. 掉落雛形（Drop-Module-Readiness §7.4） ──────────

/** 記錄換圖次數的空殼：牌掛在空殼上，只有換新牌的空殼會被 setData()。 */
class CountingDropIcon extends BaseReelIcon {
    public static dataChanges = 0;

    protected onDataChanged(): void {
        CountingDropIcon.dataChanges++;
    }
}

function createDropReel(
    visible: SymbolData[],
    options: { inverseDirection?: boolean; visibleCellCount?: number } = {},
): BaseDropReel {
    const reel = new BaseDropReel();
    reel.registerSymbolCells([
        { symbolId: 1, cellSpan: 1 },
        { symbolId: 2, cellSpan: 1 },
        { symbolId: 3, cellSpan: 1 },
        { symbolId: 4, cellSpan: 1 },
        { symbolId: 6, cellSpan: 2 },
        { symbolId: 7, cellSpan: 3 },
    ]);
    reel.init({
        visibleCellCount: options.visibleCellCount !== undefined ? options.visibleCellCount : 3,
        cellSize: CELL_SIZE,
        moveInterval: 0.1,
        inverseDirection: options.inverseDirection,
    });
    reel.setInitialLayout({
        entryBuffer: fill(1, 3),
        visible,
        exitBuffer: fill(3, 3),
    });
    reel.configureIconDisplay({ iconFactory: () => new CountingDropIcon() });
    return reel;
}

/** 推進單軸掉落；每步讓 promise 鏈走一格。 */
async function advanceDrop(reel: BaseDropReel, seconds: number, step = 1 / 60): Promise<void> {
    let remaining = seconds;

    while (remaining > 1e-9) {
        const slice = Math.min(step, remaining);
        reel.update(slice);
        remaining -= slice;
        await flush();
    }
}

class HeadlessDropMachine extends BaseDropSlotMachine {
    public clock = 0;
    public readonly startLog: { reelIndex: number; at: number }[] = [];

    protected startTicking(): void {
        // 測試自己推進。
    }

    protected registerInitialReelData(): void {
        this.reelList.forEach((reel, reelIndex) => {
            reel.registerSymbolCells([
                { symbolId: 1, cellSpan: 1 },
                { symbolId: 2, cellSpan: 1 },
                { symbolId: 3, cellSpan: 1 },
                { symbolId: 4, cellSpan: 1 },
            ]);
            reel.init({ visibleCellCount: 3, cellSize: CELL_SIZE, moveInterval: 0.1 });
            reel.onDropStarted = () => {
                this.startLog.push({ reelIndex, at: this.clock });
            };
        });
    }

    protected applyInitialLayout(): void {
        for (const reel of this.reelList) {
            reel.setInitialLayout({
                entryBuffer: fill(1, 1),
                visible: boardOf([1, 2, 3]),
                exitBuffer: fill(3, 1),
            });
        }
    }
}

async function advanceDropMachine(
    machine: HeadlessDropMachine,
    seconds: number,
    step = 1 / 60,
): Promise<void> {
    let remaining = seconds;

    while (remaining > 1e-9) {
        const slice = Math.min(step, remaining);
        machine.clock += slice;
        machine.update(slice);
        remaining -= slice;
        await flush();
    }
}

async function runDropSection(): Promise<void> {
    group("12. 掉落雛形：消除補牌（1×1、垂直正向）");

    {
        const reel = createDropReel(boardOf([1, 2, 3]));
        const first = reel.firstVisibleIndex;
        const iconOfOne = reel.icons[first];
        const iconOfTwo = reel.icons[first + 1];
        const iconOfThree = reel.icons[first + 2];
        const yBefore = iconOfOne.y;
        let done = false;

        CountingDropIcon.dataChanges = 0;
        reel.startDropRefill([1], boardOf([4])).then(() => {
            done = true;
        });

        check(
            "開始那一刻：畫面位置不跳（1 還在原位）、只有換新牌的空殼 setData 一次",
            [iconOfOne.y === yBefore, CountingDropIcon.dataChanges],
            [true, 1],
        );
        check(
            "掉落途中查詢回傳掉完之後的盤面（Q7）",
            [reel.dropping, reel.getVisibleCellSymbolIds()],
            [true, [4, 1, 3]],
        );

        await advanceDrop(reel, 0.05);
        check(
            "掉到一半：1 往退場端（+y）走了半格",
            round2(iconOfOne.y - yBefore),
            round2(reel.cellPitch / 2),
        );
        checkThrows("掉落途中再補牌 → throw（Q6）", () => {
            reel.startDropRefill([0], boardOf([4]));
        });
        checkThrows("掉落途中重設盤面 → throw（Q6）", () => {
            reel.setInitialLayout({
                entryBuffer: fill(1, 3),
                visible: boardOf([1, 2, 3]),
                exitBuffer: fill(3, 3),
            });
        });

        await advanceDrop(reel, 0.1);
        check(
            "掉完：1 下移一格；promise resolve；cellOffset 全歸零",
            [
                round2(iconOfOne.y - yBefore),
                done,
                reel.dropping,
                reel.symbols.every((runtime) => runtime.cellOffset === 0),
            ],
            [round2(reel.cellPitch), true, false, true],
        );
        check(
            "牌跟著空殼走：1 的空殼、3 的空殼沒換；被消掉的 2 的空殼換成新牌 4、搬到最上面",
            [
                reel.getVisibleIcons()[1] === iconOfOne,
                reel.getVisibleIcons()[2] === iconOfThree,
                reel.getVisibleIcons()[0] === iconOfTwo,
                iconOfTwo.data !== undefined ? iconOfTwo.data.id : -1,
                CountingDropIcon.dataChanges,
            ],
            [true, true, true, 4, 1],
        );
    }

    group("12b. 大圖整組掉、整組消（Q1）");

    {
        const reel = createDropReel(
            [symbol(6), symbol(1), symbol(2)],
            { visibleCellCount: 4 },
        );

        reel.startDropRefill([3], boardOf([4])).then(() => undefined);
        await advanceDrop(reel, 0.2);
        check(
            "消掉最下面的 2：1×2 的 6 整組往下掉一格，groupOffset 不變",
            [
                reel.getVisibleCellSymbolIds(),
                reel.symbols
                    .slice(reel.firstVisibleIndex, reel.firstVisibleIndex + 4)
                    .map((runtime) => runtime.groupOffset),
            ],
            [[4, 6, 6, 1], [0, 0, 1, 0]],
        );
        checkThrows("只列大圖露出的其中一格 → throw", () => {
            reel.startDropRefill([1], boardOf([4]));
        });
        checkThrows("補牌張數不等於消掉的格數 → throw", () => {
            reel.startDropRefill([1, 2], boardOf([4]));
        });
        checkThrows("補進來的大圖不完整 → throw（雛形未支援截斷）", () => {
            reel.startDropRefill([1, 2], boardOf([4, 7]));
        });

        reel.startDropRefill([1, 2], boardOf([6, 6])).then(() => undefined);
        await advanceDrop(reel, 0.3);
        check(
            "整組消掉 6（兩格都列）、補一張完整的 6：4 往下掉兩格",
            [
                reel.getVisibleCellSymbolIds(),
                reel.symbols
                    .slice(reel.firstVisibleIndex, reel.firstVisibleIndex + 4)
                    .map((runtime) => runtime.groupOffset),
            ],
            [[6, 6, 4, 1], [0, 1, 0, 0]],
        );
    }

    group("12c. 反向（進場在下）：新牌從下面補進來");

    {
        /* 內部順序是進場端 → 退場端 = 下 → 上，所以畫面由上而下讀是 [3,2,1]。 */
        const reel = createDropReel(boardOf([1, 2, 3]), { inverseDirection: true });

        check("初始畫面（由上而下）", reel.getVisibleCellSymbolIds(), [3, 2, 1]);
        reel.startDropRefill([0], boardOf([4])).then(() => undefined);
        await advanceDrop(reel, 0.2);
        check(
            "消掉最上面的 3：2、1 往上掉一格，4 從下面進來",
            reel.getVisibleCellSymbolIds(),
            [2, 1, 4],
        );
    }

    group("12d. 掉落機台：掉出、掉入、軸間隔、守門");

    {
        const machine = new HeadlessDropMachine();
        machine.init(
            [new BaseDropReel(), new BaseDropReel(), new BaseDropReel()],
            { dropInIntervalSeconds: 0.2 },
        );

        let outDone = false;
        machine.dropOut().then(() => {
            outDone = true;
        });
        await advanceDropMachine(machine, 0.4);
        check(
            "掉出：三軸同時開始、掉完後可視區是空的",
            [
                outDone,
                machine.startLog.map((entry) => round2(entry.at)),
                machine.reelList.every((reel) => reel.droppedOut),
            ],
            [true, [0, 0, 0], true],
        );

        machine.startLog.length = 0;
        const dropInAt = machine.clock;
        const boards = [boardOf([4, 4, 4]), boardOf([2, 3, 4]), boardOf([1, 1, 2])];
        let inDone = false;
        machine.dropIn(boards).then(() => {
            inDone = true;
        });
        checkThrows("掉落途中再下指令 → throw（Q6）", () => {
            machine.dropRefill([[0], [], []], [boardOf([1]), [], []]);
        });
        await advanceDropMachine(machine, 1);
        check(
            "掉入：照 dropInIntervalSeconds 0.2 一軸接一軸開始、盤面正確",
            [
                inDone,
                machine.startLog.map((entry) => round2(entry.at - dropInAt)),
                machine.reelList.map((reel) => reel.getVisibleCellSymbolIds()),
            ],
            [true, [0, 0.2, 0.4], boards.map((board) => board.map((data) => data.id))],
        );

        machine.startLog.length = 0;
        machine.dropOut(true).then(() => undefined);
        await advanceDropMachine(machine, 0.4);
        machine.startLog.length = 0;
        machine.dropIn(boards, true).then(() => undefined);
        await advanceDropMachine(machine, 0.4);
        check(
            "Turbo 掉入：不等間隔，三軸同時開始",
            [
                machine.startLog.length,
                machine.startLog.every((entry) => entry.at === machine.startLog[0].at),
            ],
            [3, true],
        );

        let refillDone = false;
        machine.dropRefill([[2], [], [0, 1]], [boardOf([2]), [], boardOf([3, 3])]).then(() => {
            refillDone = true;
        });
        await advanceDropMachine(machine, 0.4);
        check(
            "補牌：沒有要消的軸略過，其他軸同時補",
            [refillDone, machine.reelList.map((reel) => reel.getVisibleCellSymbolIds())],
            [true, [[2, 4, 4], [2, 3, 4], [3, 3, 2]]],
        );
    }

    {
        const reel = new BaseDropReel();
        const machine = new HeadlessDropMachine();
        machine.init([reel], { adoptReels: false });
        check("adoptReels: false：掉落軸留在原本的父層（Q11 暫定）", reel.parent === machine, false);
    }

    group("12e. 掉落急停：直接到位（GameViewManager §9 G6）");

    {
        const reel = createDropReel(boardOf([1, 2, 3]));
        const iconOfOne = reel.icons[reel.firstVisibleIndex];
        const yBefore = iconOfOne.y;
        let completedCount = 0;
        let done = false;

        reel.onDropCompleted = () => {
            completedCount++;
        };
        reel.quickStop();
        check("沒在掉落時急停：不做事、不發通知", [reel.dropping, completedCount], [false, 0]);

        reel.startDropRefill([1], boardOf([4])).then(() => {
            done = true;
        });
        await advanceDrop(reel, 0.03);
        reel.quickStop();
        await flush();
        check(
            "單軸掉到一半急停：1 直接到下一格、cellOffset 全歸零、盤面正確",
            [
                round2(iconOfOne.y - yBefore),
                reel.symbols.every((runtime) => runtime.cellOffset === 0),
                reel.getVisibleCellSymbolIds(),
            ],
            [round2(reel.cellPitch), true, [4, 1, 3]],
        );
        check(
            "單軸急停：掉落結束、promise resolve、onDropCompleted 發一次",
            [reel.dropping, done, completedCount],
            [false, true, 1],
        );
    }

    {
        const machine = new HeadlessDropMachine();
        machine.init(
            [new BaseDropReel(), new BaseDropReel(), new BaseDropReel()],
            { dropInIntervalSeconds: 0.2 },
        );
        machine.dropOut(true).then(() => undefined);
        await advanceDropMachine(machine, 0.4);

        machine.startLog.length = 0;
        const boards = [boardOf([4, 4, 4]), boardOf([2, 3, 4]), boardOf([1, 1, 2])];
        let inDone = false;
        machine.dropIn(boards).then(() => {
            inDone = true;
        });
        await advanceDropMachine(machine, 0.05);
        check("急停前：只有第 0 軸開始、後兩軸還在等間隔", machine.startLog.length, 1);

        machine.quickStop();
        await flush();
        check(
            "機台急停：還在等的軸立刻開始、三軸都直接到位、盤面正確",
            [
                machine.startLog.length,
                machine.reelList.every((reel) => !reel.dropping),
                machine.reelList.every((reel) =>
                    reel.symbols.every((runtime) => runtime.cellOffset === 0)),
                machine.reelList.map((reel) => reel.getVisibleCellSymbolIds()),
            ],
            [3, true, true, boards.map((board) => board.map((data) => data.id))],
        );
        check("機台急停：這批的 promise 照常 resolve", [machine.dropping, inDone], [false, true]);

        let refillDone = false;
        machine.dropRefill([[0], [], []], [boardOf([1]), [], []]).then(() => {
            refillDone = true;
        });
        await advanceDropMachine(machine, 0.2);
        check("急停之後可以接著下一個指令", refillDone, true);
    }

    group("12f. 掉落機台逐軸通知（GameViewManager §9 G5）");

    {
        const machine = new HeadlessDropMachine();
        machine.init(
            [new BaseDropReel(), new BaseDropReel(), new BaseDropReel()],
            { dropInIntervalSeconds: 0.2 },
        );
        const log: { event: string; reelIndex: number; at: number }[] = [];
        machine.onReelDropStarted = (reelIndex) => {
            log.push({ event: "start", reelIndex, at: machine.clock });
        };
        machine.onReelDropCompleted = (reelIndex) => {
            log.push({ event: "done", reelIndex, at: machine.clock });
        };
        const eventsOf = (event: string) =>
            log.filter((entry) => entry.event === event);

        machine.dropOut(true).then(() => undefined);
        await advanceDropMachine(machine, 0.4);
        log.length = 0;

        const boards = [boardOf([4, 4, 4]), boardOf([2, 3, 4]), boardOf([1, 1, 2])];
        const dropInAt = machine.clock;
        machine.dropIn(boards).then(() => {
            log.push({ event: "all", reelIndex: -1, at: machine.clock });
        });
        await advanceDropMachine(machine, 1);
        check(
            "掉入：逐軸開始照間隔 0.2、逐軸到位 = 開始 + 0.3（容一格）",
            [
                eventsOf("start").map((entry) => [entry.reelIndex, round2(entry.at - dropInAt)]),
                eventsOf("done").map((entry) => entry.reelIndex),
                eventsOf("done").every((entry, index) =>
                    Math.abs(entry.at - dropInAt - (0.2 * index + 0.3)) <= 1 / 60 + 1e-6),
            ],
            [[[0, 0], [1, 0.2], [2, 0.4]], [0, 1, 2], true],
        );
        check(
            "逐軸到位都在整批 promise resolve 之前",
            log[log.length - 1].event,
            "all",
        );

        log.length = 0;
        machine.dropRefill([[2], [], [0, 1]], [boardOf([2]), [], boardOf([3, 3])])
            .then(() => undefined);
        await advanceDropMachine(machine, 0.4);
        check(
            "補牌：沒有要消的軸不發通知",
            [
                eventsOf("start").map((entry) => entry.reelIndex),
                eventsOf("done").map((entry) => entry.reelIndex),
            ],
            [[0, 2], [0, 2]],
        );

        machine.dropOut(true).then(() => undefined);
        await advanceDropMachine(machine, 0.4);
        log.length = 0;
        machine.dropIn(boards).then(() => undefined);
        await advanceDropMachine(machine, 0.05);
        machine.quickStop();
        await flush();
        check(
            "急停：還在等的軸也發開始，三軸都發到位",
            [
                eventsOf("start").map((entry) => entry.reelIndex),
                eventsOf("done").map((entry) => entry.reelIndex),
            ],
            [[0, 1, 2], [0, 1, 2]],
        );
    }
}

// ────────── 13. round 流程骨架（GameViewManager-Reference-Study §10） ──────────

type RoundSource = () => Promise<RoundData<string> | null>;

/** 共用的測試設定：round 來源、紀錄、以及要不要讓某個環節等「跳過」。 */
interface RoundTestSetup {
    readonly queue: RoundSource[];
    readonly log: string[];
    waitSkipAt?: RoundStage;
    throwAt?: RoundStage;
}

function stageHook(
    setup: RoundTestSetup,
    stage: RoundStage,
    context: RoundStepContext<string>,
    extra: string,
    manager: { skipResolve?: () => void },
): Promise<void> {
    setup.log.push(`${stage}:${context.round.state}:${context.stepIndex}${extra}`);

    if (setup.throwAt === stage) {
        return Promise.reject(new Error(`hook ${stage} failed`));
    }

    if (setup.waitSkipAt === stage) {
        return new Promise<void>((resolve) => {
            manager.skipResolve = resolve;
        });
    }

    return Promise.resolve();
}

class TestRollManager extends RollRoundManager<string> {
    public skipResolve?: () => void;

    public constructor(
        machines: RoundManagerMachines,
        private readonly _setup: RoundTestSetup,
    ) {
        super(machines);
    }

    protected nextRound(): Promise<RoundData<string> | null> {
        const next = this._setup.queue.shift();
        return next !== undefined ? next() : Promise.resolve(null);
    }

    protected getSpinMode(round: RoundData<string> | null): string {
        this._setup.log.push(`mode:${round === null ? "null" : round.state}`);
        return "normal";
    }

    protected onRoundStart(context: RoundStepContext<string>): Promise<void> {
        const spinning = (this.rollMachine as BaseSlotMachine).spinning;
        return stageHook(this._setup, 1, context, spinning ? "(轉)" : "(停)", this);
    }

    protected onBeforeStep(context: RoundStepContext<string>): Promise<void> {
        return stageHook(this._setup, 2, context, "", this);
    }

    protected onStep(context: RoundStepContext<string>): Promise<void> {
        return stageHook(this._setup, 3, context, "", this);
    }

    protected onAfterStep(context: RoundStepContext<string>): Promise<void> {
        const settled = (this.rollMachine as BaseSlotMachine).reelList
            .every((reel) => !reel.stopEffectActive);
        return stageHook(this._setup, 4, context, settled ? "" : "(回彈中)", this);
    }

    protected onRoundEnd(context: RoundStepContext<string>): Promise<void> {
        return stageHook(this._setup, 5, context, "", this);
    }

    protected onSkipRequested(stage: RoundStage): void {
        this._setup.log.push(`skip:${stage}`);
        if (this.skipResolve !== undefined) {
            this.skipResolve();
        }
    }
}

class TestDropManager extends DropRoundManager<string> {
    public skipResolve?: () => void;

    public constructor(
        machines: RoundManagerMachines,
        private readonly _setup: RoundTestSetup,
    ) {
        super(machines);
    }

    protected nextRound(): Promise<RoundData<string> | null> {
        const next = this._setup.queue.shift();
        return next !== undefined ? next() : Promise.resolve(null);
    }

    protected onRoundStart(context: RoundStepContext<string>): Promise<void> {
        return stageHook(this._setup, 1, context, "", this);
    }

    protected onBeforeStep(context: RoundStepContext<string>): Promise<void> {
        return stageHook(this._setup, 2, context, "", this);
    }

    protected onStep(context: RoundStepContext<string>): Promise<void> {
        return stageHook(this._setup, 3, context, "", this);
    }

    protected onAfterStep(context: RoundStepContext<string>): Promise<void> {
        return stageHook(this._setup, 4, context, "", this);
    }

    protected onRoundEnd(context: RoundStepContext<string>): Promise<void> {
        return stageHook(this._setup, 5, context, "", this);
    }

    protected onSkipRequested(stage: RoundStage): void {
        this._setup.log.push(`skip:${stage}`);
        if (this.skipResolve !== undefined) {
            this.skipResolve();
        }
    }
}

/** 同時推進滾輪與掉落機台，直到條件成立或超時。 */
async function driveUntil(
    machines: { roll?: HeadlessSlotMachine; drop?: HeadlessDropMachine },
    done: () => boolean,
    limitSeconds = 12,
    step = 1 / 60,
): Promise<boolean> {
    let spent = 0;

    while (spent < limitSeconds) {
        if (done()) {
            return true;
        }

        if (machines.roll !== undefined) {
            machines.roll.clock += step;
            machines.roll.update(step);
        }

        if (machines.drop !== undefined) {
            machines.drop.clock += step;
            machines.drop.update(step);
        }

        spent += step;
        await flush();
    }

    return done();
}

function createDropMachine(): HeadlessDropMachine {
    const machine = new HeadlessDropMachine();
    machine.init([new BaseDropReel(), new BaseDropReel(), new BaseDropReel()]);
    return machine;
}

async function runRoundManagerSection(): Promise<void> {
    group("13a. 滾輪 round：起轉早於資料、五個環節的順序、整局結束");

    {
        const bounce: ReelEffectConfig = {
            enabled: true,
            distance: 20,
            outwardDuration: 0.1,
            returnDuration: 0.1,
        };
        const roll = createMachine(
            3,
            [timing(0, 0, 0.5), timing(1, 0.1, 0.5), timing(2, 0.1, 0.5)],
            false,
            undefined,
            undefined,
            undefined,
            bounce,
        );
        let giveFirst: (round: RoundData<string>) => void = () => undefined;
        const firstRound = new Promise<RoundData<string>>((resolve) => {
            giveFirst = resolve;
        });
        const ng = boardOf([1, 2, 3]);
        const fg = boardOf([4, 4, 4]);
        const setup: RoundTestSetup = {
            queue: [
                () => firstRound,
                () => Promise.resolve({ state: "FG", board: [fg, fg, fg] }),
            ],
            log: [],
        };
        const manager = new TestRollManager({ roll }, setup);
        const notices: string[] = [];
        manager.onStageEnter = (stage) => {
            notices.push(String(stage));
        };
        manager.onGameEnd = () => {
            notices.push("end");
        };

        let done = false;
        manager.startGame().then(() => {
            notices.push("resolved");
            done = true;
        });
        check(
            "startGame() 一呼叫就起轉，還沒進任何環節",
            [roll.spinning, manager.playing, manager.currentStage],
            [true, true, undefined],
        );
        checkThrows("一局進行中再 startGame() → throw", () => {
            manager.startGame();
        });

        await driveUntil({ roll }, () => false, 0.3);
        check("資料還沒到：只起轉，沒有進環節", setup.log, ["mode:null"]);

        giveFirst({ state: "NG", board: [ng, ng, ng] });
        const finished = await driveUntil({ roll }, () => done);
        check(
            "兩個 round 的環節順序：NG 資料到時滾輪已在轉；FG 到環節 3 才起轉；環節 4 在回彈播完之後",
            [finished, setup.log],
            [
                true,
                [
                    "mode:null",
                    "1:NG:0(轉)", "2:NG:0", "3:NG:0", "4:NG:0", "5:NG:0",
                    "1:FG:0(停)", "2:FG:0", "mode:FG", "3:FG:0", "4:FG:0", "5:FG:0",
                ],
            ],
        );
        check(
            "通知：五個環節各發一次（兩個 round），整局結束在 startGame() resolve 之前",
            notices,
            ["1", "2", "3", "4", "5", "1", "2", "3", "4", "5", "end", "resolved"],
        );
        check(
            "最後停在 FG 的盤面；結束後不在跑、不在任何環節",
            [roll.getAllVisibleSymbolIds(), manager.playing, manager.currentStage],
            [[[4, 4, 4], [4, 4, 4], [4, 4, 4]], false, undefined],
        );
    }

    group("13b. 掉落 round：資料到才掉出、掉入；消除時 2～4 重複");

    {
        const drop = createDropMachine();
        const boards = [boardOf([4, 4, 4]), boardOf([2, 3, 4]), boardOf([1, 1, 2])];
        const setup: RoundTestSetup = {
            queue: [
                () => Promise.resolve({
                    state: "NG",
                    board: boards,
                    cascades: [{
                        removePositions: [[2], [], [0, 1]],
                        refillCells: [boardOf([2]), [], boardOf([3, 3])],
                    }],
                }),
            ],
            log: [],
        };
        const manager = new TestDropManager({ drop }, setup);
        let done = false;
        manager.startGame().then(() => {
            done = true;
        });

        const finished = await driveUntil({ drop }, () => done);
        check(
            "環節順序：1 → 初始盤面 2、3、4 → 第 1 次消除 2、3、4 → 5",
            [finished, setup.log],
            [
                true,
                ["1:NG:0", "2:NG:0", "3:NG:0", "4:NG:0", "2:NG:1", "3:NG:1", "4:NG:1", "5:NG:1"],
            ],
        );
        check(
            "盤面：掉入之後再消除補牌的結果",
            drop.reelList.map((reel) => reel.getVisibleCellSymbolIds()),
            [[2, 4, 4], [2, 3, 4], [3, 3, 2]],
        );
    }

    group("13c. Stop 分流：滾輪急停、掉落直接到位、表演中通知遊戲跳過");

    {
        const roll = createMachine(3, [
            timing(0, 0, 0.5),
            timing(1, 0.1, 0.5),
            timing(2, 0.1, 0.5),
        ]);
        let quickStops = 0;
        const originalQuickStop = roll.quickStop.bind(roll);
        roll.quickStop = () => {
            quickStops++;
            originalQuickStop();
        };
        const setup: RoundTestSetup = {
            queue: [() => Promise.resolve({ state: "NG", board: [boardOf([1, 2, 3]), boardOf([1, 2, 3]), boardOf([1, 2, 3])] })],
            log: [],
        };
        const manager = new TestRollManager({ roll }, setup);
        let done = false;
        manager.startGame().then(() => {
            done = true;
        });
        manager.requestStop();
        await driveUntil({ roll }, () => done);
        check("滾輪在轉時按 Stop → 轉給滾輪機台 quickStop()", [quickStops, done], [1, true]);
    }

    {
        const drop = createDropMachine();
        let quickStops = 0;
        const originalQuickStop = drop.quickStop.bind(drop);
        drop.quickStop = () => {
            quickStops++;
            originalQuickStop();
        };
        const boards = [boardOf([4, 4, 4]), boardOf([2, 3, 4]), boardOf([1, 1, 2])];
        const setup: RoundTestSetup = {
            queue: [() => Promise.resolve({ state: "NG", board: boards })],
            log: [],
            waitSkipAt: RoundStage.AfterStep,
        };
        const manager = new TestDropManager({ drop }, setup);
        let done = false;
        manager.startGame().then(() => {
            done = true;
        });

        await driveUntil({ drop }, () => drop.dropping, 1);
        manager.requestStop();
        check("掉落中按 Stop → 掉落機台 quickStop()、這一批直接到位", [quickStops, drop.dropping], [1, false]);

        await driveUntil({ drop }, () => manager.currentStage === RoundStage.AfterStep, 3);
        await driveUntil({ drop }, () => done, 0.5);
        check("表演中（環節 4 在等）不會自己結束", done, false);

        manager.requestStop();
        const finished = await driveUntil({ drop }, () => done, 1);
        check(
            "表演中按 Stop → 呼叫遊戲的 onSkipRequested(4)，遊戲收尾後流程往下",
            [finished, setup.log.filter((entry) => entry.startsWith("skip"))],
            [true, ["skip:4"]],
        );
        check("沒在跑一局時按 Stop：不做事", (() => {
            manager.requestStop();
            return quickStops;
        })(), 1);
    }

    group("13d. 出錯往外丟（G12）與守門");

    {
        const drop = createDropMachine();
        const setup: RoundTestSetup = {
            queue: [() => Promise.resolve({ state: "NG", board: [boardOf([1, 2, 3]), boardOf([1, 2, 3]), boardOf([1, 2, 3])] })],
            log: [],
            throwAt: RoundStage.BeforeStep,
        };
        const manager = new TestDropManager({ drop }, setup);
        let gameEnded = false;
        manager.onGameEnd = () => {
            gameEnded = true;
        };
        let rejected = "";
        manager.startGame().catch((error: Error) => {
            rejected = error.message;
        });
        await driveUntil({ drop }, () => rejected !== "", 2);
        check(
            "環節丟錯 → startGame() reject、這一局停下、不發整局結束",
            [rejected, manager.playing, gameEnded],
            ["hook 2 failed", false, false],
        );
    }

    {
        const roll = createMachine(3, [
            timing(0, 0, 0.5),
            timing(1, 0.1, 0.5),
            timing(2, 0.1, 0.5),
        ]);
        const board = boardOf([1, 2, 3]);
        const setup: RoundTestSetup = {
            queue: [() => Promise.resolve({
                state: "NG",
                board: [board, board, board],
                cascades: [{ removePositions: [[0], [], []], refillCells: [boardOf([4]), [], []] }],
            })],
            log: [],
        };
        const manager = new TestRollManager({ roll }, setup);
        let rejected = "";
        manager.startGame().catch((error: Error) => {
            rejected = error.message;
        });
        await driveUntil({ roll }, () => rejected !== "", 3);
        check("round 有消除但沒給掉落機台 → reject", rejected, "A round with cascades requires a drop machine.");
    }

    checkThrows("RollRoundManager 沒給滾輪機台 → throw", () => {
        new TestRollManager({}, { queue: [], log: [] });
    });
    checkThrows("DropRoundManager 沒給掉落機台 → throw", () => {
        new TestDropManager({}, { queue: [], log: [] });
    });
}

// ───────────────────────── 統計 ─────────────────────────

runMultiReelSection().then(runDropSection).then(runRoundManagerSection).then(() => {
    console.log("\n" + "═".repeat(52));
    console.log(`  通過 ${passCount}　失敗 ${failCount}`);
    console.log("═".repeat(52));

    if (failCount > 0) {
        process.exit(1);
    }
});
