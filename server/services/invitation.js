/**
 * 智慧功能
 *  - generateInvitations: 根據 Matching 紀錄產生 LINE / Email 邀請文
 *  - normalizeSkillsAndPersist: 把使用者自由填寫的專長,
 *      用 Claude API(若有設定)或關鍵字比對 對應到 Skills 標準字典,
 *      並寫入 People_Skills(待審)
 */
const at = require('../airtable');

let anthropic = null;
if (process.env.ANTHROPIC_API_KEY) {
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  } catch (e) {
    console.warn('[anthropic sdk] not installed or failed to load:', e.message);
  }
}

// ---------------- 邀請文案 ----------------

async function generateInvitations(matchingId, channel = 'line') {
  const match = await at.getRecord(at.TABLES.MATCHING, matchingId);
  const needId = Array.isArray(match['需求單']) ? match['需求單'][0] : match['需求單'];
  const personId = Array.isArray(match['候選人']) ? match['候選人'][0] : match['候選人'];

  if (!needId || !personId) {
    throw Object.assign(new Error('媒合紀錄缺少需求單或候選人'), { status: 400, expose: true });
  }

  const [need, person] = await Promise.all([
    at.getRecord(at.TABLES.MINISTRY_NEEDS, needId),
    at.getRecord(at.TABLES.PEOPLE, personId),
  ]);

  // 取得「符合專長」名稱
  let matchedSkillNames = [];
  if (Array.isArray(match['符合專長']) && match['符合專長'].length > 0) {
    const skills = await Promise.all(
      match['符合專長'].map(id => at.getRecord(at.TABLES.SKILLS, id).catch(() => null))
    );
    matchedSkillNames = skills.filter(Boolean).map(s => s['專長名稱']);
  }

  const ctx = {
    name: person['姓名'],
    parish: Array.isArray(person['所屬堂區']) ? person['所屬堂區'][0] : '',
    activity: need['活動名稱'],
    date: need['活動日期'],
    location: need['地點'],
    skills: matchedSkillNames,
    contactPerson: need['申請人'],
    contactInfo: need['聯絡方式'],
    reason: match['推薦原因'] || '',
  };

  if (anthropic) {
    try {
      const text = await generateWithClaude(ctx, channel);
      return { channel, text, person: { 姓名: person['姓名'], Email: person['Email'], 手機: person['手機'] } };
    } catch (e) {
      console.warn('[claude invitation] fallback:', e.message);
    }
  }

  return {
    channel,
    text: generateWithTemplate(ctx, channel),
    person: { 姓名: person['姓名'], Email: person['Email'], 手機: person['手機'] },
  };
}

function generateWithTemplate(ctx, channel) {
  const skillStr = ctx.skills.length > 0 ? `「${ctx.skills.join('、')}」` : '相關';

  if (channel === 'email') {
    return [
      `主旨:【愛德服務邀請】${ctx.activity} 邀請您共襄盛舉`,
      ``,
      `${ctx.name} 弟兄/姊妹平安:`,
      ``,
      `感謝您願意在主內用恩賜服務教會。我們將舉辦「${ctx.activity}」,`,
      `因您具備${skillStr}專長,誠摯邀請您參與服務。`,
      ``,
      `▍活動日期:${ctx.date}`,
      `▍活動地點:${ctx.location}`,
      ctx.reason ? `▍邀請原因:${ctx.reason}` : '',
      ``,
      `如您方便參與,請回覆此信或聯絡:`,
      `${ctx.contactPerson}(${ctx.contactInfo})`,
      ``,
      `願主保佑您`,
      `天主教會愛德人才服務平台 敬上`,
    ].filter(Boolean).join('\n');
  }

  // LINE 預設較短
  return [
    `${ctx.name} 平安🙏`,
    ``,
    `教會即將舉辦「${ctx.activity}」,因您具備${skillStr}專長,誠摯邀請您參與服務。`,
    ``,
    `📅 ${ctx.date}`,
    `📍 ${ctx.location}`,
    ``,
    `如可參加,請回覆訊息;若不便也歡迎告知。`,
    `感謝您在主內的奉獻 ❤️`,
    ``,
    `聯絡人:${ctx.contactPerson} ${ctx.contactInfo}`,
  ].join('\n');
}

async function generateWithClaude(ctx, channel) {
  const sys = `你是天主教會的愛德服務協調員,用溫暖、誠懇、不誇張的語氣寫邀請訊息。`
            + `保持簡短(LINE 約 100-150 字、Email 約 200-300 字),`
            + `語氣符合天主教信仰文化(可用「平安」「在主內」「願主保佑」等),不過度使用表情符號。`;

  const channelDesc = channel === 'email'
    ? '請寫成完整的 Email 邀請文(含主旨)'
    : '請寫成 LINE 訊息(可用 1-3 個適度表情符號)';

  const prompt = `${channelDesc}。

【收件人】${ctx.name}
【活動名稱】${ctx.activity}
【活動日期】${ctx.date}
【活動地點】${ctx.location}
【期望服務的專長】${ctx.skills.join('、') || '相關專長'}
【推薦原因(內部備註)】${ctx.reason || '無'}
【聯絡人】${ctx.contactPerson} (${ctx.contactInfo})

請直接輸出訊息內容,不要加任何說明或標題以外的前後文。`;

  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 600,
    system: sys,
    messages: [{ role: 'user', content: prompt }],
  });

  return resp.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();
}

// ---------------- 專長標準化 ----------------

async function normalizeSkillsAndPersist(personId, freeSkills = []) {
  if (!Array.isArray(freeSkills) || freeSkills.length === 0) return [];

  // 取得標準技能字典
  const standardSkills = await at.listRecords(at.TABLES.SKILLS, {
    filterByFormula: `{是否啟用} = TRUE()`,
  });

  const matched = anthropic
    ? await normalizeWithClaude(freeSkills, standardSkills)
    : normalizeWithKeywords(freeSkills, standardSkills);

  // 寫入 People_Skills (審核狀態 = 待審)
  const rows = matched
    .filter(m => m.skillId)
    .map(m => ({
      '人員': [personId],
      '專長': [m.skillId],
      '經驗說明': m.original,
      '是否願意服務': true,
      '審核狀態': '待審',
    }));

  if (rows.length === 0) return [];

  const created = await at.createRecords(at.TABLES.PEOPLE_SKILLS, rows);
  return matched;
}

function normalizeWithKeywords(freeSkills, standardSkills) {
  return freeSkills.map(text => {
    const lower = String(text).toLowerCase();
    let best = null;
    for (const sk of standardSkills) {
      const name = String(sk['專長名稱'] || '').toLowerCase();
      const desc = String(sk['說明'] || '').toLowerCase();
      if (lower.includes(name) || name.includes(lower) || desc.includes(lower)) {
        best = sk;
        break;
      }
    }
    return { original: text, skillId: best ? best.id : null, skillName: best ? best['專長名稱'] : null };
  });
}

async function normalizeWithClaude(freeSkills, standardSkills) {
  const dict = standardSkills
    .map(s => `${s.id}|${s['專長名稱']}|${s['分類'] || ''}|${s['說明'] || ''}`)
    .join('\n');

  const prompt = `以下是教會服務技能字典(格式:id|名稱|分類|說明):
${dict}

請把使用者填寫的下列描述對應到字典中最接近的技能。
若實在找不到合適的,id 用 null。
只輸出 JSON 陣列,格式 [{"original":"...","skillId":"...","skillName":"..."}]。

使用者描述:
${freeSkills.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;

  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1200,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return normalizeWithKeywords(freeSkills, standardSkills);

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return normalizeWithKeywords(freeSkills, standardSkills);
  }
}

module.exports = {
  generateInvitations,
  normalizeSkillsAndPersist,
};
