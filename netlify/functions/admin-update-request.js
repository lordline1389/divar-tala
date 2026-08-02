// netlify/functions/admin-update-request.js
const { requireAdmin } = require('./lib/admin-auth');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'method-not-allowed' }) };
  }

  const { supabase, error: authError } = requireAdmin(event);
  if (authError) return authError;

  try {
    const { id, status } = JSON.parse(event.body || '{}');
    if (!id || !['pending', 'approved', 'rejected'].includes(status)) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'invalid-input' }) };
    }

    const { error } = await supabase.from('agency_requests').update({ status }).eq('id', id);
    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'server-error' }) };
  }
};
