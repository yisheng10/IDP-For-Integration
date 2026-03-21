const DEFAULT_BASE_URL = 'http://127.0.0.1:8000';

function resolveDropoutServiceUrl() {
  const envUrl = import.meta.env.VITE_DROPOUT_SERVICE_BASE_URL;
  return (envUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
}

export async function fetchDropoutRiskSnapshot({ subjectId, currentDay = 1, historyRecords = null }) {
  if (!subjectId) {
    throw new Error('subject_id is required for dropout adapter requests.');
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${resolveDropoutServiceUrl()}/dropout-risk/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject_id: subjectId,
        current_day: currentDay,
        ...(Array.isArray(historyRecords) && historyRecords.length > 0 ? { history_records: historyRecords } : {}),
      }),
      signal: controller.signal,
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Dropout adapter request failed.');
    }

    return payload;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
