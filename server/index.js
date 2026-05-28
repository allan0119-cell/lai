/**
 * 天主教會愛德人才服務平台 - 後端主程式
 */
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

const peopleRouter = require('./routes/people');
const needsRouter = require('./routes/needs');
const adminRouter = require('./routes/admin');

const app = express();

// --- 安全 middleware ---
app.use(helmet({
  contentSecurityPolicy: false, // 為了讓內嵌 script 可運作。正式環境請收斂 CSP
}));
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/healthz', (req, res) => {
  res.json({ ok: true });
});

// --- Rate Limit (對公開 POST 端點限速,防灌爆) ---
const publicWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '請求過於頻繁,請稍候再試' },
});
app.use('/api/people', (req, res, next) => {
  if (req.method === 'POST') return publicWriteLimiter(req, res, next);
  next();
});
app.use('/api/needs', (req, res, next) => {
  if (req.method === 'POST') return publicWriteLimiter(req, res, next);
  next();
});

// --- 靜態檔 (前端) ---
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- API 路由 ---
app.use('/api', adminRouter);          // /api/auth/login、/api/parishes、/api/skills、/api/reports
app.use('/api/people', peopleRouter);  // /api/people、/api/people-skills、/api/service-experience
app.use('/api/needs', needsRouter);    // /api/needs、/api/matching、/api/communication-log
app.use('/api', needsRouter);          // 也接收 /api/matching、/api/communication-log

// --- 錯誤處理 ---
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  const detail = describeError(err);
  res.status(err.status || 500).json({
    error: err.expose ? err.message : detail || '伺服器錯誤,請稍後再試',
  });
});

function describeError(err) {
  if (!err) return '';
  const message = [err.statusCode || err.status, err.error, err.message].filter(Boolean).join(' ');
  if (/airtable|invalid|unknown field|field|not_found|authentication|required/i.test(message)) {
    return message;
  }
  return '';
}

// --- 404 ---
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: 'API 路徑不存在' });
  } else {
    res.status(404).sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✓ Catholic Talent Platform running on http://localhost:${PORT}`);
  if (!process.env.AIRTABLE_PAT && !process.env.AIRTABLE_API_KEY) {
    console.warn('⚠️  AIRTABLE_PAT/AIRTABLE_API_KEY not set - API calls will fail');
  }
});
