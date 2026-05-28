/**
 * 報表
 *  - distributionReport: 人才分布(依堂區、依專長分類、依地區、依年齡層)
 *  - gapReport:        近期需求 vs 可用人才 → 缺口分析
 */
const at = require('../airtable');

async function distributionReport() {
  const [people, skills, peopleSkills, parishes] = await Promise.all([
    at.listRecords(at.TABLES.PEOPLE, {
      filterByFormula: `{狀態} = '已啟用'`,
    }),
    at.listRecords(at.TABLES.SKILLS),
    at.listRecords(at.TABLES.PEOPLE_SKILLS, {
      filterByFormula: `{審核狀態} = '通過'`,
    }),
    at.listRecords(at.TABLES.PARISHES),
  ]);

  // --- 依堂區 ---
  const parishMap = Object.fromEntries(parishes.map(p => [p.id, p['堂區名稱']]));
  const byParish = {};
  for (const p of people) {
    const ids = p['所屬堂區'] || [];
    const names = ids.map(id => parishMap[id] || '(未知)');
    const key = names[0] || '(未填)';
    byParish[key] = (byParish[key] || 0) + 1;
  }

  // --- 依專長分類 ---
  const skillMap = Object.fromEntries(skills.map(s => [s.id, s]));
  const byCategory = {};
  for (const ps of peopleSkills) {
    const skillId = (ps['專長'] || [])[0];
    if (!skillId) continue;
    const sk = skillMap[skillId];
    if (!sk) continue;
    const cat = sk['分類'] || '其他';
    byCategory[cat] = (byCategory[cat] || 0) + 1;
  }

  // --- 依地區 ---
  const byRegion = {};
  for (const p of people) {
    const region = p['居住地區'] || '(未填)';
    byRegion[region] = (byRegion[region] || 0) + 1;
  }

  // --- 依年齡層 ---
  const currentYear = new Date().getFullYear();
  const byAge = { '青年(18-35)': 0, '中年(36-55)': 0, '中高年(56-65)': 0, '長者(66+)': 0, '(未填)': 0 };
  for (const p of people) {
    const y = parseInt(p['出生年份'], 10);
    if (!y) { byAge['(未填)']++; continue; }
    const age = currentYear - y;
    if (age <= 35) byAge['青年(18-35)']++;
    else if (age <= 55) byAge['中年(36-55)']++;
    else if (age <= 65) byAge['中高年(56-65)']++;
    else byAge['長者(66+)']++;
  }

  // --- 願意接受邀請 ---
  const willing = people.filter(p => p['是否願意接受邀請'] === true).length;

  return {
    summary: {
      total: people.length,
      willing,
      willingRate: people.length > 0 ? (willing / people.length * 100).toFixed(1) + '%' : '0%',
      skillRecords: peopleSkills.length,
    },
    byParish,
    byCategory,
    byRegion,
    byAge,
  };
}

async function gapReport() {
  const today = new Date().toISOString().slice(0, 10);

  // 取「未完成且活動日期在未來」的需求
  const needs = await at.listRecords(at.TABLES.MINISTRY_NEEDS, {
    filterByFormula: `AND(NOT({狀態} = '完成'), NOT({狀態} = '取消'), IS_AFTER({活動日期}, '${today}'))`,
    sort: [{ field: '活動日期', direction: 'asc' }],
  });

  const skills = await at.listRecords(at.TABLES.SKILLS);
  const skillMap = Object.fromEntries(skills.map(s => [s.id, s['專長名稱']]));

  // 已通過的個人專長
  const peopleSkills = await at.listRecords(at.TABLES.PEOPLE_SKILLS, {
    filterByFormula: `AND({審核狀態} = '通過', {是否願意服務} = TRUE())`,
  });

  // 計算每項技能的「可用人才數」
  const skillAvailability = {};
  for (const ps of peopleSkills) {
    const skId = (ps['專長'] || [])[0];
    if (!skId) continue;
    skillAvailability[skId] = (skillAvailability[skId] || 0) + 1;
  }

  // 計算每個需求的缺口
  const gaps = needs.map(need => {
    const requiredSkills = (need['所需專長'] || []).map(skId => ({
      id: skId,
      name: skillMap[skId] || '(未知)',
      available: skillAvailability[skId] || 0,
    }));
    const minAvail = requiredSkills.length > 0
      ? Math.min(...requiredSkills.map(s => s.available))
      : 0;

    return {
      needId: need.id,
      activity: need['活動名稱'],
      date: need['活動日期'],
      urgency: need['急迫程度'],
      required: need['所需人數'] || 0,
      requiredSkills,
      bottleneckAvailable: minAvail,
      gap: Math.max(0, (need['所需人數'] || 0) - minAvail),
    };
  });

  // 把「缺口最大的技能」算出來,給管理者建議要徵募
  const skillShortage = {};
  for (const g of gaps) {
    for (const sk of g.requiredSkills) {
      if (sk.available < (g.required || 0)) {
        skillShortage[sk.name] = Math.max(
          skillShortage[sk.name] || 0,
          (g.required || 0) - sk.available
        );
      }
    }
  }

  return {
    upcomingNeeds: gaps,
    skillShortage,
    suggestion: Object.keys(skillShortage).length > 0
      ? `建議優先在堂區公告徵募:${Object.keys(skillShortage).slice(0, 5).join('、')}`
      : '近期需求皆有足夠人才支援',
  };
}

module.exports = { distributionReport, gapReport };
