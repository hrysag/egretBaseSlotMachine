// 用 Egret 引擎內建的 TypeScript 2.4.2（typescript-plus）照專案 tsconfig.json 做型別檢查。
// 引擎的 bin/tsc 缺 lib/tsc.js，所以直接呼叫 lib/typescript.js 的 API（Egret CLI 也是這樣用）。
// 用法：node run-workflow/round-manager-followup/check-ts242.js
"use strict";

var path = require("path");
var ts = require("D:/engine/egret/egret-core-master/tools/lib/typescript-plus/lib/typescript.js");

var projectRoot = path.resolve(__dirname, "../..");
var configPath = path.join(projectRoot, "tsconfig.json");

var configFile = ts.readConfigFile(configPath, ts.sys.readFile);
if (configFile.error) {
    console.error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
    process.exit(2);
}

var parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, projectRoot);
var options = parsed.options;
options.noEmit = true;

var program = ts.createProgram(parsed.fileNames, options);
var diagnostics = ts.getPreEmitDiagnostics(program);

function formatDiagnostic(diagnostic) {
    var message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    if (!diagnostic.file) {
        return "error TS" + diagnostic.code + ": " + message;
    }
    var position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    var fileName = path.relative(projectRoot, diagnostic.file.fileName);
    return fileName + "(" + (position.line + 1) + "," + (position.character + 1) + "): error TS"
        + diagnostic.code + ": " + message;
}

for (var i = 0; i < diagnostics.length; i++) {
    console.log(formatDiagnostic(diagnostics[i]));
}

console.log("TypeScript " + ts.version + " - " + diagnostics.length + " error(s)");
process.exit(diagnostics.length === 0 ? 0 : 1);
