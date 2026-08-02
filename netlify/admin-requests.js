// netlify/functions/admin-requests.js
const { requireAdmin } = require('./lib/admin-auth');

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'method-not-allowed' }) };
  }

  const { supabase, error: authError } = requireAdmin(event);
  if (authError) return authError;

  try {
    const { data, error } = await supabase
      .from('agency_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return { statusCode: 200, body: JSON.stringify({ ok: true, requests: data }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'server-error' }) };
  }
};
