// netlify/functions/lib/admin-auth.js
// تابع کمکی مشترک برای توابع ادمین: توکن رو اعتبارسنجی می‌کنه و
// یه کلاینت Supabase با service_role (که RLS رو دور می‌زنه) می‌سازه.

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

function verifyAdminToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const [phone, expiry, sig] = decoded.split(':');
    if (!phone || !expiry || !sig) return false;
    if (Date.now() > Number(expiry)) return false;

    const expectedSig = crypto
      .createHmac('sha256', process.env.ADMIN_SECRET)
      .update(`${phone}:${expiry}`)
      .digest('hex');

    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length) return false;
    if (!crypto.timingSafeEqual(a, b)) return false;

    return phone === process.env.ADMIN_PHONE;
  } catch (err) {
    return false;
  }
}

// event.headers در Netlify معمولاً لوئرکیس هستن
function requireAdmin(event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || !verifyAdminToken(token)) {
    return { error: { statusCode: 401, body: JSON.stringify({ ok: false, error: 'unauthorized' }) } };
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  return { supabase };
}

function signAdminToken(phone) {
  const expiry = Date.now() + 12 * 60 * 60 * 1000;
  const payload = `${phone}:${expiry}`;
  const sig = crypto.createHmac('sha256', process.env.ADMIN_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64');
}

module.exports = { requireAdmin, signAdminToken };
