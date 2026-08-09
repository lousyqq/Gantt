// 深色模式色彩覆蓋檢查:找出 app.jsx 用到、但 input.css 沒有 .dark 映射的彩色 class。
//
// 為什麼需要:深色模式是以「.dark 覆寫指定 class」實作(見 input.css)。每當新功能用到
// 一個還沒映射的彩色 class(例如 bg-blue-50/70、hover:bg-red-50/40),該元素在深色下
// 會維持「淺色底」,但文字早已被調亮 → 淺底配亮字,整塊糊掉看不見。
// 這類 bug 已重複發生多次(且只有滑鼠移過去才出現的 hover 變體最難用肉眼發現),
// 故在 npm run build 時自動檢查。
//
// 注意:Tailwind 的變體各自是獨立 class,必須分別映射:
//   bg-blue-50 / bg-blue-50/70 / hover:bg-blue-50 → 三個不同的 class。
// 由 npm run build 於「開發機」執行(內網主機不需要 npm/node)。
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
// 註解要先剝掉再比對:說明文字裡常引用 class 名稱當範例(例如解釋某個寫法為何不能用),
// 不剝的話會把「反面教材」當成實際使用中的 class 而誤報。
//   /* */ 整塊移除;// 到行尾也移除,但 `://` 不算(避免吃掉 http:// 之後的內容)。
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const jsx = stripComments(fs.readFileSync(path.join(root, 'ClientApp', 'app.jsx'), 'utf8'));
// input.css 內的 class 帶 CSS 轉義反斜線(.bg-blue-50\/70),比對前先去掉
const css = fs.readFileSync(path.join(root, 'ClientApp', 'input.css'), 'utf8').replace(/\\/g, '');

const COLORS = 'orange|yellow|amber|green|emerald|teal|sky|blue|indigo|violet|purple|pink|red|rose';

// 需要深色映射的 class 樣式:
//  1) 彩色淡底(卡片/晶片):bg-{color}-{50|100|200},含 /40 /70 /80 等透明度變體
//  2) 上述的 hover: 變體
//  3) 彩色文字:text-{color}-{600..900}(在深底上需調亮)
//  4) 上述的 hover: 變體(淺色慣例是 hover 時「加深」,深色下會比底色還暗 → 滑過去看不見)
//  5) 實心動作按鈕(白字):bg-{green|red}-600 及其 hover
// 註:文字類的 (?<!hover:) 不可省 —— 少了它,hover:text-blue-800 會被當成 text-blue-800,
//    只要基底色有映射就誤判為通過(此漏洞曾讓工具列的「展開/收合」hover 態漏網)。
const PATTERNS = [
  { name: '彩色底', re: new RegExp(`(?<!hover:)bg-(${COLORS})-(50|100|200)(\\/[0-9]+)?`, 'g') },
  { name: 'hover 底', re: new RegExp(`hover:bg-(${COLORS}|slate)-(50|100|200|300)(\\/[0-9]+)?`, 'g') },
  { name: '彩色文字', re: new RegExp(`(?<!hover:)text-(${COLORS})-(600|700|800|900)`, 'g') },
  { name: 'hover 文字', re: new RegExp(`hover:text-(${COLORS})-(600|700|800|900)`, 'g') },
  { name: '實心按鈕', re: new RegExp(`(?<!hover:)bg-(green|red)-600`, 'g') },
];

const uniq = (s, re) => [...new Set(s.match(re) || [])];

let missingTotal = 0;
const report = [];
for (const { name, re } of PATTERNS) {
  const used = uniq(jsx, re);
  const mapped = new Set(uniq(css, re));
  const missing = used.filter(c => !mapped.has(c)).sort();
  if (missing.length) {
    missingTotal += missing.length;
    report.push(`  [${name}] ${missing.join(', ')}`);
  }
}

// 6) 任意變體(arbitrary variant)的上色 class,如 [&>th]:bg-slate-100。
//    Tailwind 產生的是 .\[\&\>th\]\:bg-slate-100>th 這個「獨立選擇器」,
//    `.dark .bg-slate-100` 匹配不到它 → 深色下該元素留在淺色底。
//    ⚠ 上面 1~5 的比對是對原始字串做 regex,`[&>th]:bg-slate-100` 會被當成 `bg-slate-100`,
//      只要基底色有映射就誤判通過 —— 成果清單表頭曾因此漏網(深色下對比僅 1.36)。
//      故此處單獨比對「完整字面」是否出現在 input.css 的 .dark 規則中。
const ARBITRARY_RE = /\[&>[^\]]*\]:(?:bg|text|border)-[a-z]+-\d+(?:\/\d+)?/g;
const arbUsed = uniq(jsx, ARBITRARY_RE);
const arbMissing = arbUsed.filter(c => !css.includes(`.dark .${c}`)).sort();
if (arbMissing.length) {
  missingTotal += arbMissing.length;
  report.push(`  [任意變體] ${arbMissing.join(', ')}`
    + `\n      → 這類 class 的 .dark 規則要寫完整字面,例如:`
    + `\n        .dark .\\[\\&\\>th\\]\\:bg-slate-100>th { background-color:#334155; }`
    + `\n      → 或(建議)把顏色直接掛在子元素自己的 class 上,讓既有 .dark 映射自然生效。`);
}

if (missingTotal === 0) {
  console.log('深色模式色彩覆蓋檢查:通過(所有彩色 class 皆有 .dark 映射)。');
  process.exit(0);
}

console.error('');
console.error(`⚠ 深色模式色彩覆蓋檢查:有 ${missingTotal} 個 class 缺少 .dark 映射`);
console.error(report.join('\n'));
console.error('');
console.error('  這些元素在深色模式下會維持淺色底、配上被調亮的文字 → 看不清楚。');
console.error('  請在 ClientApp/input.css 補上對應規則(hover 變體寫成 .dark .hover\\:bg-xxx:hover)。');
console.error('');
// 僅警告不中斷建置:避免臨時樣式實驗時卡住開發;但訊息醒目,務必在發布前補齊。
process.exit(0);
