const assert = require('node:assert/strict');
const at = require('./server/airtable');
const router = require('./server/routes/people');
function handler(path, method) {
  return router.stack.find(layer => layer.route && layer.route.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
}
async function call(path, method, req) {
  const result = { status: 200 };
  await handler(path, method)(req, {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; },
  }, error => { throw error; });
  return result;
}
(async () => {
  at.listRecords = async () => [{ 手機: '0912-345-678' }];
  let result = await call('/', 'post', { body: { consent: true, 姓名: 'Test', 手機: '+886 912345678' } });
  assert.equal(result.status, 409);
  const people = Array.from({ length: 25 }, (_, i) => ({ id: 'rec' + i, 姓名: 'Test', 狀態: '已啟用', 手機: 'private', 名片圖檔資料: 'private' }));
  at.listRecords = async table => table === at.TABLES.PEOPLE ? [...people, { id: 'pending', 狀態: '待審核' }]
    : table === at.TABLES.SKILLS ? [{ id: 'skill', 專長名稱: '攝影' }]
    : people.map(p => ({ 人員: [p.id], 專長: ['skill'] }));
  result = await call('/public/search', 'get', { query: { skill: '攝影', page: '3' } });
  assert.equal(result.body.count, 25);
  assert.equal(result.body.records.length, 1);
  assert.equal(result.body.totalPages, 3);
  assert.equal(result.body.records[0].手機, undefined);
  assert.equal(result.body.records[0].名片圖檔資料, undefined);
  result = await call('/public/search', 'get', { query: { skill: '不存在' } });
  assert.equal(result.body.count, 0);
  at.updateRecord = async (table, id, fields) => ({ id, ...fields });
  result = await call('/:id', 'put', { params: { id: 'rec0' }, body: { 名片圖檔資料: '' } });
  assert.equal(result.body.record.名片圖檔資料, '');
  await assert.rejects(call('/:id', 'put', { params: { id: 'rec0' }, body: { 名片圖檔資料: 'data:image/jpeg;base64,abc" onerror="bad' } }));
  console.log('PASS: duplicate phone, skill filter, pagination, privacy, card removal and invalid image rejection');
})().catch(error => { console.error(error); process.exitCode = 1; });
