/**
 * 智慧推薦
 * 根據需求單(Ministry_Needs)自動推薦最適合的人選。
 *
 * 評分維度(每項 0-100,加權平均):
 *   1. 專長吻合度        (40%) - People_Skills 與所需專長的交集
 *   2. 地區可服務        (20%) - 可服務區域 包含 需求地點 縣市
 *   3. 時段配合          (15%) - 可服務時段 vs 需求服務時段
 *   4. 願意接受邀請      (15%) - 是否勾選願意
 *   5. 過往評價/經驗     (10%) - Service_Experience 中是否「可再次邀請」
 */
const at = require('../airtable');

async function recommendForNeed(needId, { limit = 20 } = {}) {
  const need = await at.getRecord(at.TABLES.MINISTRY_NEEDS, needId);

  // 需求所需的專長 (linked record ids)
  const requiredSkillIds = (need['所需專長'] || []).map(String);
  const needLocation = need['地點'] || '';
  const needTimes = need['服務時段'] || []; // 多選

  // 取得人才庫
  const peopleFormula = at.buildFilterFormula({
    '是否願意接受邀請': true,
    '狀態': '已啟用',
  });
  const people = await at.listRecords(at.TABLES.PEOPLE, {
    filterByFormula: peopleFormula,
  });

  // 取得所有 People_Skills (一次撈,後面在記憶體做 join)
  const allPeopleSkills = await at.listRecords(at.TABLES.PEOPLE_SKILLS, {
    filterByFormula: `AND({審核狀態} = '通過', {是否願意服務} = TRUE())`,
  });

  // 服務經驗(用於評估再邀請意願)
  const allExperiences = await at.listRecords(at.TABLES.SERVICE_EXPERIENCE);

  const candidates = people.map(person => {
    const personId = person.id;
    const skillsOfPerson = allPeopleSkills.filter(s =>
      (s['人員'] || []).map(String).includes(personId)
    );
    const matchedSkillRecords = skillsOfPerson.filter(s =>
      (s['專長'] || []).some(skId => requiredSkillIds.includes(String(skId)))
    );
    const matchedSkillIds = [...new Set(
      matchedSkillRecords.flatMap(s => (s['專長'] || []).map(String))
    )].filter(id => requiredSkillIds.includes(id));

    // --- 1. 專長吻合度 ---
    let skillScore = 0;
    if (requiredSkillIds.length > 0) {
      skillScore = (matchedSkillIds.length / requiredSkillIds.length) * 100;
      // 加權:有「可帶領」級的人額外加 10 分(上限 100)
      if (matchedSkillRecords.some(s => s['熟練程度'] === '可帶領')) {
        skillScore = Math.min(100, skillScore + 10);
      }
    }

    // --- 2. 地區 ---
    const areas = person['可服務區域'] || [];
    const areaScore = needLocation && areas.length > 0
      ? (areas.some(a => needLocation.includes(a) || a.includes(needLocation)) ? 100 : 30)
      : 60;

    // --- 3. 時段 ---
    const personTimes = person['可服務時段'] || [];
    let timeScore = 60;
    if (needTimes.length > 0 && personTimes.length > 0) {
      const overlap = needTimes.filter(t => personTimes.includes(t)).length;
      timeScore = (overlap / needTimes.length) * 100;
    }

    // --- 4. 願意邀請(已經在 filter 過,給 100;否則 0)---
    const willingScore = 100;

    // --- 5. 過往評價 ---
    const personExp = allExperiences.filter(e =>
      (e['人員'] || []).map(String).includes(personId)
    );
    let expScore = 50; // 沒紀錄就中性
    if (personExp.length > 0) {
      const reinviteCount = personExp.filter(e => e['是否可再次邀請'] === true).length;
      expScore = (reinviteCount / personExp.length) * 100;
    }

    const totalScore = (
      skillScore * 0.40 +
      areaScore  * 0.20 +
      timeScore  * 0.15 +
      willingScore * 0.15 +
      expScore   * 0.10
    );

    return {
      personId,
      person: {
        姓名: person['姓名'],
        所屬堂區: person['所屬堂區'],
        居住地區: person['居住地區'],
        手機: person['手機'],
        Email: person['Email'],
      },
      score: Math.round(totalScore),
      breakdown: {
        專長: Math.round(skillScore),
        地區: Math.round(areaScore),
        時段: Math.round(timeScore),
        意願: Math.round(willingScore),
        經驗: Math.round(expScore),
      },
      matchedSkillIds,
      matchedSkillRecordIds: matchedSkillRecords.map(s => s.id),
      reason: buildReason({
        matchedCount: matchedSkillIds.length,
        requiredCount: requiredSkillIds.length,
        areaScore, timeScore, expScore,
      }),
    };
  });

  candidates.sort((a, b) => b.score - a.score);
  return {
    need: {
      id: need.id,
      活動名稱: need['活動名稱'],
      地點: need['地點'],
      所需專長: requiredSkillIds,
    },
    candidates: candidates.slice(0, limit),
  };
}

function buildReason({ matchedCount, requiredCount, areaScore, timeScore, expScore }) {
  const parts = [];
  if (requiredCount > 0) {
    parts.push(`符合 ${matchedCount}/${requiredCount} 項所需專長`);
  }
  if (areaScore >= 100) parts.push('地區完全配合');
  else if (areaScore >= 60) parts.push('地區可調整');
  if (timeScore >= 70) parts.push('時段可配合');
  if (expScore >= 70) parts.push('過往服務口碑佳');
  return parts.join(',') || '基本條件符合';
}

module.exports = { recommendForNeed };
