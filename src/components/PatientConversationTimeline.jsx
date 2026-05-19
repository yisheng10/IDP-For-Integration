import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
} from 'firebase/firestore';
import ReactMarkdown from 'react-markdown';
import { db } from '../firebase';
import { useCall } from '../context/CallContext';
import { sendCrcPatientDirectMessage } from '../services/crcDirectMessageService';
import {
  DEFAULT_CONVERSATION_TIMELINE_LIMIT,
  fetchOlderConversationTimeline,
  subscribeToConversationTimeline,
} from '../services/conversationTimelineService';

const TRACE_EVENT_LIMIT = 100;

function coerceChatTimestamp(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value?.toDate === 'function') {
    const converted = value.toDate();
    return Number.isNaN(converted?.getTime?.()) ? null : converted;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildCalendarDateKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function startOfCalendarDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatWhatsappStyleTime(date) {
  return date
    .toLocaleTimeString('en-GB', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    .replace('AM', 'am')
    .replace('PM', 'pm');
}

function formatWhatsappStyleDayLabel(date, now = new Date()) {
  const messageDay = startOfCalendarDay(date);
  const currentDay = startOfCalendarDay(now);
  const diffInDays = Math.floor((currentDay.getTime() - messageDay.getTime()) / 86400000);

  if (diffInDays <= 3) {
    return date.toLocaleDateString('en-US', { weekday: 'long' });
  }

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function buildTraceKey(patientUid, traceId) {
  const safePatientUid = String(patientUid || '').trim();
  const safeTraceId = String(traceId || '').trim();
  if (!safePatientUid || !safeTraceId) return '';
  return `${safePatientUid}:${safeTraceId}`;
}

function normalizeTraceDetailLines(details = []) {
  if (!Array.isArray(details)) return [];
  return details
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function normalizeTraceSourceExcerpts(sourceExcerpts = []) {
  if (!Array.isArray(sourceExcerpts)) return [];
  return sourceExcerpts
    .map((entry) => ({
      sourceType: String(entry?.sourceType || '').trim() || 'source',
      documentTitle: String(entry?.documentTitle || '').trim() || 'Source',
      citationLabel: String(entry?.citationLabel || '').trim() || 'Source',
      excerptText: String(entry?.excerptText || '').trim(),
      relevanceReason: String(entry?.relevanceReason || '').trim(),
    }))
    .filter((entry) => entry.excerptText);
}

function normalizeTraceEvent(entry = {}) {
  return {
    type: String(entry?.type || '').trim(),
    stepKey: String(entry?.stepKey || '').trim(),
    title: String(entry?.title || '').trim() || 'Trace event',
    summary: String(entry?.summary || '').trim() || 'No summary available.',
    details: normalizeTraceDetailLines(entry?.details),
    status: String(entry?.status || 'completed').trim(),
    sourceExcerpts: normalizeTraceSourceExcerpts(entry?.sourceExcerpts),
    seq: Number.isFinite(Number(entry?.seq)) ? Number(entry.seq) : 0,
  };
}

function normalizeTraceSummary(entry = {}) {
  return {
    traceId: String(entry?.traceId || '').trim() || null,
    patientUid: String(entry?.patientUid || '').trim() || null,
    displaySummary: String(entry?.displaySummary || '').trim() || '',
    latestStepTitle: String(entry?.latestStepTitle || '').trim() || 'Trace',
    sourceMask: String(entry?.sourceMask || '').trim() || 'none',
    persisted:
      entry?.persisted == null ? null : Boolean(entry.persisted),
  };
}

function buildMixedTimeline(entries = []) {
  const normalized = [...entries].sort((left, right) => {
    const leftTime = coerceChatTimestamp(left?.timestamp)?.getTime() || 0;
    const rightTime = coerceChatTimestamp(right?.timestamp)?.getTime() || 0;
    return leftTime - rightTime;
  });

  const items = [];
  let lastDayKey = null;
  const now = new Date();

  normalized.forEach((entry, index) => {
    const timestamp = coerceChatTimestamp(entry?.timestamp);
    const dayKey = timestamp ? buildCalendarDateKey(timestamp) : null;

    if (dayKey && dayKey !== lastDayKey) {
      items.push({
        type: 'date-separator',
        key: `separator-${dayKey}`,
        label: formatWhatsappStyleDayLabel(timestamp, now),
      });
      lastDayKey = dayKey;
    }

    items.push({
      type: 'message',
      key: entry.id || `entry-${index}`,
      entry,
      timestamp,
      timeLabel: timestamp ? formatWhatsappStyleTime(timestamp) : '',
    });
  });

  return items;
}

function mergeUniqueEntries(...groups) {
  const map = new Map();
  groups.flat().forEach((entry) => {
    if (!entry?.id) return;
    map.set(entry.id, entry);
  });
  return [...map.values()];
}

function buildBadgeLabel(entry = {}) {
  if (entry.channelType === 'patient_guidance') {
    return 'AI adverse event guidance';
  }

  if (entry.threadType === 'urgent_alert') {
    return 'Urgent';
  }

  return 'Direct message';
}

function buildEmptyStateLabel(patient) {
  if (!patient?.id) {
    return 'Select a patient first. Then this mixed timeline will show patient, AI, and CRC messages together.';
  }

  return 'No adverse event timeline messages have been mirrored for this patient yet.';
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
      <path
        d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.77.63 2.6a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.48-1.2a2 2 0 0 1 2.11-.45c.83.3 1.7.51 2.6.63A2 2 0 0 1 22 16.92z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
      <path
        d="M3 7h12v10H3z M15 10l4.55-2.28A1 1 0 0 1 21 8.62v6.76a1 1 0 0 1-1.45.9L15 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function PatientConversationTimeline({
  patient,
  crcName = 'CRC',
}) {
  const { startCall } = useCall() || {};
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [liveEntries, setLiveEntries] = useState([]);
  const [olderEntries, setOlderEntries] = useState([]);
  const [timelineError, setTimelineError] = useState('');
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [expandedTraceKeys, setExpandedTraceKeys] = useState({});
  const [traceDetailCache, setTraceDetailCache] = useState({});

  const scrollAreaRef = useRef(null);
  const nextOlderCursorRef = useRef(null);
  const hasLoadedOlderRef = useRef(false);

  useEffect(() => {
    setInput('');
    setLiveEntries([]);
    setOlderEntries([]);
    setTimelineError('');
    setIsLoadingOlder(false);
    setHasMoreOlder(false);
    nextOlderCursorRef.current = null;
    hasLoadedOlderRef.current = false;
  }, [patient?.id]);

  useEffect(() => {
    const patientUid = String(patient?.id || '').trim();
    if (!patientUid) {
      return undefined;
    }

    const unsubscribe = subscribeToConversationTimeline(
      patientUid,
      (entries, cursor) => {
        setTimelineError('');
        setLiveEntries(entries);
        if (!hasLoadedOlderRef.current) {
          nextOlderCursorRef.current = cursor;
          setHasMoreOlder(entries.length === DEFAULT_CONVERSATION_TIMELINE_LIMIT);
        }
      },
      (error) => {
        console.error('Conversation timeline subscription failed:', error);
        setTimelineError('Conversation timeline could not be loaded right now.');
      },
      { limitCount: DEFAULT_CONVERSATION_TIMELINE_LIMIT }
    );

    return () => unsubscribe();
  }, [patient?.id]);

  const combinedEntries = useMemo(
    () => mergeUniqueEntries(olderEntries, liveEntries),
    [liveEntries, olderEntries]
  );
  const timelineItems = useMemo(
    () => buildMixedTimeline(combinedEntries),
    [combinedEntries]
  );

  useEffect(() => {
    if (!scrollAreaRef.current) return;
    scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
  }, [timelineItems.length]);

  const loadTraceEvents = useCallback(async (traceRef) => {
    const traceId = String(traceRef?.traceId || '').trim();
    const patientUid = String(traceRef?.patientUid || '').trim();
    if (!traceId || !patientUid) {
      return null;
    }

    const traceKey = buildTraceKey(patientUid, traceId);
    if (!traceKey) {
      return null;
    }

    if (traceDetailCache[traceKey]) {
      return traceDetailCache[traceKey];
    }

    const traceSummaryRef = doc(db, 'users', patientUid, 'guidance_traces', traceId);
    const [traceSummarySnapshot, traceEventsSnapshot] = await Promise.all([
      getDoc(traceSummaryRef),
      getDocs(
        query(
          collection(db, 'users', patientUid, 'guidance_traces', traceId, 'events'),
          orderBy('seq', 'asc'),
          limit(TRACE_EVENT_LIMIT)
        )
      ),
    ]);

    const traceSummary = traceSummarySnapshot.exists()
      ? normalizeTraceSummary({
          traceId,
          patientUid,
          ...traceSummarySnapshot.data(),
        })
      : normalizeTraceSummary(traceRef);

    const traceDetail = {
      ...traceSummary,
      events: traceEventsSnapshot.docs.map((entry) => normalizeTraceEvent(entry.data())),
    };

    setTraceDetailCache((previous) => ({
      ...previous,
      [traceKey]: traceDetail,
    }));

    return traceDetail;
  }, [traceDetailCache]);

  const toggleTraceExpanded = useCallback(async (traceRef) => {
    const traceKey = buildTraceKey(traceRef?.patientUid, traceRef?.traceId);
    if (!traceKey) return;

    const isExpanded = Boolean(expandedTraceKeys[traceKey]);
    setExpandedTraceKeys((previous) => ({
      ...previous,
      [traceKey]: !isExpanded,
    }));

    if (!isExpanded && traceRef?.persisted !== false) {
      try {
        await loadTraceEvents(traceRef);
      } catch (error) {
        console.error('Failed to load patient-safe trace from mixed timeline:', error);
      }
    }
  }, [expandedTraceKeys, loadTraceEvents]);

  const handleLoadOlder = useCallback(async () => {
    const patientUid = String(patient?.id || '').trim();
    if (!patientUid || !nextOlderCursorRef.current || isLoadingOlder) {
      return;
    }

    setIsLoadingOlder(true);
    try {
      const payload = await fetchOlderConversationTimeline(patientUid, nextOlderCursorRef.current, {
        limitCount: DEFAULT_CONVERSATION_TIMELINE_LIMIT,
      });
      hasLoadedOlderRef.current = true;
      setOlderEntries((previous) => mergeUniqueEntries(previous, payload.entries));
      nextOlderCursorRef.current = payload.cursor;
      setHasMoreOlder(payload.hasMore);
    } catch (error) {
      console.error('Failed to load older conversation timeline entries:', error);
      setTimelineError('Older mixed timeline messages could not be loaded right now.');
    } finally {
      setIsLoadingOlder(false);
    }
  }, [isLoadingOlder, patient?.id]);

  const handleSend = useCallback(async (event) => {
    event.preventDefault();
    const patientUid = String(patient?.id || '').trim();
    const messageText = String(input || '').trim();
    if (!patientUid || !messageText || isSending) {
      return;
    }

    setIsSending(true);
    setTimelineError('');
    try {
      await sendCrcPatientDirectMessage({
        patientUid,
        messageText,
        senderName: crcName || 'CRC',
      });
      setInput('');
    } catch (error) {
      console.error('Failed to send CRC direct message from mixed timeline:', error);
      setTimelineError(String(error?.message || 'CRC message could not be sent right now.'));
    } finally {
      setIsSending(false);
    }
  }, [crcName, input, isSending, patient?.id]);

  const handleStartPatientCall = useCallback(async (isVideo) => {
    const patientUid = String(patient?.id || '').trim();
    if (!patientUid) {
      window.alert('Select a patient before starting a call.');
      return;
    }

    if (typeof startCall !== 'function') {
      window.alert('Call controls are not available right now.');
      return;
    }

    try {
      await startCall(patientUid, patient?.nickname || patient?.email || 'Patient', isVideo);
    } catch (error) {
      window.alert(error?.message || 'Unable to start the call.');
    }
  }, [patient?.email, patient?.id, patient?.nickname, startCall]);

  const renderTraceEventCard = (traceEvent, eventIndex) => (
    <div key={`${traceEvent.stepKey}-${traceEvent.seq}-${eventIndex}`} style={styles.traceEventCard}>
      <div style={styles.traceEventHeader}>
        <div style={{ flex: 1 }}>
          <div style={styles.traceEventTitle}>{traceEvent.title}</div>
          <div style={styles.traceEventSummary}>{traceEvent.summary}</div>
        </div>
        <span style={styles.traceEventStatus}>
          {traceEvent.status === 'started' ? 'Live' : 'Done'}
        </span>
      </div>
      {traceEvent.details.length ? (
        <div style={styles.traceDetailList}>
          {traceEvent.details.map((detail, detailIndex) => (
            <div key={`${traceEvent.seq}-detail-${detailIndex}`} style={styles.traceDetailItem}>
              • {detail}
            </div>
          ))}
        </div>
      ) : null}
      {traceEvent.sourceExcerpts.length ? (
        <div style={styles.traceExcerptList}>
          {traceEvent.sourceExcerpts.map((excerpt, excerptIndex) => (
            <div key={`${traceEvent.seq}-excerpt-${excerptIndex}`} style={styles.traceExcerptCard}>
              <div style={styles.traceExcerptHeader}>
                <span style={styles.traceExcerptChip}>{excerpt.sourceType.toUpperCase()}</span>
                <span style={styles.traceExcerptCitation}>{excerpt.citationLabel}</span>
              </div>
              <div style={styles.traceExcerptText}>{excerpt.excerptText}</div>
              {excerpt.relevanceReason ? (
                <div style={styles.traceExcerptReason}>{excerpt.relevanceReason}</div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );

  const renderTracePanel = (traceRef) => {
    const traceKey = buildTraceKey(traceRef?.patientUid, traceRef?.traceId);
    if (!traceKey) {
      return null;
    }

    const cachedTraceDetail = traceDetailCache[traceKey];
    const traceSummary = normalizeTraceSummary({
      ...traceRef,
      ...(cachedTraceDetail || {}),
    });
    const traceEvents = cachedTraceDetail?.events || [];
    const isExpanded = Boolean(expandedTraceKeys[traceKey]);

    return (
      <div style={styles.tracePanel}>
        <button
          type="button"
          style={styles.traceToggleButton}
          onClick={() => toggleTraceExpanded(traceRef)}
        >
          <div style={{ flex: 1 }}>
            <div style={styles.traceLabel}>Patient-safe reasoning trace</div>
            <div style={styles.traceSummaryText}>
              {traceSummary.displaySummary || traceSummary.latestStepTitle || 'Review how the adverse event guidance was prepared.'}
            </div>
          </div>
          <span style={styles.traceToggleAction}>{isExpanded ? 'Hide' : 'Show'}</span>
        </button>

        <div style={styles.traceMetaRow}>
          <span style={styles.traceMetaText}>Source mask: {traceSummary.sourceMask || 'none'}</span>
          <span style={styles.traceMetaText}>
            {traceSummary.persisted == null ? 'Save status pending' : traceSummary.persisted ? 'Saved' : 'Not saved'}
          </span>
        </div>

        {isExpanded ? (
          <div style={styles.traceExpandedBody}>
            {traceEvents.length ? (
              <div style={styles.traceEventList}>
                {traceEvents
                  .filter((event) => event.type === 'trace_event')
                  .map((event, index) => renderTraceEventCard(event, index))}
              </div>
            ) : (
              <div style={styles.traceEmptyState}>
                {traceSummary.persisted === false
                  ? 'This answer did not save a patient-linked trace.'
                  : 'Trace details are loading or were not available.'}
              </div>
            )}
          </div>
        ) : null}
      </div>
    );
  };

  const renderMessageRow = (item) => {
    const entry = item.entry;
    const badgeLabel = buildBadgeLabel(entry);
    const messageRole = String(entry?.actorType || '').trim();
    const isCrc = messageRole === 'crc';
    const isSystem = messageRole === 'system';
    const isAi = messageRole === 'ai';
    const traceRef = isAi ? normalizeTraceSummary(entry?.guidanceTrace || {}) : null;

    return (
      <div
        key={item.key}
        style={{
          ...styles.messageRow,
          justifyContent: isSystem ? 'center' : isCrc ? 'flex-end' : 'flex-start',
        }}
      >
        {isSystem ? (
          <div style={styles.systemBanner}>
            <div style={styles.badgeRow}>
              <span style={styles.badge}>{badgeLabel}</span>
            </div>
            <ReactMarkdown>{entry.messageText}</ReactMarkdown>
            {item.timeLabel ? <div style={styles.systemTimestamp}>{item.timeLabel}</div> : null}
          </div>
        ) : (
          <div
            style={{
              ...styles.messageBubble,
              ...(isCrc ? styles.crcBubble : isAi ? styles.aiBubble : styles.patientBubble),
            }}
          >
            <div style={styles.badgeRow}>
              <span style={styles.badge}>{badgeLabel}</span>
              <span style={styles.senderLabel}>{entry.displayName || 'Unknown'}</span>
            </div>
            <div style={styles.messageText}>
              {isAi ? <ReactMarkdown>{entry.messageText}</ReactMarkdown> : entry.messageText}
            </div>
            {isAi && traceRef?.traceId ? renderTracePanel(traceRef) : null}
            {item.timeLabel ? (
              <div style={{
                ...styles.timestamp,
                color: isCrc ? 'rgba(255,255,255,0.82)' : '#6b7c93',
              }}>
                {item.timeLabel}
              </div>
            ) : null}
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="card workspace-card intelligence-card" style={styles.panel}>
      <div style={styles.header}>
        <div>
          <h3 style={styles.title}>Patient Mixed Timeline</h3>
        </div>
        <div style={styles.patientActions}>
          <div style={styles.callButtonGroup}>
            <button
              type="button"
              style={styles.callIconButton}
              onClick={() => handleStartPatientCall(false)}
              disabled={!patient?.id}
              title={patient?.id ? `Voice call ${patient.nickname || 'patient'}` : 'Select a patient first'}
              aria-label={patient?.id ? `Voice call ${patient.nickname || 'patient'}` : 'Select a patient first'}
            >
              <PhoneIcon />
            </button>
            <button
              type="button"
              style={styles.callIconButton}
              onClick={() => handleStartPatientCall(true)}
              disabled={!patient?.id}
              title={patient?.id ? `Video call ${patient.nickname || 'patient'}` : 'Select a patient first'}
              aria-label={patient?.id ? `Video call ${patient.nickname || 'patient'}` : 'Select a patient first'}
            >
              <VideoIcon />
            </button>
          </div>
          <div style={styles.patientBadge}>
            {patient?.nickname || 'No patient selected'}
          </div>
        </div>
      </div>

      <div ref={scrollAreaRef} style={styles.body}>
        {timelineError ? <div style={styles.errorBanner}>{timelineError}</div> : null}
        {!patient?.id || !timelineItems.length ? (
          <div style={styles.emptyState}>{buildEmptyStateLabel(patient)}</div>
        ) : (
          <>
            {hasMoreOlder ? (
              <div style={styles.loadOlderRow}>
                <button
                  type="button"
                  style={styles.loadOlderButton}
                  onClick={handleLoadOlder}
                  disabled={isLoadingOlder}
                >
                  {isLoadingOlder ? 'Loading older...' : 'Load older'}
                </button>
              </div>
            ) : null}
            {timelineItems.map((item) =>
              item.type === 'date-separator' ? (
                <div key={item.key} style={styles.dateRow}>
                  <span style={styles.dateBadge}>{item.label}</span>
                </div>
              ) : (
                renderMessageRow(item)
              )
            )}
          </>
        )}
      </div>

      <form onSubmit={handleSend} style={styles.inputArea}>
        <div style={styles.inputControls}>
          <input
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={
              patient?.id
                ? `Message ${patient.nickname || 'patient'} directly...`
                : 'Select a patient first...'
            }
            disabled={!patient?.id || isSending}
            style={styles.input}
          />
          <button
            type="submit"
            disabled={!patient?.id || isSending || !String(input || '').trim()}
            style={styles.sendButton}
          >
            {isSending ? 'Sending...' : 'Send'}
          </button>
        </div>
        {timelineError ? <div style={styles.inputErrorText}>{timelineError}</div> : null}
      </form>
    </section>
  );
}

const styles = {
  panel: {
    minHeight: 0,
    display: 'grid',
    gridTemplateRows: 'auto minmax(0, 1fr) auto',
    overflow: 'hidden',
  },
  header: {
    padding: '10px 14px 9px',
    borderBottom: '1px solid #e5edf6',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
  },
  title: {
    margin: 0,
    fontSize: '16px',
    color: '#14324a',
  },
  subtitle: {
    marginTop: '6px',
    color: '#64748b',
    lineHeight: 1.5,
    fontSize: '13px',
  },
  patientBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '30px',
    padding: '0 10px',
    borderRadius: '999px',
    backgroundColor: '#edf5fb',
    color: '#0f609b',
    fontWeight: '700',
    fontSize: '13px',
    whiteSpace: 'nowrap',
  },
  patientActions: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    minWidth: 0,
  },
  callButtonGroup: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '7px 9px',
    borderRadius: '8px',
    background: '#0f609b',
    boxShadow: '0 10px 22px rgba(15, 96, 155, 0.18)',
  },
  callIconButton: {
    width: '34px',
    height: '32px',
    border: 0,
    borderRadius: '7px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#ffffff',
    background: 'transparent',
    cursor: 'pointer',
  },
  body: {
    minHeight: 0,
    overflowY: 'auto',
    padding: '14px 16px 18px',
    background: '#f6f9fc',
  },
  emptyState: {
    minHeight: '180px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    color: '#64748b',
    lineHeight: 1.6,
    padding: '0 18px',
  },
  errorBanner: {
    marginBottom: '12px',
    padding: '12px 14px',
    borderRadius: '12px',
    backgroundColor: '#fff5f5',
    color: '#b42318',
    border: '1px solid #f5c2c7',
    lineHeight: 1.5,
  },
  loadOlderRow: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '12px',
  },
  loadOlderButton: {
    border: '1px solid #d7e3f0',
    background: 'white',
    color: '#0f609b',
    borderRadius: '999px',
    padding: '8px 14px',
    cursor: 'pointer',
    fontWeight: '700',
  },
  dateRow: {
    display: 'flex',
    justifyContent: 'center',
    margin: '10px 0',
  },
  dateBadge: {
    fontSize: '12px',
    color: '#52606d',
    background: 'rgba(255,255,255,0.92)',
    border: '1px solid #dbe5f0',
    borderRadius: '999px',
    padding: '6px 10px',
  },
  messageRow: {
    display: 'flex',
    width: '100%',
    marginBottom: '12px',
  },
  messageBubble: {
    maxWidth: '88%',
    borderRadius: '16px',
    padding: '12px 14px',
    lineHeight: 1.6,
    wordBreak: 'break-word',
  },
  crcBubble: {
    backgroundColor: '#0f609b',
    color: '#ffffff',
  },
  patientBubble: {
    backgroundColor: '#ffffff',
    color: '#243b53',
    border: '1px solid #dbe5f0',
  },
  aiBubble: {
    backgroundColor: '#f8fbff',
    color: '#243b53',
    border: '1px solid #dbe5f0',
  },
  systemBanner: {
    maxWidth: '92%',
    padding: '12px 14px',
    borderRadius: '14px',
    backgroundColor: '#fff7ed',
    border: '1px solid #fed7aa',
    color: '#8a4c00',
    lineHeight: 1.6,
  },
  badgeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px',
    flexWrap: 'wrap',
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '22px',
    padding: '0 8px',
    borderRadius: '999px',
    backgroundColor: 'rgba(15,96,155,0.12)',
    color: '#0f609b',
    fontSize: '11px',
    fontWeight: '800',
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
  },
  senderLabel: {
    fontSize: '12px',
    fontWeight: '700',
    opacity: 0.9,
  },
  messageText: {
    lineHeight: 1.6,
  },
  timestamp: {
    marginTop: '8px',
    textAlign: 'right',
    fontSize: '11px',
  },
  systemTimestamp: {
    marginTop: '8px',
    textAlign: 'right',
    color: '#9a6700',
    fontSize: '11px',
  },
  inputArea: {
    display: 'grid',
    padding: '14px 16px 18px',
    borderTop: '1px solid #e5edf6',
    backgroundColor: '#ffffff',
    gap: '10px',
  },
  inputControls: {
    display: 'flex',
    gap: '12px',
  },
  input: {
    flex: 1,
    padding: '14px 16px',
    borderRadius: '14px',
    border: '1px solid #c7d4e2',
    outline: 'none',
    fontSize: '14px',
  },
  sendButton: {
    minWidth: '96px',
    backgroundColor: '#0f609b',
    borderRadius: '14px',
    border: 'none',
    color: '#ffffff',
    cursor: 'pointer',
    fontWeight: '700',
    padding: '0 18px',
  },
  inputErrorText: {
    color: '#b42318',
    fontSize: '12px',
    lineHeight: 1.5,
  },
  tracePanel: {
    marginTop: '12px',
    borderTop: '1px solid #e5edf6',
    paddingTop: '12px',
  },
  traceToggleButton: {
    width: '100%',
    border: '1px solid #d7e3f0',
    background: '#ffffff',
    borderRadius: '14px',
    padding: '12px 14px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    cursor: 'pointer',
    textAlign: 'left',
  },
  traceLabel: {
    fontSize: '12px',
    fontWeight: '800',
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
    color: '#0f609b',
  },
  traceSummaryText: {
    fontSize: '13px',
    color: '#35526b',
    lineHeight: 1.5,
    marginTop: '4px',
  },
  traceToggleAction: {
    color: '#0f609b',
    fontWeight: '700',
    whiteSpace: 'nowrap',
  },
  traceMetaRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '10px',
    fontSize: '12px',
    color: '#64748b',
    marginTop: '10px',
  },
  traceMetaText: {
    color: '#64748b',
  },
  traceExpandedBody: {
    marginTop: '10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  traceEmptyState: {
    border: '1px dashed #c6d6e6',
    borderRadius: '14px',
    padding: '14px',
    color: '#64748b',
    fontSize: '13px',
    lineHeight: 1.55,
    background: '#fbfdff',
  },
  traceEventList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  traceEventCard: {
    border: '1px solid #dbe7f2',
    borderRadius: '14px',
    padding: '12px 14px',
    background: '#ffffff',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  traceEventHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '12px',
  },
  traceEventTitle: {
    fontSize: '13px',
    fontWeight: '800',
    color: '#153551',
  },
  traceEventSummary: {
    marginTop: '4px',
    fontSize: '13px',
    color: '#35526b',
    lineHeight: 1.55,
  },
  traceEventStatus: {
    fontSize: '11px',
    fontWeight: '700',
    color: '#0f609b',
    background: '#e8f1fb',
    borderRadius: '999px',
    padding: '5px 9px',
    whiteSpace: 'nowrap',
  },
  traceDetailList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    color: '#35526b',
    fontSize: '13px',
    lineHeight: 1.55,
  },
  traceDetailItem: {
    color: '#35526b',
    fontSize: '13px',
    lineHeight: 1.55,
  },
  traceExcerptList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  traceExcerptCard: {
    background: '#f8fbff',
    border: '1px solid #dbe7f2',
    borderRadius: '12px',
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  traceExcerptHeader: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    alignItems: 'center',
  },
  traceExcerptChip: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '58px',
    height: '24px',
    borderRadius: '999px',
    background: '#dfeefb',
    color: '#0f609b',
    fontSize: '11px',
    fontWeight: '800',
    letterSpacing: '0.02em',
  },
  traceExcerptCitation: {
    fontSize: '12px',
    color: '#4a647e',
    fontWeight: '600',
  },
  traceExcerptText: {
    fontSize: '13px',
    color: '#243b53',
    lineHeight: 1.55,
  },
  traceExcerptReason: {
    fontSize: '12px',
    color: '#52606d',
    lineHeight: 1.5,
  },
};
