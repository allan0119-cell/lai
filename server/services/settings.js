const at = require('../airtable');

const TALENT_SETTINGS_KEY = 'talent_fields';
const DEFAULT_TALENT_SETTINGS = {
  ministryExamples: ['聖詠團', '聖母軍', '基督活力運動', '禮儀組', '讀經班', '青年會'],
  serviceRegions: ['北部', '中部', '南部', '東部', '全區',
    '台北市', '新北市', '基隆市', '桃園市', '新竹市', '新竹縣', '苗栗縣',
    '台中市', '彰化縣', '南投縣', '雲林縣', '嘉義市', '嘉義縣', '台南市',
    '高雄市', '屏東縣', '宜蘭縣', '花蓮縣', '台東縣', '澎湖縣', '金門縣', '連江縣'],
  timeSlots: ['平日上午', '平日下午', '平日晚上', '週六', '主日'],
  defaultPersonStatus: '待審核',
  approvedPersonStatus: '已啟用',
  returnedPersonStatus: '暫停',
};

async function getTalentSettings() {
  const record = await getSettingRecord(TALENT_SETTINGS_KEY).catch(err => {
    console.warn('[settings] read failed, using defaults:', err.message);
    return null;
  });
  if (!record || !record.Value) return { ...DEFAULT_TALENT_SETTINGS };
  try {
    return normalizeTalentSettings(JSON.parse(record.Value));
  } catch (err) {
    console.warn('[settings] invalid JSON, using defaults:', err.message);
    return { ...DEFAULT_TALENT_SETTINGS };
  }
}

async function saveTalentSettings(input) {
  const settings = normalizeTalentSettings(input);
  await saveSetting(TALENT_SETTINGS_KEY, settings, '前臺人才登錄欄位設定');
  return settings;
}

async function getSettingRecord(name) {
  const records = await at.listRecords(at.TABLES.APP_SETTINGS, {
    filterByFormula: at.buildFilterFormula({ Name: name }),
    maxRecords: 1,
  });
  return records[0] || null;
}

async function saveSetting(name, value, description) {
  const fields = {
    Name: name,
    Value: JSON.stringify(value),
    Description: description,
  };
  const existing = await getSettingRecord(name);
  if (existing && existing.id) return at.updateRecord(at.TABLES.APP_SETTINGS, existing.id, fields);
  return at.createRecord(at.TABLES.APP_SETTINGS, fields);
}

function normalizeTalentSettings(input = {}) {
  return {
    ministryExamples: normalizeStringList(input.ministryExamples, DEFAULT_TALENT_SETTINGS.ministryExamples),
    serviceRegions: normalizeStringList(input.serviceRegions, DEFAULT_TALENT_SETTINGS.serviceRegions),
    timeSlots: normalizeStringList(input.timeSlots, DEFAULT_TALENT_SETTINGS.timeSlots),
    defaultPersonStatus: normalizeString(input.defaultPersonStatus, DEFAULT_TALENT_SETTINGS.defaultPersonStatus),
    approvedPersonStatus: normalizeString(input.approvedPersonStatus, DEFAULT_TALENT_SETTINGS.approvedPersonStatus),
    returnedPersonStatus: normalizeString(input.returnedPersonStatus, DEFAULT_TALENT_SETTINGS.returnedPersonStatus),
  };
}

function normalizeStringList(value, fallback) {
  const list = Array.isArray(value)
    ? value
    : String(value || '').split(/[\n,，、]/);
  const normalized = [...new Set(list.map(item => String(item || '').trim()).filter(Boolean))];
  return normalized.length ? normalized : [...fallback];
}

function normalizeString(value, fallback) {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

module.exports = {
  DEFAULT_TALENT_SETTINGS,
  getTalentSettings,
  saveTalentSettings,
};
