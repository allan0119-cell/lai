/**
 * Airtable 封裝層
 * - PAT 只在這個檔案裡讀取,絕不傳給前端
 * - 所有路由都呼叫這裡的函式,不直接接觸 Airtable SDK
 */
const Airtable = require('airtable');

const airtableApiKey = process.env.AIRTABLE_PAT || process.env.AIRTABLE_API_KEY;

if (airtableApiKey && process.env.AIRTABLE_BASE_ID) {
  Airtable.configure({
    endpointUrl: 'https://api.airtable.com',
    apiKey: airtableApiKey,
  });
}

const base = process.env.AIRTABLE_BASE_ID
  ? Airtable.base(process.env.AIRTABLE_BASE_ID)
  : null;

const TABLES = {
  PEOPLE: 'People',
  PARISHES: 'Parishes',
  SKILLS: 'Skills',
  PEOPLE_SKILLS: 'People_Skills',
  SERVICE_EXPERIENCE: 'Service_Experience',
  MINISTRY_NEEDS: 'Ministry_Needs',
  MATCHING: 'Matching',
  COMMUNICATION_LOG: 'Communication_Log',
};

function ensureBase() {
  if (!base) {
    const err = new Error('Airtable 尚未設定 (AIRTABLE_PAT or AIRTABLE_API_KEY / AIRTABLE_BASE_ID)');
    err.status = 500;
    throw err;
  }
}

function formatRecord(record) {
  return { id: record.id, ...record.fields };
}

function cleanSelectOptions(options = {}) {
  const cleaned = { pageSize: 100 };

  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || value === null) continue;
    if (key === 'filterByFormula' && value === '') continue;
    cleaned[key] = value;
  }

  return cleaned;
}

/**
 * 列出資料(自動分頁)
 * @param {string} tableName
 * @param {object} options - { filterByFormula, sort, fields, maxRecords }
 */
async function listRecords(tableName, options = {}) {
  ensureBase();
  const records = [];
  await base(tableName)
    .select(cleanSelectOptions(options))
    .eachPage((pageRecords, fetchNextPage) => {
      records.push(...pageRecords.map(formatRecord));
      fetchNextPage();
    });
  return records;
}

async function getRecord(tableName, id) {
  ensureBase();
  const record = await base(tableName).find(id);
  return formatRecord(record);
}

async function createRecord(tableName, fields) {
  ensureBase();
  const records = await base(tableName).create([{ fields }], { typecast: true });
  return formatRecord(records[0]);
}

async function createRecords(tableName, fieldsArray) {
  ensureBase();
  const results = [];
  for (let i = 0; i < fieldsArray.length; i += 10) {
    const batch = fieldsArray.slice(i, i + 10).map(fields => ({ fields }));
    const records = await base(tableName).create(batch, { typecast: true });
    results.push(...records.map(formatRecord));
  }
  return results;
}

async function updateRecord(tableName, id, fields) {
  ensureBase();
  const records = await base(tableName).update([{ id, fields }], { typecast: true });
  return formatRecord(records[0]);
}

async function deleteRecord(tableName, id) {
  ensureBase();
  const records = await base(tableName).destroy([id]);
  return { id: records[0].id, deleted: true };
}

/**
 * 把查詢條件物件轉成 Airtable formula。
 * 支援:
 *   - 字串 (完全相符):              { 狀態: '已啟用' }
 *   - 陣列 (任一相符,可用於多選):  { 可服務區域: ['台中市', '彰化縣'] }
 *   - 布林:                          { 是否願意接受邀請: true }
 *   - 字串包含搜尋:                  { 姓名: { contains: '王' } }
 */
function buildFilterFormula(filters = {}) {
  const parts = [];
  const esc = s => String(s).replace(/'/g, "\\'");

  for (const [field, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;

    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      const orParts = value.map(
        v => `FIND('${esc(v)}', ARRAYJOIN({${field}} & '', ',')) > 0`
      );
      parts.push(`OR(${orParts.join(', ')})`);
    } else if (typeof value === 'boolean') {
      parts.push(`{${field}} = ${value ? 'TRUE()' : 'FALSE()'}`);
    } else if (typeof value === 'object' && value.contains) {
      parts.push(`SEARCH(LOWER('${esc(value.contains)}'), LOWER({${field}} & '')) > 0`);
    } else {
      parts.push(`{${field}} = '${esc(value)}'`);
    }
  }

  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return `AND(${parts.join(', ')})`;
}

module.exports = {
  TABLES,
  listRecords,
  getRecord,
  createRecord,
  createRecords,
  updateRecord,
  deleteRecord,
  buildFilterFormula,
};
