import { jsonResponse, resolveCorsHeaders } from '../_shared/cors.ts';
import { requireFirebaseUser } from '../_shared/firebaseAuth.ts';
import {
  approveAllDailyReviews,
  approvePatientDailyReview,
  approveTrialDailyReview,
  savePatientDailyReviewWording,
  saveTrialDailyReviewWording,
} from '../_shared/eproReviewCore.ts';

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
    const action = String(body.action || '').trim();

    let payload: unknown;
    if (action === 'approve_trial') {
      payload = await approveTrialDailyReview({
        reviewId: String(body.reviewId || ''),
        firebaseUid: user.uid,
        firebaseToken: user.token,
      });
    } else if (action === 'approve_patient') {
      payload = await approvePatientDailyReview({
        reviewId: String(body.reviewId || ''),
        firebaseUid: user.uid,
        firebaseToken: user.token,
      });
    } else if (action === 'save_trial_wording') {
      payload = await saveTrialDailyReviewWording({
        reviewId: String(body.reviewId || ''),
        overrides: body.overrides && typeof body.overrides === 'object' ? body.overrides : {},
        firebaseUid: user.uid,
        firebaseToken: user.token,
      });
    } else if (action === 'save_patient_wording') {
      payload = await savePatientDailyReviewWording({
        reviewId: String(body.reviewId || ''),
        overrides: body.overrides && typeof body.overrides === 'object' ? body.overrides : {},
        firebaseUid: user.uid,
        firebaseToken: user.token,
      });
    } else if (action === 'approve_all') {
      payload = await approveAllDailyReviews({
        firebaseUid: user.uid,
        firebaseToken: user.token,
      });
    } else {
      throw new Error('Unsupported ePRO review action.');
    }

    return jsonResponse({ ok: true, payload }, { status: 200 }, origin);
  } catch (error) {
    return jsonResponse({ error: error.message || 'Unable to perform the ePRO review action.' }, { status: 400 }, origin);
  }
});
