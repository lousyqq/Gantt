// 建置後自動幫 index.html 的 app.js / app.css 蓋上版本戳記(快取破壞)。
// 目的:企業內網部署時,IIS/瀏覽器會快取舊的 app.css,新版 app.js 用到的新樣式
// 在舊 CSS 不存在 → 白底白字。加上 ?v=時間戳 可強制瀏覽器抓新檔。
// 由 npm run build 於「開發機」執行(內網主機不需要 npm/node)。
const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'wwwroot', 'index.html');
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12); // yyyyMMddHHmm

let html = fs.readFileSync(indexPath, 'utf8');
html = html.replace(/app\.css(\?v=[^"']*)?/g, `app.css?v=${stamp}`);
html = html.replace(/app\.js(\?v=[^"']*)?/g, `app.js?v=${stamp}`);
fs.writeFileSync(indexPath, html, 'utf8');
console.log(`index.html 資產版本已更新為 v=${stamp}`);
