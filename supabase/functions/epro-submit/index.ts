import { jsonResponse, resolveCorsHeaders } from '../_shared/cors.ts';
import { requireFirebaseUser } from '../_shared/firebaseAuth.ts';
import { handleSubmit } from '../_shared/eproCore.ts';

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
    const body = await request.json();
    const payload = await handleSubmit({
      requestedSubjectId: body.subject_id,
      patientName: body.patient_name,
      protocolId: body.protocol_id,
      protocolName: body.protocol_name,
      answers: body.answers,
      firebaseUid: user.uid,
      firebaseToken: user.token,
    });
    return jsonResponse(payload, { status: 200 }, origin);
  } catch (error) {
    return jsonResponse({ error: error.message || 'Unable to submit questionnaire.' }, { status: 400 }, origin);
  }
});
