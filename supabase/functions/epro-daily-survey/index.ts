import { jsonResponse, resolveCorsHeaders } from '../_shared/cors.ts';
import { requireFirebaseUser } from '../_shared/firebaseAuth.ts';
import { handleDailySurvey } from '../_shared/eproCore.ts';

Deno.serve(async (request) => {
  const origin = request.headers.get('Origin');
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: resolveCorsHeaders(origin) });
  }

  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 }, origin);
  }

  try {
    const user = await requireFirebaseUser(request);
    const url = new URL(request.url);
    const payload = await handleDailySurvey({
      requestedSubjectId: url.searchParams.get('subject_id'),
      patientName: url.searchParams.get('patient_name'),
      firebaseUid: user.uid,
    });
    return jsonResponse(payload, { status: 200 }, origin);
  } catch (error) {
    return jsonResponse({ error: error.message || 'Unable to load questionnaire.' }, { status: 400 }, origin);
  }
});

