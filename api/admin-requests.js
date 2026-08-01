// api/admin-requests.js
// لیست همه‌ی درخواست‌های نمایندگی رو برمی‌گردونه. فقط با توکن معتبر ادمین کار می‌کنه.

const { requireAdmin } = require('./_admin-auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'method-not-allowed' });
  }

  const supabase = requireAdmin(req, res);
  if (!supabase) return; // requireAdmin خودش پاسخ 401 رو فرستاده

  try {
    const { data, error } = await supabase
      .from('agency_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.status(200).json({ ok: true, requests: data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: 'server-error' });
  }
};
