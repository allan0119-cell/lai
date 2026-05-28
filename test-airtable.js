/* ============================================================
   test-airtable.js — Airtable 連線測試工具
   ------------------------------------------------------------
   用法:在「專案資料夾」(有 package.json 的地方)的 PowerShell
   執行:
       node test-airtable.js

   它會逐一檢查 8 個表格的連線狀況,並用中文告訴你哪裡有問題。
   ============================================================ */

const fs = require('fs');

// --- 0. 檢查 Node 版本是否支援 fetch -------------------------
if (typeof fetch !== 'function') {
  console.log('\n❌ 你的 Node.js 版本太舊,不支援 fetch 功能。');
  console.log('   請到 https://nodejs.org 下載最新的 LTS 版(18 以上),');
  console.log('   重新安裝後再試一次。\n');
  process.exit(1);
}

// --- 1. 讀取 .env 檔案 ---------------------------------------
function loadEnv() {
  let txt;
  try {
    txt = fs.readFileSync('.env', 'utf8');
  } catch (e) {
    console.log('\n❌ 在目前的資料夾找不到 .env 檔案。');
    console.log('   請確認兩件事:');
    console.log('   1. 你在「專案資料夾」執行(該資料夾裡有 package.json)。');
    console.log('   2. 已經建立 .env(可從 .env.example 複製一份改名)。\n');
    process.exit(1);
  }
  txt = txt.replace(/^\uFEFF/, ''); // 移除可能的 BOM
  txt.split(/\r?\n/).forEach((line) => {
    if (/^\s*#/.test(line)) return; // 略過註解行
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[m[1]] = v;
    }
  });
}
loadEnv();

const token = (process.env.AIRTABLE_PAT || process.env.AIRTABLE_API_KEY || '').trim();
const baseId = (process.env.AIRTABLE_BASE_ID || '').trim();

const TABLES = [
  'People', 'Parishes', 'Skills', 'People_Skills',
  'Service_Experience', 'Ministry_Needs', 'Matching', 'Communication_Log',
];

console.log('\n========================================');
console.log('   Airtable 連線測試');
console.log('========================================\n');

// --- 2. 基本檢查 --------------------------------------------
if (!token) { console.log('❌ .env 裡找不到 AIRTABLE_PAT 或 AIRTABLE_API_KEY\n'); process.exit(1); }
if (!baseId) { console.log('❌ .env 裡找不到 AIRTABLE_BASE_ID\n'); process.exit(1); }

console.log('  Token  : ' + token.slice(0, 8) + '…  (長度 ' + token.length + ' 字元)');
console.log('  Base ID: ' + baseId + '\n');

if (!token.startsWith('pat')) {
  console.log('⚠️  Airtable 的 Token 通常以 "pat" 開頭,你的看起來不太對。\n');
}
if (!token.includes('.') || token.length < 50) {
  console.log('⚠️  注意:完整的 Airtable Token 中間有一個「.」,總長約 80 字元。');
  console.log('   你目前的 Token 看起來不完整 — 請回 Airtable 複製「整串」。\n');
}

// --- 3. 帶逾時的 fetch --------------------------------------
function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal })
    .finally(() => clearTimeout(timer));
}

// --- 4. 逐表測試 --------------------------------------------
async function checkTable(name) {
  const url = 'https://api.airtable.com/v0/' + baseId
    + '/' + encodeURIComponent(name) + '?maxRecords=1';
  try {
    const res = await fetchWithTimeout(
      url, { headers: { Authorization: 'Bearer ' + token } }, 10000
    );
    if (res.ok) {
      const data = await res.json();
      const has = (data.records || []).length ? '有資料' : '空表';
      return { name, ok: true, code: 200,
        msg: '✅  ' + name + ' — 連線成功(' + has + ')' };
    }
    const code = res.status;
    let hint = '錯誤';
    if (code === 401) hint = 'Token 無效或過期';
    else if (code === 403) hint = 'Token 沒有這個 Base 的權限';
    else if (code === 404) hint = '找不到這個表格(名稱拼錯,或還沒建立)';
    else if (code === 422) hint = '請求格式有誤';
    return { name, ok: false, code,
      msg: '❌  ' + name + ' — 失敗(' + code + ' ' + hint + ')' };
  } catch (e) {
    const m = e.name === 'AbortError' ? '連線逾時' : e.message;
    return { name, ok: false, code: 0,
      msg: '❌  ' + name + ' — 連線錯誤:' + m };
  }
}

// --- 5. 執行並輸出診斷 --------------------------------------
(async () => {
  const results = [];
  for (const t of TABLES) {
    const r = await checkTable(t);
    console.log('  ' + r.msg);
    results.push(r);
  }

  const ok = results.filter((r) => r.ok).length;
  console.log('\n----------------------------------------');
  console.log('  結果:' + ok + ' / ' + TABLES.length + ' 個表格連線成功');
  console.log('----------------------------------------\n');

  if (results.every((r) => r.code === 401)) {
    console.log('🔧 全部 401 — Token 不正確或不完整。');
    console.log('   到 https://airtable.com/create/tokens 重新產生,');
    console.log('   複製「整串」(中間有「.」)貼進 .env。\n');
  } else if (results.every((r) => r.code === 403)) {
    console.log('🔧 全部 403 — Token 沒有授權這個 Base。');
    console.log('   重新建立 Token 時,Access 區塊要把這個 Base 加進去。\n');
  } else if (results.every((r) => r.code === 404)) {
    console.log('🔧 全部 404 — 有兩種可能:');
    console.log('   1. Base ID 填錯(從 Airtable 網址列確認 app 開頭那串)。');
    console.log('   2. 8 個表格都還沒建立。\n');
  } else if (ok < TABLES.length) {
    console.log('🔧 部分表格有問題:');
    results.filter((r) => !r.ok).forEach((r) => {
      console.log('   - ' + r.name + '(' + r.code + ')');
    });
    console.log('\n   請到 Airtable 確認這些表格的「名稱拼字」完全一致');
    console.log('   (英文、大小寫、底線都要一樣)。\n');
  } else {
    console.log('🎉 太好了!8 個表格全部連線成功。');
    console.log('   接下來執行  npm start  就能啟動系統了。\n');
  }
})();
