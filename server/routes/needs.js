/**
 * 需求 / 媒合 / 通聯 API
 * 因為 routes 之間關連性高,合併在同一個 router 比較直觀。
 *   POST  /needs                        申請需求(公開)
 *   GET   /needs                        列出(管理)
 *   GET   /needs/:id                    單筆(管理)
 *   PUT   /needs/:id                    更新狀態(管理)
 *   GET   /needs/:id/recommend          自動推薦人選(管理)
 *   POST  /needs/:id/match              建立媒合紀錄(批次)(管理)
 *   GET   /needs/:id/roster             產生服務名單(管理)
 *   POST  /matching/:id/invite          產生 LINE/Email 邀請文(管理)
 *   PUT   /matching/:id                 更新媒合狀態(管理)
 *   POST  /communication-log            新增通聯紀錄(管理)
 */
const express = require('express');
const router = express.Router();

const at = require('../airtable');
const { requireAdmin } = require('../middleware/auth');
const { recommendForNeed } = require('../services/matching');
const { generateInvitations } = require('../services/invitation');

// ---------- 公開:需求申請 ----------
router.post('/needs', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.consent) return res.status(400).json({ error: '請先同意個資使用聲明' });
    if (!body['需求單位'] || !body['申請人'] || !body['活動名稱'] || !body['活動日期']) {
      return res.status(400).json({ error: '請完整填寫需求單位、申請人、活動名稱、活動日期' });
    }

    const fields = sanitizeNeedFields(body);
    fields['狀態'] = '受理';
    fields['建立日期'] = new Date().toISOString();

    const record = await at.createRecord(at.TABLES.MINISTRY_NEEDS, fields);
    res.json({ success: true, id: record.id, message: '已收到需求,我們會盡快媒合' });
  } catch (err) { next(err); }
});

// ---------- 管理:列出需求 ----------
router.get('/needs', requireAdmin, async (req, res, next) => {
  try {
    const { status, urgency } = req.query;
    const filters = {};
    if (status) filters['狀態'] = status;
    if (urgency) filters['急迫程度'] = urgency;
    const records = await at.listRecords(at.TABLES.MINISTRY_NEEDS, {
      filterByFormula: at.buildFilterFormula(filters),
      sort: [{ field: '活動日期', direction: 'asc' }],
    });
    res.json({ count: records.length, records });
  } catch (err) { next(err); }
});

router.get('/needs/:id', requireAdmin, async (req, res, next) => {
  try {
    const need = await at.getRecord(at.TABLES.MINISTRY_NEEDS, req.params.id);
    const matches = await at.listRecords(at.TABLES.MATCHING, {
      filterByFormula: `FIND('${req.params.id}', ARRAYJOIN({需求單} & '', ',')) > 0`,
    });
    res.json({ need, matches });
  } catch (err) { next(err); }
});

router.put('/needs/:id', requireAdmin, async (req, res, next) => {
  try {
    const fields = sanitizeNeedFields(req.body || {});
    const record = await at.updateRecord(at.TABLES.MINISTRY_NEEDS, req.params.id, fields);
    res.json({ success: true, record });
  } catch (err) { next(err); }
});

// ---------- 管理:自動推薦 ----------
router.get('/needs/:id/recommend', requireAdmin, async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit || '20', 10);
    const result = await recommendForNeed(req.params.id, { limit });
    res.json(result);
  } catch (err) { next(err); }
});

// ---------- 管理:批次建立媒合 ----------
router.post('/needs/:id/match', requireAdmin, async (req, res, next) => {
  try {
    const { candidates = [] } = req.body || {};
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ error: '請提供候選人清單' });
    }

    const rows = candidates.map(c => ({
      '需求單': [req.params.id],
      '候選人': [c.personId],
      '符合專長': c.matchedSkills || [],
      '推薦原因': c.reason || '',
      '邀請狀態': '未發',
      '回覆狀態': '待定',
      '更新日期': new Date().toISOString(),
    }));

    const created = await at.createRecords(at.TABLES.MATCHING, rows);

    // 同時更新需求單狀態為「媒合中」
    await at.updateRecord(at.TABLES.MINISTRY_NEEDS, req.params.id, { '狀態': '媒合中' });

    res.json({ success: true, count: created.length, records: created });
  } catch (err) { next(err); }
});

// ---------- 管理:產生服務名單 ----------
router.get('/needs/:id/roster', requireAdmin, async (req, res, next) => {
  try {
    const need = await at.getRecord(at.TABLES.MINISTRY_NEEDS, req.params.id);

    const matches = await at.listRecords(at.TABLES.MATCHING, {
      filterByFormula: `AND(FIND('${req.params.id}', ARRAYJOIN({需求單} & '', ',')) > 0, {最終結果} = '確認服務')`,
    });

    // 帶上人員詳細資料
    const personIds = matches
      .map(m => Array.isArray(m['候選人']) ? m['候選人'][0] : m['候選人'])
      .filter(Boolean);

    const people = await Promise.all(
      personIds.map(id => at.getRecord(at.TABLES.PEOPLE, id).catch(() => null))
    );

    const roster = matches.map((m, i) => ({
      matchId: m.id,
      person: people[i],
      role: m['分派角色'] || '',
      matchedSkills: m['符合專長'] || [],
      note: m['備註'] || '',
    }));

    res.json({ need, roster, count: roster.length });
  } catch (err) { next(err); }
});

// ---------- 管理:產生邀請文(LINE / Email) ----------
router.post('/matching/:id/invite', requireAdmin, async (req, res, next) => {
  try {
    const { channel = 'line' } = req.body || {};
    const result = await generateInvitations(req.params.id, channel);
    res.json(result);
  } catch (err) { next(err); }
});

// ---------- 管理:更新媒合狀態 ----------
router.put('/matching/:id', requireAdmin, async (req, res, next) => {
  try {
    const allowed = ['邀請狀態', '回覆狀態', '最終結果', '分派角色', '備註'];
    const fields = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) fields[k] = req.body[k];
    }
    fields['更新日期'] = new Date().toISOString();
    const record = await at.updateRecord(at.TABLES.MATCHING, req.params.id, fields);
    res.json({ success: true, record });
  } catch (err) { next(err); }
});

// ---------- 管理:通聯紀錄 ----------
router.post('/communication-log', requireAdmin, async (req, res, next) => {
  try {
    const allowed = ['人員', '日期', '聯絡方式', '目的', '結果', '處理人', '下一步'];
    const fields = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) fields[k] = req.body[k];
    }
    if (!fields['日期']) fields['日期'] = new Date().toISOString().slice(0, 10);
    if (typeof fields['人員'] === 'string') fields['人員'] = [fields['人員']];
    const record = await at.createRecord(at.TABLES.COMMUNICATION_LOG, fields);
    res.json({ success: true, record });
  } catch (err) { next(err); }
});

router.get('/communication-log/:personId', requireAdmin, async (req, res, next) => {
  try {
    const records = await at.listRecords(at.TABLES.COMMUNICATION_LOG, {
      filterByFormula: `FIND('${req.params.personId}', ARRAYJOIN({人員} & '', ',')) > 0`,
      sort: [{ field: '日期', direction: 'desc' }],
    });
    res.json({ count: records.length, records });
  } catch (err) { next(err); }
});

// --- helper ---
function sanitizeNeedFields(body) {
  const allowed = [
    '需求單位', '申請人', '聯絡方式', '活動名稱', '活動日期', '地點',
    '所需專長', '所需人數', '條件', '服務時段', '急迫程度', '狀態', '備註',
  ];
  const out = {};
  for (const k of allowed) {
    if (body[k] !== undefined) out[k] = body[k];
  }
  // 所需專長若是字串陣列(skill record ids) → linked field 會接受
  return out;
}

module.exports = router;
