import { jsonResponse, resolveCorsHeaders } from '../_shared/cors.ts';
import { requireFirebaseUser } from '../_shared/firebaseAuth.ts';
import { loadCrcDailyReviewWorkspace } from '../_shared/eproReviewCore.ts';

Deno.serve(async (request) => {
  const origin = request.headers.get('Origin');
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: resolveCorsHeaders(origin) });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, origin);
  }

  try {
    const user = await requireFirebaseUser(request);
    const body = await request.json().catch(() => ({}));
    const payload = await loadCrcDailyReviewWorkspace({
      firebaseUid: user.uid,
      firebaseToken: user.token,
      activePatients: Array.isArray(body.activePatients) ? body.activePatients : [],
    });
    return jsonResponse(payload, { status: 200 }, origin);
  } catch (error) {
    return jsonResponse({ error: error.message || 'Unable to load the ePRO review workspace.' }, { status: 400 }, origin);
  }
});
