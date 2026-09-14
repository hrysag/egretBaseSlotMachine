/**
 * 補上引擎 d.ts 缺的 `NodeJS` 命名空間。
 *
 * `libs/modules/egret/egret.d.ts` 第一行是：
 *
 * ```ts
 * declare var global: NodeJS.Global;
 * ```
 *
 * 那個 `NodeJS` 來自 `@types/node`，但引擎沒有提供，專案的 tsconfig
 * 也設了 `"types": []`（不載任何 @types）。結果是**任何**使用這份
 * Egret 5.4.1 引擎的專案，只要走引擎自帶編譯器的指令（例如
 * `egret clean`），第一行就會報：
 *
 * ```text
 * egret.d.ts (1,21): Cannot find namespace 'NodeJS'.
 * ```
 *
 * 官方腳手架 Eui_test 也一樣。這裡用三行把缺口補起來，
 * 不需要 node_modules、不需要 @types/node、不改引擎。
 *
 * ## 為什麼不裝 @types/node
 *
 * 裝了就得在專案根放 `package.json`，而 `tools/commands/build.ts`
 * 一開頭會偵測根目錄的 `package.json` —— 只要它存在而且
 * `tsconfig.json` 也存在，`egret build` 就會改走 `buildLib()`
 * 分支，接著因為我們的 tsconfig 用的是 `outDir` 而非 `outFile`
 * 直接 `globals.exit(1122)`。也就是說：**在專案根放 package.json
 * 會讓 `egret build` 整個失效。**
 *
 * 真的需要 @types/node 時（例如把 scripts/ 的工具改寫成 TS），
 * 要裝在子目錄並用 tsconfig 的 `typeRoots` 指過去，不能放根目錄。
 *
 * 這個宣告只是讓型別名字解析得出來；瀏覽器端不會用到任何 Node API。
 */
declare namespace NodeJS {
    interface Global {
        [key: string]: any;
    }
}
