// api/verify-otp.js
// کد وارد شده توسط کاربر رو با کدی که در مرحله send-otp توی Redis ذخیره شده مقایسه می‌کنه.
// اگه شماره برابر با شماره ادمین (ADMIN_PHONE) باشه، یه توکن امضاشده (adminToken) هم برمی‌گردونه
// که فقط با اون میشه به مسیرهای /api/admin-* دسترسی داشت.

const crypto = require('crypto');

function isValidIranMobile(mobile) {
  return /^09\d{9}$/.test(mobile);
}

function signAdminToken(phone) {
  const expiry = Date.now() + 12 * 60 * 60 * 1000; // اعتبار توکن: ۱۲ ساعت
  const payload = `${phone}:${expiry}`;
  const sig = crypto.createHmac('sha256', process.env.ADMIN_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64');
}

async function redisGet(key) {
  const url = `${process.env.UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
  });
  if (!res.ok) throw new Error('redis-get-failed');
  const data = await res.json();
  return data.result; // null اگه کلید وجود نداشته باشه یا منقضی شده باشه
}

async function redisDel(key) {
  const url = `${process.env.UPSTASH_REDIS_REST_URL}/del/${encodeURIComponent(key)}`;
  await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method-not-allowed' });
  }

  try {
    const { mobile, code } = req.body || {};
    if (!mobile || !isValidIranMobile(mobile) || !code) {
      return res.status(400).json({ ok: false, error: 'invalid-input' });
    }

    const savedCode = await redisGet(`otp:${mobile}`);

    if (!savedCode) {
      return res.status(400).json({ ok: false, error: 'expired-or-not-found' });
    }

    if (String(code) !== String(savedCode)) {
      return res.status(400).json({ ok: false, error: 'wrong-code' });
    }

    // کد درست بود؛ پاکش می‌کنیم تا دوباره قابل استفاده نباشه
    await redisDel(`otp:${mobile}`);

    const response = { ok: true };
    if(process.env.ADMIN_PHONE && mobile === process.env.ADMIN_PHONE){
      response.isAdmin = true;
      response.adminToken = signAdminToken(mobile);
    }

    return res.status(200).json(response);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: 'server-error' });
  }
};
