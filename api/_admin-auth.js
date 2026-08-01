// api/_admin-auth.js
// تابع کمکی مشترک برای مسیرهای ادمین: توکن رو اعتبارسنجی می‌کنه و
// یه کلاینت Supabase با service_role (که RLS رو دور می‌زنه) می‌سازه.
// این فایل مستقیماً به‌عنوان API صدا زده نمی‌شه، فقط توسط بقیه توابع import می‌شه.

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

function verifyAdminToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const [phone, expiry, sig] = decoded.split(':');
    if (!phone || !expiry || !sig) return false;
    if (Date.now() > Number(expiry)) return false; // توکن منقضی شده

    const expectedSig = crypto
      .createHmac('sha256', process.env.ADMIN_SECRET)
      .update(`${phone}:${expiry}`)
      .digest('hex');

    // مقایسه امن در برابر timing attack
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length) return false;
    if (!crypto.timingSafeEqual(a, b)) return false;

    return phone === process.env.ADMIN_PHONE;
  } catch (err) {
    return false;
  }
}

function requireAdmin(req, res) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || !verifyAdminToken(token)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return null;
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

module.exports = { requireAdmin };
