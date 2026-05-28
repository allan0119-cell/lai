/**
 * 教友資料 API
 *   POST  /                  教友登錄(公開)
 *   POST  /self-update       教友以 self-update token 更新自己(公開但需 token)
 *   GET   /                  條件查詢(管理)
 *   GET   /:id               單筆(管理)
 *   PUT   /:id               更新(管理)
 *   POST  /people-skills     新增/更新個人專長
 *   POST  /service-experience 新增服務經驗
 *
 * 註:這個 router 直接掛在 /api/people,所以 path 都是相對的。
 *    為了把 /api/people-skills 也納入,主程式也會把它掛在 /api 下處理(看 index.js)。
 */
const express = require('express');
const router = express.Router();

const at = require('../airtable');
const { requireAdmin, signSelfUpdateToken, verifySelfUpdateToken } = require('../middleware/auth');
const { normalizeSkillsAndPersist } = require('../services/invitation');

// ---------- 公開:教友登錄 ----------
router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};

    // --- 個資同意聲明 ---
    if (!body.consent) {
      return res.status(400).json({ error: '請先同意個資使用聲明' });
    }

    // --- 必填驗證 ---
    if (!body['姓名'] || !body['手機']) {
      return res.status(400).json({ error: '姓名與手機為必填' });
    }

    await resolveParishLink(body);

    // 不允許前端決定狀態,新增一律「待審核」
    const fields = sanitizePersonFields(body);
    fields['狀態'] = '待審核';
    fields['建立日期'] = new Date().toISOString();
    fields['更新日期'] = new Date().toISOString();

    const record = await createPersonRecord(fields, body);

    // --- 順手把自由填寫的專長標準化、寫入 People_Skills ---
    if (Array.isArray(body.freeSkills) && body.freeSkills.length > 0) {
      try {
        await normalizeSkillsAndPersist(record.id, body.freeSkills);
      } catch (e) {
        console.warn('[skill normalize] failed:', e.message);
        // 不阻擋登錄成功
      }
    }

    res.json({
      success: true,
      id: record.id,
      message: '已收到您的資料,我們會儘快審核。',
    });
  } catch (err) {
    next(err);
  }
});

// ---------- 教友自助更新 (需要一次性 token) ----------
router.post('/self-update', async (req, res, next) => {
  try {
    const { id, t, fields = {} } = req.body || {};
    if (!id || !t) return res.status(400).json({ error: '連結無效' });

    const existing = await at.getRecord(at.TABLES.PEOPLE, id);
    if (!verifySelfUpdateToken(id, existing['Email'] || '', t)) {
      return res.status(403).json({ error: '連結無效或已過期' });
    }

    // 教友只能改部分欄位
    const allowed = ['手機', 'Email', '居住地區', '可服務區域', '可服務時段',
                     '是否願意接受邀請', '信仰背景簡述', '備註'];
    const update = {};
    for (const k of allowed) {
      if (fields[k] !== undefined) update[k] = fields[k];
    }
    update['更新日期'] = new Date().toISOString();

    const record = await at.updateRecord(at.TABLES.PEOPLE, id, update);
    res.json({ success: true, id: record.id });
  } catch (err) {
    next(err);
  }
});

// ---------- 管理:條件查詢 ----------
router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const {
      parish,        // 所屬堂區 (Parish record id)
      area,          // 可服務區域 (字串,陣列用 , 分隔)
      time,          // 可服務時段 (字串,陣列用 , 分隔)
      willing,       // 是否願意接受邀請 'true'/'false'
      status,        // 狀態
      keyword,       // 姓名/Email 模糊搜尋
    } = req.query;

    const filters = {};
    if (parish) filters['所屬堂區'] = parish;
    if (area) filters['可服務區域'] = String(area).split(',').filter(Boolean);
    if (time) filters['可服務時段'] = String(time).split(',').filter(Boolean);
    if (willing === 'true') filters['是否願意接受邀請'] = true;
    if (willing === 'false') filters['是否願意接受邀請'] = false;
    if (status) filters['狀態'] = status;

    let formula = at.buildFilterFormula(filters);
    if (keyword) {
      const kw = String(keyword).replace(/'/g, "\\'");
      const kwClause = `OR(SEARCH('${kw}', {姓名} & ''), SEARCH('${kw}', {Email} & ''))`;
      formula = formula ? `AND(${formula}, ${kwClause})` : kwClause;
    }

    const records = await at.listRecords(at.TABLES.PEOPLE, {
      filterByFormula: formula,
      sort: [{ field: '更新日期', direction: 'desc' }],
    });

    res.json({ count: records.length, records });
  } catch (err) {
    next(err);
  }
});

// ---------- 管理:單筆 ----------
router.get('/:id', requireAdmin, async (req, res, next) => {
  try {
    const person = await at.getRecord(at.TABLES.PEOPLE, req.params.id);

    // 一併附上專長與服務經驗
    const [skills, allExperience] = await Promise.all([
      at.listRecords(at.TABLES.PEOPLE_SKILLS, {
        filterByFormula: `FIND('${req.params.id}', ARRAYJOIN({人員} & '', ',')) > 0`,
      }),
      at.listRecords(at.TABLES.SERVICE_EXPERIENCE),
    ]);

    const experience = allExperience
      .filter(item => {
        const personValue = item['Person'] || item['人員'];
        if (Array.isArray(personValue)) return personValue.map(String).includes(req.params.id);
        return String(personValue || '') === req.params.id || String(personValue || '') === String(person['姓名'] || '');
      })
      .sort((a, b) => String(b['活動日期'] || b['開始日期'] || '').localeCompare(String(a['活動日期'] || a['開始日期'] || '')));

    res.json({ person, skills, experience });
  } catch (err) {
    next(err);
  }
});

// ---------- 管理:更新 ----------
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const fields = sanitizePersonFields(req.body || {});
    fields['更新日期'] = new Date().toISOString();
    const record = await at.updateRecord(at.TABLES.PEOPLE, req.params.id, fields);
    res.json({ success: true, record });
  } catch (err) {
    next(err);
  }
});

// ---------- 管理:產生自助更新連結 ----------
router.get('/:id/self-update-link', requireAdmin, async (req, res, next) => {
  try {
    const person = await at.getRecord(at.TABLES.PEOPLE, req.params.id);
    const token = signSelfUpdateToken(req.params.id, person['Email'] || '');
    const url = `${req.protocol}://${req.get('host')}/update.html?id=${req.params.id}&t=${token}`;
    res.json({ url });
  } catch (err) {
    next(err);
  }
});

// --- helper ---
async function createPersonRecord(fields, body) {
  const attempts = [
    { name: 'full', fields },
    { name: 'safe-note', fields: buildSafePersonFields(fields, body, true) },
    { name: 'safe', fields: buildSafePersonFields(fields, body, false) },
    { name: 'minimal', fields: pickFields(fields, ['姓名', '手機']) },
  ];
  let lastErr;

  for (const attempt of attempts) {
    if (!attempt.fields['姓名'] || !attempt.fields['手機']) continue;
    try {
      return await at.createRecord(at.TABLES.PEOPLE, attempt.fields);
    } catch (err) {
      lastErr = err;
      console.warn(`[people create:${attempt.name}] failed:`, describeAirtableError(err));
    }
  }

  const err = new Error(`人才資料寫入失敗:${describeAirtableError(lastErr)}`);
  err.status = 500;
  err.expose = true;
  throw err;
}

function buildSafePersonFields(fields, body, includeNote) {
  const safe = pickFields(fields, ['姓名', '手機', 'Email']);
  if (includeNote) {
    const notes = [
      fields['備註'],
      fields['所屬教區'] ? `所屬教區:${fields['所屬教區']}` : '',
      body['所屬堂區文字'] ? `所屬堂區:${body['所屬堂區文字']}` : '',
      fields['所屬善會文字'] ? `所屬善會:${fields['所屬善會文字']}` : '',
      Array.isArray(fields['所屬善會']) && fields['所屬善會'].length ? `所屬善會:${fields['所屬善會'].join('、')}` : '',
      fields['居住地區'] ? `居住地區:${fields['居住地區']}` : '',
      Array.isArray(fields['可服務區域']) && fields['可服務區域'].length ? `可服務區域:${fields['可服務區域'].join('、')}` : '',
      Array.isArray(fields['可服務時段']) && fields['可服務時段'].length ? `可服務時段:${fields['可服務時段'].join('、')}` : '',
      fields['信仰背景簡述'] ? `信仰背景簡述:${fields['信仰背景簡述']}` : '',
    ].filter(Boolean);
    if (notes.length) safe['備註'] = notes.join('\n');
  }
  return safe;
}

function pickFields(fields, names) {
  const out = {};
  for (const name of names) {
    if (fields[name] !== undefined && fields[name] !== null && fields[name] !== '') {
      out[name] = fields[name];
    }
  }
  return out;
}

function describeAirtableError(err) {
  if (!err) return '未知錯誤';
  const parts = [
    err.statusCode || err.status,
    err.error,
    err.message,
  ].filter(Boolean);
  return parts.join(' ') || String(err);
}

async function resolveParishLink(body) {
  const value = Array.isArray(body['所屬堂區']) ? body['所屬堂區'][0] : body['所屬堂區'];
  if (!value || String(value).startsWith('rec')) return;

  const parishName = String(value).trim();
  if (!parishName) return;
  body['所屬堂區文字'] = parishName;

  try {
    const parish = await findOrCreateParish(parishName);
    if (parish && parish.id) {
      body['所屬堂區'] = [parish.id];
      return;
    }
  } catch (err) {
    console.warn('[parish resolve] failed:', err.message);
  }

  // 堂區連結失敗時,不要阻止人才登錄;保留文字供管理者後續整理。
  const parishNote = body['所屬教區']
    ? `所屬教區/堂區:${body['所屬教區']} / ${parishName}`
    : `所屬堂區:${parishName}`;
  body['備註'] = body['備註'] ? `${body['備註']}\n${parishNote}` : parishNote;
  delete body['所屬堂區'];
}

async function findOrCreateParish(parishName) {
  const formula = at.buildFilterFormula({ '堂區名稱': parishName });
  const existing = await at.listRecords(at.TABLES.PARISHES, {
    filterByFormula: formula,
    maxRecords: 1,
  });
  if (existing[0]) return existing[0];

  return at.createRecord(at.TABLES.PARISHES, {
    '堂區名稱': parishName,
  });
}

function sanitizePersonFields(body) {
  const allowed = [
    '姓名', '英文名', '性別', '出生年份', '手機', 'Email',
    '所屬教區', '所屬堂區', '所屬善會文字', '所屬善會', '居住地區', '可服務區域',
    '可服務時段', '是否願意接受邀請', '信仰背景簡述', '備註',
  ];
  const out = {};
  for (const k of allowed) {
    if (body[k] !== undefined) out[k] = body[k];
  }
  // 「所屬堂區」如果有傳是 record id 字串,要轉成陣列(Linked field)
  if (typeof out['所屬堂區'] === 'string') out['所屬堂區'] = [out['所屬堂區']];
  return out;
}

module.exports = router;
