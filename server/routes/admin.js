/**
 * 管理後台 API
 *   POST  /auth/login                登入
 *   GET   /parishes                  堂區列表(公開,登錄表單會用)
 *   POST  /parishes                  新增堂區(管理)
 *   PUT   /parishes/:id              更新(管理)
 *   GET   /skills                    技能字典(公開,登錄表單會用)
 *   POST  /skills                    新增技能(管理)
 *   PUT   /skills/:id                更新(管理)
 *   GET   /reports/distribution      人才分布
 *   GET   /reports/gaps              缺口分析
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

const at = require('../airtable');
const { requireAdmin, signAdminToken } = require('../middleware/auth');
const { distributionReport, gapReport } = require('../services/reports');
const { getTalentSettings, saveTalentSettings } = require('../services/settings');

// ---------- 登入 ----------
router.post('/auth/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: '請輸入帳號密碼' });
    }
    if (username !== process.env.ADMIN_USERNAME) {
      return res.status(401).json({ error: '帳號或密碼錯誤' });
    }
    const passwordHash = process.env.ADMIN_PASSWORD_HASH || '';
    const plainPassword = process.env.ADMIN_PASSWORD || '';
    const ok = passwordHash
      ? await bcrypt.compare(password, passwordHash)
      : Boolean(plainPassword && password === plainPassword);
    if (!ok) {
      return res.status(401).json({ error: '帳號或密碼錯誤' });
    }
    const token = signAdminToken({ role: 'admin', sub: username });
    res.json({ token, expiresIn: process.env.JWT_EXPIRES_IN || '12h' });
  } catch (err) { next(err); }
});

// ---------- 堂區 ----------
router.get('/parishes', async (req, res, next) => {
  try {
    const records = await listParishesSafely();
    res.json({ records });
  } catch (err) { next(err); }
});

router.post('/parishes', requireAdmin, async (req, res, next) => {
  try {
    const allowed = ['堂區名稱', '鐸區', '縣市', '地址', '窗口', '電話', '備註'];
    const fields = {};
    for (const k of allowed) if (req.body[k] !== undefined) fields[k] = req.body[k];
    const record = await at.createRecord(at.TABLES.PARISHES, fields);
    res.json({ success: true, record });
  } catch (err) { next(err); }
});

router.put('/parishes/:id', requireAdmin, async (req, res, next) => {
  try {
    const allowed = ['堂區名稱', '鐸區', '縣市', '地址', '窗口', '電話', '備註'];
    const fields = {};
    for (const k of allowed) if (req.body[k] !== undefined) fields[k] = req.body[k];
    const record = await at.updateRecord(at.TABLES.PARISHES, req.params.id, fields);
    res.json({ success: true, record });
  } catch (err) { next(err); }
});

// ---------- 技能字典 ----------
router.get('/skills', async (req, res, next) => {
  try {
    const records = await listSkillsSafely();
    res.json({ records });
  } catch (err) { next(err); }
});

router.get('/skills-admin', requireAdmin, async (req, res, next) => {
  try {
    const records = await listAllSkillsSafely();
    res.json({ records });
  } catch (err) { next(err); }
});

router.post('/skills', requireAdmin, async (req, res, next) => {
  try {
    const allowed = ['專長名稱', '分類', '說明', '排序', '是否啟用'];
    const fields = {};
    for (const k of allowed) if (req.body[k] !== undefined) fields[k] = req.body[k];
    if (fields['是否啟用'] === undefined) fields['是否啟用'] = true;
    const record = await at.createRecord(at.TABLES.SKILLS, fields);
    res.json({ success: true, record });
  } catch (err) { next(err); }
});

router.put('/skills/:id', requireAdmin, async (req, res, next) => {
  try {
    const allowed = ['專長名稱', '分類', '說明', '排序', '是否啟用'];
    const fields = {};
    for (const k of allowed) if (req.body[k] !== undefined) fields[k] = req.body[k];
    const record = await at.updateRecord(at.TABLES.SKILLS, req.params.id, fields);
    res.json({ success: true, record });
  } catch (err) { next(err); }
});

// ---------- 前臺人才欄位設定 ----------
router.get('/settings/talent-fields', async (req, res, next) => {
  try {
    const settings = await getTalentSettings();
    res.json({ settings });
  } catch (err) { next(err); }
});

router.put('/settings/talent-fields', requireAdmin, async (req, res, next) => {
  try {
    const settings = await saveTalentSettings(req.body || {});
    res.json({ success: true, settings });
  } catch (err) { next(err); }
});

// ---------- People_Skills:個人專長(可由教友自己送出,審核狀態為「待審」) ----------
router.post('/people-skills', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body['人員'] || !body['專長']) {
      return res.status(400).json({ error: '人員與專長為必填' });
    }
    const allowed = ['人員', '專長', '熟練程度', '服務年資', '是否願意服務', '經驗說明', '備註'];
    const fields = {};
    for (const k of allowed) if (body[k] !== undefined) fields[k] = body[k];
    if (typeof fields['人員'] === 'string') fields['人員'] = [fields['人員']];
    if (typeof fields['專長'] === 'string') fields['專長'] = [fields['專長']];
    fields['審核狀態'] = '待審';
    const record = await at.createRecord(at.TABLES.PEOPLE_SKILLS, fields);
    res.json({ success: true, record });
  } catch (err) { next(err); }
});

router.put('/people-skills/:id/approve', requireAdmin, async (req, res, next) => {
  try {
    const { decision, reviewer } = req.body || {};
    if (!['通過', '退回'].includes(decision)) {
      return res.status(400).json({ error: 'decision 必須是 通過 或 退回' });
    }
    const record = await at.updateRecord(at.TABLES.PEOPLE_SKILLS, req.params.id, {
      '審核狀態': decision,
      '審核者': reviewer || (req.user && req.user.sub) || 'admin',
    });
    res.json({ success: true, record });
  } catch (err) { next(err); }
});

// ---------- 服務經驗 ----------
router.post('/service-experience', requireAdmin, async (req, res, next) => {
  try {
    const fieldMap = {
      人員: 'Person',
      服務類型: 'ServiceType',
      單位: 'Organization',
      活動名稱: 'ActivityName',
      角色: 'Role',
      內容: 'Content',
      評語: 'Feedback',
      是否可再次邀請: 'CanInviteAgain',
      備註: 'Notes',
    };
    const fields = {};
    for (const [source, target] of Object.entries(fieldMap)) {
      if (req.body[source] !== undefined) fields[target] = req.body[source];
    }
    const dateNotes = ['開始日期', '結束日期']
      .filter(k => req.body[k])
      .map(k => `${k}:${req.body[k]}`);
    if (dateNotes.length > 0) {
      fields.Notes = [fields.Notes, dateNotes.join(' / ')].filter(Boolean).join('\n');
    }
    if (Array.isArray(fields.Person)) fields.Person = fields.Person.join(', ');
    fields.Name = [fields.ActivityName, fields.Person].filter(Boolean).join(' - ') || '服務經驗';
    const record = await at.createRecord(at.TABLES.SERVICE_EXPERIENCE, fields);
    res.json({ success: true, record });
  } catch (err) { next(err); }
});

// ---------- 報表 ----------
router.get('/reports/distribution', requireAdmin, async (req, res, next) => {
  try {
    const result = await distributionReport();
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/reports/gaps', requireAdmin, async (req, res, next) => {
  try {
    const result = await gapReport();
    res.json(result);
  } catch (err) { next(err); }
});

async function listParishesSafely() {
  try {
    return await at.listRecords(at.TABLES.PARISHES, {
      sort: [{ field: '堂區名稱', direction: 'asc' }],
      fields: ['堂區名稱', '鐸區', '縣市'],
    });
  } catch (err) {
    console.warn('[parishes list] precise query failed, falling back:', err.message);
    const records = await at.listRecords(at.TABLES.PARISHES);
    return records.sort((a, b) => String(a['堂區名稱'] || '').localeCompare(String(b['堂區名稱'] || ''), 'zh-Hant'));
  }
}

async function listSkillsSafely() {
  try {
    return await at.listRecords(at.TABLES.SKILLS, {
      filterByFormula: `{是否啟用} = TRUE()`,
      sort: [{ field: '排序', direction: 'asc' }, { field: '專長名稱', direction: 'asc' }],
    });
  } catch (err) {
    console.warn('[skills list] precise query failed, falling back:', err.message);
    const records = await at.listRecords(at.TABLES.SKILLS);
    return records
      .filter(record => record['是否啟用'] !== false)
      .sort((a, b) => (a['排序'] || 0) - (b['排序'] || 0)
        || String(a['專長名稱'] || '').localeCompare(String(b['專長名稱'] || ''), 'zh-Hant'));
  }
}

async function listAllSkillsSafely() {
  try {
    return await at.listRecords(at.TABLES.SKILLS, {
      sort: [{ field: '排序', direction: 'asc' }, { field: '專長名稱', direction: 'asc' }],
    });
  } catch (err) {
    console.warn('[skills admin list] precise query failed, falling back:', err.message);
    const records = await at.listRecords(at.TABLES.SKILLS);
    return records.sort((a, b) => (a['排序'] || 0) - (b['排序'] || 0)
      || String(a['專長名稱'] || '').localeCompare(String(b['專長名稱'] || ''), 'zh-Hant'));
  }
}

module.exports = router;
