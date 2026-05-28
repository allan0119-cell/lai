/**
 * JWT 認證 middleware
 * - requireAdmin: 管理者才能存取
 * - optionalAuth: 可帶或不帶 token,把使用者資訊放到 req.user
 * - signSelfUpdateToken / verifySelfUpdateToken: 教友自助更新連結用
 */
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const SELF_UPDATE_SECRET = process.env.SELF_UPDATE_SECRET || JWT_SECRET + '-self';

function signAdminToken(payload) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '12h',
  });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function getTokenFromHeader(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice(7);
}

function requireAdmin(req, res, next) {
  const token = getTokenFromHeader(req);
  if (!token) return res.status(401).json({ error: '需要登入' });
  try {
    const payload = verifyToken(token);
    if (payload.role !== 'admin') {
      return res.status(403).json({ error: '權限不足' });
    }
    req.user = payload;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Token 無效或過期' });
  }
}

function optionalAuth(req, res, next) {
  const token = getTokenFromHeader(req);
  if (token) {
    try {
      req.user = verifyToken(token);
    } catch (e) {
      // 忽略,當作未登入
    }
  }
  next();
}

/**
 * 產生「教友自我更新」一次性連結的 token
 * 格式:HMAC( personId + email ) - 不會過期但綁定該人 email
 * 寄給對方 → /update?id=xxx&t=yyy
 */
function signSelfUpdateToken(personId, email) {
  return crypto
    .createHmac('sha256', SELF_UPDATE_SECRET)
    .update(`${personId}|${(email || '').toLowerCase().trim()}`)
    .digest('hex');
}

function verifySelfUpdateToken(personId, email, token) {
  const expected = signSelfUpdateToken(personId, email);
  // 防止時序攻擊
  if (token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

module.exports = {
  signAdminToken,
  verifyToken,
  requireAdmin,
  optionalAuth,
  signSelfUpdateToken,
  verifySelfUpdateToken,
};
