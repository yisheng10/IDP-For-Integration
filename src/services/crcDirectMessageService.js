import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

const sendCrcPatientDirectMessageCallable = httpsCallable(
  functions,
  'sendCrcPatientDirectMessage'
);

function mapCallableError(error) {
  const code = String(error?.code || '').toLowerCase();
  if (code.includes('invalid-argument')) {
    return 'Patient and message details were incomplete.';
  }
  if (code.includes('permission-denied')) {
    return 'CRC direct messaging is not permitted for this patient workspace.';
  }
  if (code.includes('not-found')) {
    return 'This patient workspace could not be found anymore.';
  }
  if (code.includes('unauthenticated')) {
    return 'CRC sign-in expired. Please sign in again.';
  }
  return 'CRC message could not be sent right now.';
}

export async function sendCrcPatientDirectMessage({
  patientUid,
  messageText,
  senderName,
}) {
  try {
    const response = await sendCrcPatientDirectMessageCallable({
      patientUid,
      messageText,
      senderName,
    });
    return response?.data || null;
  } catch (error) {
    const mappedError = new Error(mapCallableError(error));
    mappedError.cause = error;
    throw mappedError;
  }
}
