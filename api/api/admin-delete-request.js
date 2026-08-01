// api/admin-delete-request.js
// یه درخواست نمایندگی رو حذف می‌کنه. فقط با توکن ادمین.

const { requireAdmin } = require('./_admin-auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method-not-allowed' });
  }

  const supabase = requireAdmin(req, res);
  if (!supabase) return;

  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ ok: false, error: 'invalid-input' });

    const { error } = await supabase.from('agency_requests').delete().eq('id', id);
    if (error) throw error;

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: 'server-error' });
  }
};
