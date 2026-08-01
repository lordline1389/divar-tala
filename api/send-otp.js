// api/send-otp.js
// یک شماره موبایل می‌گیره، کد ۴ رقمی تصادفی می‌سازه، از طریق قالب "کد تایید" در sms.ir
// پیامک واقعی می‌فرسته و کد رو (به همراه زمان انقضا) توی Upstash Redis ذخیره می‌کنه.
// کلیدهای محرمانه (SMSIR_API_KEY و ...) فقط سمت سرور خونده می‌شن، هرگز به مرورگر نمی‌رن.
//
// محدودیت درخواست (Rate Limiting) — برای جلوگیری از هزینه‌تراشی و مزاحمت پیامکی:
//   ۱) فاصله‌ی حداقل ۶۰ ثانیه بین دو درخواست پشت‌سرهم برای یه شماره
//   ۲) حداکثر ۳ درخواست در هر ساعت برای یه شماره
//   ۳) حداکثر ۱۰ درخواست در هر ساعت از یه آی‌پی (برای جلوگیری از حمله به شماره‌های مختلف)

const OTP_TTL_SECONDS = 120; // مدت اعتبار کد: ۲ دقیقه
const COOLDOWN_SECONDS = 60; // فاصله بین دو درخواست پشت‌سرهم
const PHONE_LIMIT = 3; // حداکثر درخواست مجاز برای یه شماره
const PHONE_LIMIT_WINDOW = 3600; // در این بازه (ثانیه) = ۱ ساعت
const IP_LIMIT = 10; // حداکثر درخواست مجاز از یه آی‌پی
const IP_LIMIT_WINDOW = 3600;

function isValidIranMobile(mobile) {
  return /^09\d{9}$/.test(mobile);
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

async function redisSet(key, value, ttlSeconds) {
  const url = `${process.env.UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}?EX=${ttlSeconds}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
  });
  if (!res.ok) throw new Error('redis-set-failed');
  return res.json();
}

// SET با پرچم NX: فقط اگه کلید از قبل وجود نداشته باشه مقداردهی می‌شه.
// برای پیاده‌سازی cooldown استفاده می‌شه (اتمیک و امن در برابر race condition).
async function redisSetNX(key, value, ttlSeconds) {
  const url = `${process.env.UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}?EX=${ttlSeconds}&NX=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
  });
  if (!res.ok) throw new Error('redis-setnx-failed');
  const data = await res.json();
  return data.result === 'OK'; // true یعنی کلید تازه ست شد (قبلاً نبود)
}

// شمارنده با انقضای خودکار روی اولین افزایش؛ برای محدودیت تعداد در بازه زمانی.
async function redisIncrWithExpiry(key, ttlSeconds) {
  const incrUrl = `${process.env.UPSTASH_REDIS_REST_URL}/incr/${encodeURIComponent(key)}`;
  const res = await fetch(incrUrl, {
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
  });
  if (!res.ok) throw new Error('redis-incr-failed');
  const data = await res.json();
  const count = data.result;
  if (count === 1) {
    const expUrl = `${process.env.UPSTASH_REDIS_REST_URL}/expire/${encodeURIComponent(key)}/${ttlSeconds}`;
    await fetch(expUrl, {
      headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
    });
  }
  return count;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method-not-allowed' });
  }

  try {
    const { mobile } = req.body || {};
    if (!mobile || !isValidIranMobile(mobile)) {
      return res.status(400).json({ ok: false, error: 'invalid-mobile' });
    }

    const ip = getClientIp(req);

    // ۱) بررسی محدودیت آی‌پی (اول از همه، ارزون‌ترین چک)
    const ipCount = await redisIncrWithExpiry(`otp-ip:${ip}`, IP_LIMIT_WINDOW);
    if (ipCount > IP_LIMIT) {
      return res.status(429).json({ ok: false, error: 'too-many-requests-ip' });
    }

    // ۲) بررسی فاصله زمانی بین دو درخواست برای همین شماره (cooldown)
    const cooldownOk = await redisSetNX(`otp-cooldown:${mobile}`, '1', COOLDOWN_SECONDS);
    if (!cooldownOk) {
      return res.status(429).json({ ok: false, error: 'too-soon', retryAfter: COOLDOWN_SECONDS });
    }

    // ۳) بررسی محدودیت تعداد درخواست در ساعت برای همین شماره
    const phoneCount = await redisIncrWithExpiry(`otp-count:${mobile}`, PHONE_LIMIT_WINDOW);
    if (phoneCount > PHONE_LIMIT) {
      return res.status(429).json({ ok: false, error: 'too-many-requests-phone' });
    }

    // ساخت کد ۴ رقمی تصادفی
    const code = String(Math.floor(1000 + Math.random() * 9000));

    // ارسال پیامک واقعی از طریق sms.ir (سرویس ارسال تایید / قالب)
    const smsRes = await fetch('https://api.sms.ir/v1/send/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/plain',
        'x-api-key': process.env.SMSIR_API_KEY,
      },
      body: JSON.stringify({
        mobile,
        templateId: Number(process.env.SMSIR_TEMPLATE_ID),
        parameters: [{ name: 'OTP', value: code }],
      }),
    });

    const smsData = await smsRes.json().catch(() => ({}));

    if (!smsRes.ok || smsData.status !== 1) {
      console.error('sms.ir error:', smsData);
      return res.status(502).json({ ok: false, error: 'sms-send-failed' });
    }

    // ذخیره کد در Redis برای ۲ دقیقه تا مرحله verify بتونه چکش کنه
    await redisSet(`otp:${mobile}`, code, OTP_TTL_SECONDS);

    return res.status(200).json({ ok: true, ttl: OTP_TTL_SECONDS });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: 'server-error' });
  }
};
