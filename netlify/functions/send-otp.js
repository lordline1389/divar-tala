// netlify/functions/send-otp.js
// یک شماره موبایل می‌گیره، کد ۴ رقمی تصادفی می‌سازه، از طریق قالب "کد تایید" در sms.ir
// پیامک واقعی می‌فرسته و کد رو (به همراه زمان انقضا) توی Upstash Redis ذخیره می‌کنه.
//
// محدودیت درخواست:
//   ۱) حداقل ۶۰ ثانیه فاصله بین دو درخواست پشت‌سرهم برای یه شماره
//   ۲) حداکثر ۳ درخواست در ساعت برای یه شماره
//   ۳) حداکثر ۱۰ درخواست در ساعت از یه آی‌پی

const OTP_TTL_SECONDS = 120;
const COOLDOWN_SECONDS = 60;
const PHONE_LIMIT = 3;
const PHONE_LIMIT_WINDOW = 3600;
const IP_LIMIT = 10;
const IP_LIMIT_WINDOW = 3600;

function isValidIranMobile(mobile) {
  return /^09\d{9}$/.test(mobile);
}

function getClientIp(event) {
  const h = event.headers || {};
  return h['x-nf-client-connection-ip'] || (h['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

async function redisSet(key, value, ttlSeconds) {
  const url = `${process.env.UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}?EX=${ttlSeconds}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` } });
  if (!res.ok) throw new Error('redis-set-failed');
  return res.json();
}

async function redisSetNX(key, value, ttlSeconds) {
  const url = `${process.env.UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}?EX=${ttlSeconds}&NX=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` } });
  if (!res.ok) throw new Error('redis-setnx-failed');
  const data = await res.json();
  return data.result === 'OK';
}

async function redisIncrWithExpiry(key, ttlSeconds) {
  const incrUrl = `${process.env.UPSTASH_REDIS_REST_URL}/incr/${encodeURIComponent(key)}`;
  const res = await fetch(incrUrl, { headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` } });
  if (!res.ok) throw new Error('redis-incr-failed');
  const data = await res.json();
  const count = data.result;
  if (count === 1) {
    const expUrl = `${process.env.UPSTASH_REDIS_REST_URL}/expire/${encodeURIComponent(key)}/${ttlSeconds}`;
    await fetch(expUrl, { headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` } });
  }
  return count;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'method-not-allowed' }) };
  }

  try {
    const { mobile } = JSON.parse(event.body || '{}');
    if (!mobile || !isValidIranMobile(mobile)) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'invalid-mobile' }) };
    }

    const ip = getClientIp(event);

    const ipCount = await redisIncrWithExpiry(`otp-ip:${ip}`, IP_LIMIT_WINDOW);
    if (ipCount > IP_LIMIT) {
      return { statusCode: 429, body: JSON.stringify({ ok: false, error: 'too-many-requests-ip' }) };
    }

    const cooldownOk = await redisSetNX(`otp-cooldown:${mobile}`, '1', COOLDOWN_SECONDS);
    if (!cooldownOk) {
      return { statusCode: 429, body: JSON.stringify({ ok: false, error: 'too-soon', retryAfter: COOLDOWN_SECONDS }) };
    }

    const phoneCount = await redisIncrWithExpiry(`otp-count:${mobile}`, PHONE_LIMIT_WINDOW);
    if (phoneCount > PHONE_LIMIT) {
      return { statusCode: 429, body: JSON.stringify({ ok: false, error: 'too-many-requests-phone' }) };
    }

    const code = String(Math.floor(1000 + Math.random() * 9000));

    const smsRes = await fetch('https://api.sms.ir/v1/send/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/plain', 'x-api-key': process.env.SMSIR_API_KEY },
      body: JSON.stringify({
        mobile,
        templateId: Number(process.env.SMSIR_TEMPLATE_ID),
        parameters: [{ name: 'OTP', value: code }],
      }),
    });

    const smsData = await smsRes.json().catch(() => ({}));

    if (!smsRes.ok || smsData.status !== 1) {
      console.error('sms.ir error:', smsData);
      return { statusCode: 502, body: JSON.stringify({ ok: false, error: 'sms-send-failed' }) };
    }

    await redisSet(`otp:${mobile}`, code, OTP_TTL_SECONDS);

    return { statusCode: 200, body: JSON.stringify({ ok: true, ttl: OTP_TTL_SECONDS }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'server-error' }) };
  }
};
