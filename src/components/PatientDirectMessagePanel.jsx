import React, { useEffect, useMemo, useState } from 'react';
import { sendCrcPatientDirectMessage } from '../services/crcDirectMessageService';
import { sendChatMessage, subscribeToChat } from '../services/alertService';

function coerceTimestampMillis(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1000000);
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getLatestDirectMessageAlert(alerts = []) {
  return alerts
    .filter((alert) => String(alert?.type || '').trim().toUpperCase() === 'MESSAGE')
    .sort((left, right) => coerceTimestampMillis(right?.timestamp) - coerceTimestampMillis(left?.timestamp))[0] || null;
}

function formatMessageTime(value) {
  const timestamp = coerceTimestampMillis(value);
  if (!timestamp) return 'Time not recorded';
  return new Date(timestamp).toLocaleString();
}

export default function PatientDirectMessagePanel({
  patient,
  crcName = 'CRC',
  alerts = [],
}) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState('');

  const directMessageAlert = useMemo(
    () => getLatestDirectMessageAlert(alerts),
    [alerts]
  );

  useEffect(() => {
    setMessages([]);
    if (!directMessageAlert?.ref) {
      return undefined;
    }

    const unsubscribe = subscribeToChat(directMessageAlert.ref, (nextMessages) => {
      setMessages(Array.isArray(nextMessages) ? nextMessages : []);
    });

    return () => unsubscribe();
  }, [directMessageAlert?.ref]);

  useEffect(() => {
    setSendError('');
  }, [patient?.id, directMessageAlert?.id]);

  const handleSend = async (event) => {
    event.preventDefault();
    const nextMessage = draft.trim();
    if (!patient?.id || !nextMessage || isSending) return;

    setIsSending(true);
    setSendError('');
    try {
      if (directMessageAlert?.ref) {
        await sendChatMessage(directMessageAlert.ref, 'crc', nextMessage, crcName, {
          patientUid: patient.id,
          alertType: 'MESSAGE',
          threadLabel: 'Direct Message',
        });
      } else {
        await sendCrcPatientDirectMessage({
          patientUid: patient.id,
          messageText: nextMessage,
          senderName: crcName,
        });
      }
      setDraft('');
    } catch (error) {
      setSendError(error.message || 'Unable to send the CRC message right now.');
    } finally {
      setIsSending(false);
    }
  };

  const statusTone = !directMessageAlert
    ? 'default'
    : directMessageAlert.lastSender === 'patient'
      ? 'success'
      : directMessageAlert.status === 'unread' && directMessageAlert.lastSender === 'crc'
        ? 'warning'
        : 'brand';
  const statusLabel = !directMessageAlert
    ? 'No direct-message thread yet'
    : directMessageAlert.lastSender === 'patient'
      ? 'Patient replied'
      : directMessageAlert.status === 'unread' && directMessageAlert.lastSender === 'crc'
        ? 'Awaiting patient reply'
        : 'Direct message active';
  const latestPreview = String(
    directMessageAlert?.message ||
      messages[messages.length - 1]?.text ||
      ''
  ).trim();

  return (
    <div className="patient-tabPanel patient-chat">
      <div className="patient-tabPanel__header">
        <div>
          <h4>Patient Chat</h4>
          <div className="section-note">
            Routine CRC follow-up outside safety cases. Messages sent here reuse the patient&apos;s existing direct-message thread.
          </div>
        </div>
        <span className={`metric-pill metric-pill--${statusTone}`}>{statusLabel}</span>
      </div>

      <div className="patient-chat__summary">
        <div className="patient-chat__summaryCopy">
          <strong>{patient?.nickname || patient?.email || 'Selected patient'}</strong>
          <div className="section-note">
            {latestPreview || 'Send the first direct CRC follow-up when no safety thread exists yet.'}
          </div>
        </div>
        <div className="patient-chat__summaryMeta">
          <span>{directMessageAlert?.senderName || crcName || 'CRC'}</span>
          <strong>{formatMessageTime(directMessageAlert?.timestamp)}</strong>
        </div>
      </div>

      <div className="patient-chat__stream" role="log" aria-live="polite">
        {messages.length ? (
          messages.map((message, index) => {
            const isPatient = String(message?.sender || '').trim().toLowerCase() === 'patient';
            const senderName = String(message?.senderName || '').trim() || (isPatient ? patient?.nickname || 'Patient' : crcName || 'CRC');
            return (
              <div
                key={`${message?.timestamp || 'message'}-${index}`}
                className={`patient-chat__message ${isPatient ? 'patient-chat__message--patient' : 'patient-chat__message--crc'}`}
              >
                <div className="patient-chat__messageMeta">
                  <strong>{senderName}</strong>
                  <span>{formatMessageTime(message?.timestamp)}</span>
                </div>
                <div className="patient-chat__messageBody">{message?.text || ''}</div>
              </div>
            );
          })
        ) : (
          <div className="empty-panel">
            No direct-message conversation is visible for this patient yet. Send the first CRC follow-up below.
          </div>
        )}
      </div>

      <form className="patient-chat__composer" onSubmit={handleSend}>
        <textarea
          rows={4}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Write a direct CRC follow-up that the patient should see and reply to from the patient app."
        />
        <div className="patient-chat__composerFooter">
          <span className="section-note">
            This path is separate from AE Guidance and safety case threads.
          </span>
          <button type="submit" className="btn btn-primary" disabled={!draft.trim() || isSending}>
            {isSending ? 'Sending...' : (directMessageAlert ? 'Send reply' : 'Send first message')}
          </button>
        </div>
      </form>

      {sendError ? (
        <div className="patient-chat__error" role="alert">{sendError}</div>
      ) : null}
    </div>
  );
}
