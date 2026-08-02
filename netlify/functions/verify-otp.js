// netlify/functions/verify-otp.js
const { signAdminToken } = require('./lib/admin-auth');

function isValidIranMobile(mobile) {
  return /^09\d{9}$/.test(mobile);
}

async function redisGet(key) {
  const url = `${process.env.UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` } });
  if (!res.ok) throw new Error('redis-get-failed');
  const data = await res.json();
  return data.result;
}

async function redisDel(key) {
  const url = `${process.env.UPSTASH_REDIS_REST_URL}/del/${encodeURIComponent(key)}`;
  await fetch(url, { headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` } });
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'method-not-allowed' }) };
  }

  try {
    const { mobile, code } = JSON.parse(event.body || '{}');
    if (!mobile || !isValidIranMobile(mobile) || !code) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'invalid-input' }) };
    }

    const savedCode = await redisGet(`otp:${mobile}`);
    if (!savedCode) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'expired-or-not-found' }) };
    }
    if (String(code) !== String(savedCode)) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'wrong-code' }) };
    }

    await redisDel(`otp:${mobile}`);

    const response = { ok: true };
    if (process.env.ADMIN_PHONE && mobile === process.env.ADMIN_PHONE) {
      response.isAdmin = true;
      response.adminToken = signAdminToken(mobile);
    }

    return { statusCode: 200, body: JSON.stringify(response) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'server-error' }) };
  }
};
