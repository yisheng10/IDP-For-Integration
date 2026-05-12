import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

const purgePatientRecordCallable = httpsCallable(functions, 'purgePatientRecord');

function mapPatientAdminError(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').trim();

  if (code.includes('unauthenticated')) {
    return 'Delete patient failed. Your CRC session expired. Sign in again and retry.';
  }

  if (code.includes('permission-denied')) {
    return 'Delete patient failed. Only authorized CRC users can purge patient records.';
  }

  if (code.includes('not-found')) {
    return 'Delete patient failed. The patient record was already removed or could not be found.';
  }

  if (code.includes('failed-precondition')) {
    return `Delete patient failed. ${message || 'This purge cannot run in the current state.'}`;
  }

  if (code.includes('unavailable') || code.includes('deadline-exceeded')) {
    return 'Delete patient failed. The purge service is temporarily unavailable. Retry shortly.';
  }

  if (message) {
    return `Delete patient failed. ${message}`;
  }

  return 'Delete patient failed. The hard purge service is unavailable right now.';
}

export async function purgePatientRecord(patientUid) {
  if (!String(patientUid || '').trim()) {
    throw new Error('Delete patient failed. No patient is selected.');
  }

  try {
    const response = await purgePatientRecordCallable({
      patientUid: String(patientUid).trim(),
    });
    return response.data || {};
  } catch (error) {
    const wrapped = new Error(mapPatientAdminError(error));
    wrapped.original = error;
    throw wrapped;
  }
}
