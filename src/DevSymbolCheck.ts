/**
 * 開發期素材驗證畫面。
 *
 * 目的：在寫任何 Reel 邏輯之前，先確認資源管線是通的 ——
 * RES.loadGroup("symbol") 能載入、RES.getRes() 拿得到 Texture、
 * egret.Bitmap 能顯示，而且 1×2 / 1×3 的大圖確實是 cell 高度的整數倍。
 *
 * 正式 Reel 場景完成後可以整個刪掉，Main.startScene() 一併改掉即可。
 */
class DevSymbolCheck extends egret.DisplayObjectContainer {

    /** 一個 1×1 Cell 的軸向長度（垂直方向的高）。 */
    private static readonly CELL = 128;

    /** 一條軸的寬度。 */
    private static readonly COL = 160;

    /** 1×1 素材，依 Symbol ID 1～10 排列。 */
    private static readonly SINGLE_CELL_KEYS: string[] = [
        "symbol_01_png", "symbol_02_png", "symbol_03_png", "symbol_04_png",
        "symbol_05_png", "symbol_06_png", "symbol_07_png", "symbol_08_png",
        "symbol_09_png", "symbol_10_png",
    ];

    /** 跨格素材對照：同一個 Symbol ID 的 1×1 版與 1×N 版。 */
    private static readonly SPAN_SAMPLES: {
        key: string;
        span: number;
        label: string;
    }[] = [
        { key: "symbol_06_png", span: 1, label: "06  1x1" },
        { key: "symbol_062_png", span: 2, label: "062 1x2" },
        { key: "symbol_07_png", span: 1, label: "07  1x1" },
        { key: "symbol_073_png", span: 3, label: "073 1x3" },
    ];

    private readonly _missingKeys: string[] = [];

    public constructor() {
        super();
        this.build();
        this.reportResult();
    }

    private build(): void {
        const cell = DevSymbolCheck.CELL;
        const col = DevSymbolCheck.COL;

        // ── 區塊 A：10 張 1×1，4 欄 × 3 列，剛好塞滿 640 寬 ──
        this.addLabel("1x1  (160 x 128)", 4, -22);

        for (let i = 0; i < DevSymbolCheck.SINGLE_CELL_KEYS.length; i++) {
            const column = i % 4;
            const row = Math.floor(i / 4);
            this.addSymbol(
                DevSymbolCheck.SINGLE_CELL_KEYS[i],
                column * col,
                row * cell,
            );
        }

        const sectionATop = 0;
        const sectionABottom = 3 * cell;
        this.addGrid(sectionATop, sectionABottom);

        // ── 區塊 B：跨格對照，靠格線確認 2x / 3x ──
        const sectionBTop = sectionABottom + 64;
        this.addLabel("span  (062 = 2 cells, 073 = 3 cells)", 4, sectionBTop - 22);

        let maxSpan = 1;

        for (let i = 0; i < DevSymbolCheck.SPAN_SAMPLES.length; i++) {
            const sample = DevSymbolCheck.SPAN_SAMPLES[i];
            this.addSymbol(sample.key, i * col, sectionBTop);
            this.addLabel(
                sample.label,
                i * col + 4,
                sectionBTop + sample.span * cell - 20,
            );
            maxSpan = Math.max(maxSpan, sample.span);
        }

        this.addGrid(sectionBTop, sectionBTop + maxSpan * cell);
    }

    /**
     * 放一張素材。
     *
     * 刻意不設定 width/height —— 直接用素材原始尺寸顯示，
     * 這樣才能看出美術是不是真的等於 span × cellPitch。
     */
    private addSymbol(key: string, x: number, y: number): void {
        const texture: egret.Texture = RES.getRes(key);

        if (!texture) {
            this._missingKeys.push(key);
            return;
        }

        const bitmap = new egret.Bitmap();
        bitmap.texture = texture;
        bitmap.x = x;
        bitmap.y = y;
        this.addChild(bitmap);
    }

    /** 每 128 畫一條橫線、每 160 畫一條直線，用來目視對齊。 */
    private addGrid(top: number, bottom: number): void {
        const cell = DevSymbolCheck.CELL;
        const col = DevSymbolCheck.COL;
        const right = 4 * col;
        const grid = new egret.Shape();
        grid.graphics.lineStyle(1, 0x00ff88, 0.55);

        for (let y = top; y <= bottom; y += cell) {
            grid.graphics.moveTo(0, y);
            grid.graphics.lineTo(right, y);
        }

        for (let x = 0; x <= right; x += col) {
            grid.graphics.moveTo(x, top);
            grid.graphics.lineTo(x, bottom);
        }

        this.addChild(grid);
    }

    private addLabel(text: string, x: number, y: number): void {
        const field = new egret.TextField();
        field.text = text;
        field.size = 16;
        field.textColor = 0xffff66;
        field.x = x;
        field.y = y;
        this.addChild(field);
    }

    /** 把驗證結果寫到 Console，畫面沒出來時才知道是哪一步斷掉。 */
    private reportResult(): void {
        if (this._missingKeys.length > 0) {
            console.error(
                "[DevSymbolCheck] 這些 key 取不到 Texture：",
                this._missingKeys.join(", "),
            );
            return;
        }

        const single: egret.Texture = RES.getRes("symbol_01_png");
        const double: egret.Texture = RES.getRes("symbol_062_png");
        const triple: egret.Texture = RES.getRes("symbol_073_png");

        console.log(
            "[DevSymbolCheck] 全部素材到位。"
            + ` 1x1=${single.textureWidth}x${single.textureHeight}`
            + ` 1x2=${double.textureWidth}x${double.textureHeight}`
            + ` 1x3=${triple.textureWidth}x${triple.textureHeight}`,
        );

        const cell = single.textureHeight;
        const doubleOk = double.textureHeight === cell * 2;
        const tripleOk = triple.textureHeight === cell * 3;

        console.log(
            `[DevSymbolCheck] cellPitch=${cell}`
            + ` / 062 是 2 倍：${doubleOk}`
            + ` / 073 是 3 倍：${tripleOk}`,
        );
    }
}
