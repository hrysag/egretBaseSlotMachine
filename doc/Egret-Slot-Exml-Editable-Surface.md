# Slot 底層哪些部分該做成 exml skin 給 UI Editor 編輯

> 引擎版本：egret-core 5.4.1（`D:\Egret_test\egret-core-master\egret-core-master`）
> 編輯器：Egret UI Editor（`C:\Program Files (x86)\Egret\Egret UI Editor`，2021-01-25 build）
> 姊妹文件：[Cocos-To-Egret-Slot-Port-Map.md](Cocos-To-Egret-Slot-Port-Map.md)、`Eui_test\doc\EgretUIEditor-Custom-Components.md`、`Eui_test\doc\Egret-EUI-Skin.md`

---

## 0. 結論

| 對象 | 做成 exml？ | 理由 |
|---|---|---|
| **Symbol／Icon 的美術組合** | ✅ **一定要** | 這就是 Prefab 的替代品，沒有別的選擇 |
| **整台機台的軸位置佈局** | ✅ **值得** | 企劃／美術真正想拖的東西；只需要 `x/y` 與 mask 尺寸 |
| **單軸的 cellSize／cellSpacing／visibleCellCount** | ✅ 可以 | 都是 `number`，編輯器原生支援 |
| **Start Effect／Bounce 的距離與秒數** | ✅ 可以 | 都是 `number` / `boolean` |
| **Easing 種類（`ReelEffectEasing`）** | ⚠️ 勉強 | 自訂 enum **不會有下拉選單**，只能打字串，見 §2.4 |
| **每個 SpinMode 的多軸時間表** | ❌ **不要** | 是 `Array<物件>`；exml 語法支援但編輯器不會幫你編，維護成本遠高於寫在 TS |
| **Symbol Registry（ID → cellSpan）** | ❌ **不要** | 同上，而且是遊戲規則不是畫面 |
| **`BaseReel` 的資料流／停輪邏輯** | ❌ | 不是畫面 |

**核心矛盾**：[Port Map §2.1](Cocos-To-Egret-Slot-Port-Map.md) 建議 `BaseReel` 做成純 class（避開 `eui.Group` 的測量開銷），但**純 class 不可能出現在 UI Editor 面板上**。解法在 §3：拆成「可編輯的殼」＋「純邏輯的核」。

---

## 1. 兩道硬性門檻

### 1.1 要出現在 Component → Custom 面板

已於 `Eui_test\doc\EgretUIEditor-Custom-Components.md` 查證：class 必須**繼承**一個祖先鏈上有 `implements eui.UIComponent` 或 `eui.IViewport` 的類別。

```js
// resources/app/out/egret/workbench/electron-browser/bootstrap/index.js
//   ComponentSourceDataCreater.getRoot()
if (exmlConfig.isInstanceOf(e[t].fullName, "eui.UIComponent") ||
    exmlConfig.isInstanceOf(e[t].fullName, "eui.IViewport")) { /* 收進 Custom */ }
```

實務上就是：**必須 extends `eui.Component` 或 `eui.Group`**（或它們的子類）。`egret.DisplayObjectContainer` **不夠**。

### 1.2 要出現在右側「屬性」面板

編輯器用 TypeScript AST 掃你的 `.ts`，規則寫死在：
`resources/app/out/egret/exts/exml-exts/exml/common/project/parsers/process/parseProcess.node.js`（`TsParser.delintNode`）

```js
_.forEach((e, r) => {
    const i = r.toString();
    if (0 === i.indexOf("$")) return;                                    // ① 不能以 $ 開頭
    const o = e;
    if (o.flags & (n.SymbolFlags.Property | n.SymbolFlags.Accessor)) {
        if (n.getCombinedModifierFlags(o.declarations[0]) &
            (n.ModifierFlags.Protected | n.ModifierFlags.Private | n.ModifierFlags.Readonly)) return;   // ② 必須 public 且非 readonly
        if (o.flags & n.SymbolFlags.Accessor &&
            0 === o.declarations.filter(e => e.kind === n.SyntaxKind.SetAccessor).length) return;        // ③ getter 必須配 setter
        if (o.getDocumentationComment(t).some(e => e.text.indexOf("@private") >= 0)) return;             // ④ JSDoc 不能有 @private
        ...
        if (c.getFlags() & n.TypeFlags.Boolean)      { r = "boolean"; s = e ? e.getText() : "false"; }
        else if (c.getFlags() & n.TypeFlags.String)  { r = "string";  s = e ? e.getText() : '""';   }
        else if (c.getFlags() & n.TypeFlags.Number)  { r = "number";  s = e ? e.getText() : "0";    }
        else { const n = c.getSymbol(); r = n ? f(n, t) : "any"; s = e ? e.getText() : "null"; }        // ⑤ 其餘一律變型別名／any
        const u = new a.Prop;
        u.name = i; u.type = r; u.value = s; y.push(u);
    }
});
```

整理成檢查表：

| 規則 | 說明 |
|---|---|
| ① 屬性名不可以 `$` 開頭 | |
| ② 必須 `public`，且**不可以 `readonly`** | 現有 Config 介面大量使用 `readonly`，搬過來要拿掉 |
| ③ 用 getter 暴露時，**必須同時有 setter** | |
| ④ JSDoc 裡出現 `@private` 就會被藏起來 | 可以當成「這個屬性不給編輯器看」的開關 |
| ⑤ 型別只認 `boolean` / `string` / `number`，其餘變成型別名或 `any` | |

---

## 2. 執行期的另一套規則（跟編輯器**不一樣**）

編輯器能顯示 ≠ 執行期能解析。執行期走 `EXMLConfig`：

### 2.1 `_` 開頭在執行期會被吃掉（編輯器不會）

```ts
// src/extension/eui/exml/EXMLConfig.ts:100-102
if (key == "constructor" || key.charAt(0) == "_" || key.charAt(0) == "$") {
    continue;
}
```

編輯器只擋 `$`，執行期 `_` 和 `$` 都擋。**所以 `public _cellSize` 會在編輯器裡看得到、在執行期卻完全失效** —— 這是最容易踩的不一致。一律不要用底線開頭的 public 屬性。

### 2.2 型別是從「預設值」反推的

```ts
// src/extension/eui/exml/EXMLConfig.ts:96-120（$describe）
let meta = instance.__meta__;
...
if (meta && meta[key])            { resultType = meta[key]; }
else if (isArray(instance[key]))  { resultType = "Array"; }
else {
    resultType = typeof instance[key];
    if (resultType == "function") { continue; }
    if (basicTypes.indexOf(resultType) == -1) { resultType = "any"; }   // basicTypes = ["Array","boolean","string","number"]
}
```

引擎自己的文件講得很清楚（`src/extension/eui/utils/registerProperty.ts:76-80`）：

> 当属性类型为基本数据类型：boolean, number, string, Array 这四种其中之一时，您只需要为自定义的属性赋值上正确的初始值，运行时 EXML 解析器就能通过初始值自动分析出正确的属性类型。
> 若您无法为属性赋值上正确的初始值时（有初始值，比如 null），运行时 EXML 解析器会把此属性当做 string 来处理，若完全没有初始值，将会报错找不到节点属性。

**實務規則：每個要給 exml 編的屬性，欄位宣告時一定要寫上具體預設值。**

```ts
public cellSize: number = 128;        // ✅ typeof → "number"
public cellSize: number;              // ❌ undefined → 報錯找不到節點屬性
public maskRect: egret.Rectangle = null;  // ❌ 被當成 string
```

第三種情況要手動註冊：

```ts
// src/extension/eui/utils/registerProperty.ts:105-124
export function registerProperty(classDefinition, property, type, asDefault?) {
    let prototype = classDefinition.prototype;
    prototype.__meta__ = prototype.__meta__ || {};
    prototype.__meta__[property] = type;
    if (asDefault) { prototype.__defaultProperty__ = property; }
}
```

用法：`eui.registerProperty(ReelView, "maskRect", "egret.Rectangle");`

### 2.3 屬性值支援的寫法

```ts
// src/extension/eui/exml/EXMLParser.ts:1013-1066（formatValue）
else if (type == RECTANGLE) { value = "new " + RECTANGLE + "(" + value + ")"; }   // "0,0,384,384"
...
case "number":  /* 支援 #RRGGBB 轉 0x、"50%" 轉 50 */ break;
case "boolean": value = (value == "false" || !value) ? "false" : "true"; break;
case "string": case "any": value = this.formatString(stringValue); break;
default: egret.$error(2008, ...);   // 其餘直接報錯
```

可用：`number`（含 `#FF0000`、`50%`）、`boolean`、`string`、`any`、`Class`、`egret.Rectangle`（四個逗號分隔數字）。**其餘型別當屬性值一律 error 2008。**

`Array` 只能用**子節點**寫，而且元素必須是標籤（`createFuncForNode` → `new XXX()`），不能是字面值：

```ts
// src/extension/eui/exml/EXMLParser.ts:876-892
if (firstChild.localName == TYPE_ARRAY) {
    for (...) { childFunc = this.createFuncForNode(item); values.push(childFunc); }
    childFunc = "[" + values.join(",") + "]";
}
```

```xml
<ns:reelTimings>
    <e:Array>
        <ns:ReelTiming reelIndex="0" targetStopSeconds="3"/>
    </e:Array>
</ns:reelTimings>
```

語法上成立，但**編輯器的屬性面板不會幫你編這個**，你得手改 exml。所以時間表不要放 exml。

### 2.4 自訂 enum 沒有下拉選單

下拉選單的候選值來自編輯器內建的固定表：

```js
// parseProcess.node.js（TsParser.parseAvailableProps）
const t = this.properties ? this.properties.eumn : null;
if (!t) return;
for (...) { i.available = this.getPropAvailable(r, i.name, t); }
```

那張表是 `resources/app/node_modules/@egret/eui-compiler/property.json` 的 `eumn` 欄位，內容只有 19 筆，**全部是引擎自己的類別**：

```
egret.BitmapFillMode, egret.BlendMode, egret.HorizontalAlign, egret.VerticalAlign,
egret.TextFieldType, eui.ColumnAlign, eui.Direction, eui.RowAlign, eui.ScrollPolicy, ...
```

自訂 class 拿不到任何 `available`，面板只會給你一個文字／數字輸入框。

→ `ReelIconDirection`、`ReelEffectEasing` 這種要給人選的，**改成 `string` 屬性再在程式裡轉**，至少打錯時可以在 `init()` 時丟明確錯誤；或者直接不放 exml。

### 2.5 `w:` 命名空間是編輯器專用

```ts
// src/extension/eui/exml/EXMLConfig.ts:41
export let NS_W: string = "http://ns.egret.com/wing";
```

```ts
// src/extension/eui/exml/EXMLParser.ts:468, 1430
if (node.namespace == NS_W || !node.localName) { continue; }
```

`w:` 的節點與屬性執行期**完全略過**。`w:hostComponent` 就是靠這個機制只給編輯器看。可以拿來塞編輯期預覽用的假 Symbol，不會影響執行期。

---

## 3. 建議架構：殼與核分離

### 3.1 為什麼不能直接讓 `BaseReel extends eui.Group`

`eui.Group` 在**每次子項增刪都會觸發兩次失效**：

```ts
// src/extension/eui/core/UIComponent.ts:1858-1867
if (isContainer) {
    prototype.$childAdded = function (child, index) {
        this.invalidateSize();
        this.invalidateDisplayList();
    };
    prototype.$childRemoved = function (child, index) {
        this.invalidateSize();
        this.invalidateDisplayList();
    };
}
```

而且 `setChildIndex` 會**同時觸發兩者**：

```ts
// src/egret/display/DisplayObjectContainer.ts:522-527
this.$childRemoved(child, lastIndex);
...
this.$childAdded(child, index);
```

滾輪每半格搬一次 Icon、`displayPriority` 重排時又對每個 Icon 呼叫 `setChildIndex` —— 放在 `eui.Group` 裡等於每幀跑好幾輪 measure／layout，純屬浪費。

### 3.2 解法：Group 當殼，內層放普通容器

```text
ReelView  extends eui.Group          ← 可編輯：x/y、cellSize、visibleCellCount、mask、效果參數
  └─ iconLayer : egret.DisplayObjectContainer   ← 程式建立，Group 看不到它的子項增刪
        └─ ReelIcon × N                        ← 每半格搬運、重排都在這層
  └─ BaseReel（純 class，非顯示物件）           ← 資料流、Movement、停輪，完全不碰引擎
```

`iconLayer` 是 `ReelView` 的**唯一**子項，加進去一次之後 Group 再也不會收到 `$childAdded`。Icon 全部掛在 `iconLayer` 底下，`iconLayer.$childAdded` 走的是 `DisplayObjectContainer` 的空實作（`DisplayObjectContainer.ts:681`），零成本。

這也剛好補上 Cocos 版文件裡一直列在待辦的「輕量 Reel View／Adapter」。

### 3.3 三個 exml 的分工

| 檔案 | 根節點 | 誰編 | 內容 |
|---|---|---|---|
| `ReelIconSkin.exml` | `<e:Skin w:hostComponent="ReelIcon">` | 美術 | 一張 Symbol 的完整視覺：Bitmap、外框、Wild 光暈、數字 |
| `ReelViewSkin.exml` | `<e:Skin w:hostComponent="ReelView">` | 美術 | 單軸背景、遮罩框、聽牌特效掛點 |
| `SlotMachineSkin.exml` | `<e:Skin w:hostComponent="SlotMachine">` | 企劃／美術 | 五個 `<ns:ReelView>` 的位置與各軸參數 |

`SlotMachineSkin.exml` 大致長這樣：

```xml
<?xml version="1.0" encoding="utf-8"?>
<e:Skin class="skins.SlotMachineSkin" width="1280" height="720"
        xmlns:e="http://ns.egret.com/eui"
        xmlns:w="http://ns.egret.com/wing"
        xmlns:ns="*">
    <ns:ReelView id="reel0" x="100"  y="120" cellSize="128" cellSpacing="0"
                 visibleCellCount="3" maskRect="0,0,128,384"
                 startEffectEnabled="true" startEffectDistance="50"
                 bounceEnabled="true" bounceDistance="50"/>
    <ns:ReelView id="reel1" x="240"  y="120" .../>
    <ns:ReelView id="reel2" x="380"  y="120" .../>
    <ns:ReelView id="reel3" x="520"  y="120" .../>
    <ns:ReelView id="reel4" x="660"  y="120" .../>
</e:Skin>
```

程式端用 skinParts 取回：

```ts
class SlotMachine extends eui.Component {
    public reel0: ReelView;
    public reel1: ReelView;
    // ...
    protected childrenCreated(): void {
        super.childrenCreated();
        this.init([this.reel0, this.reel1, this.reel2, this.reel3, this.reel4]);
    }
}
```

> skinParts 的型別在執行期是對的、編譯期是 `any`（詳見 `Eui_test\doc\Egret-EUI-SkinParts-Indexing.md`）。這裡改用**明確宣告的公開欄位**（`public reel0: ReelView;`）而不是 `this[skin.skinParts[i]]`，就能把型別拿回來。

### 3.4 另一條路：exml 根節點直接是自訂類別

```ts
// src/extension/eui/exml/EXMLParser.ts:405-407
let superClass = this.getClassNameOfNode(this.currentXML);
this.isSkinClass = (superClass == SKIN_CLASS);
this.currentClass.superClass = superClass;
```

exml 根標籤決定產出 class 的**父類別**，不一定要是 `eui.Skin`。所以也可以寫 `<ns:ReelIcon>` 當根，產出一個 `extends ReelIcon` 的 class 直接 `new`。

- **優點**：不用 `skinName` 繞一圈，最接近 Cocos Prefab 的心智模型。
- **缺點**：這個 class 是 `eval` 出來的全域 class，TS 端拿不到型別；而且與 UI Editor 的 skin 工作流不完全一致。

Icon 這種「同一份視覺複製 N 份」的東西兩種都行；**Reel／SlotMachine 建議用標準 Skin（§3.3）**，因為它們是單例、需要編輯器的視覺化拖拉。

---

## 4. 屬性搬遷檢查表

把現有 Cocos `@property` 搬成 exml 可編屬性時，逐條對照：

```ts
// Cocos（TestSlotMachine.ts）
@property({ min: 1 })
private visibleCellCount = 3;
```

```ts
// Egret
/** 可視區必須完整覆蓋的 Cell 數量。 */
public visibleCellCount: number = 3;     // public、非 readonly、非 _ 開頭、有預設值
```

| Cocos | Egret | 注意 |
|---|---|---|
| `private` + `@property` | 必須改 `public` | 編輯器擋 private／protected |
| `readonly xxx` | 必須拿掉 `readonly` | 編輯器規則 ② |
| `@property({ min: 1 })` | **沒有對應** | 範圍檢查要自己在 setter 或 `init()` 做 |
| `@property({ tooltip: "…" })` | **沒有對應** | 編輯器不讀 JSDoc 當 tooltip（只讀 `@private` 當隱藏） |
| `@property({ type: Enum(X) })` | 改成 `string` 或 `number` | 自訂 enum 沒下拉，見 §2.4 |
| `@property(Prefab)` | 改成 exml skin | |
| `@property(Node)` | 改成 skinPart `id` | |

---

## 5. 尚未查證

- 屬性面板對 `type` 非基本型別（例如 `ReelIconDirection`）實際渲染成什麼控制項 —— 只確認了 `available` 會是空陣列，還沒確認輸入框長相與是否直接不顯示。
- 編輯器是否會把 `eui.registerProperty()` 註冊的型別納入面板（`__meta__` 是**執行期**機制，編輯器走 TS AST，兩者應該互不相通，但沒實測）。
- `w:` 命名空間在編輯器裡能塞哪些預覽用屬性，官方沒有清單。
- exml 的 `Array` 子節點語法在 Egret UI Editor 裡儲存後會不會被格式化破壞（若真要放時間表才需要查）。
