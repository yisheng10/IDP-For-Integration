# Frontend Firebase Read Storm Static Review

Date: 2026-04-09  
Scope reviewed:
- `src/` (CRC web application)
- `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/` (patient mobile logic)

Explicitly not reviewed:
- `newest-crc-web/`

Review mode:
- Static code review only
- No Firebase / Firestore access
- No runtime reproduction
- No code changes applied in this review document

---

## Executive Summary

This frontend codebase contains multiple high-confidence read amplification patterns that can plausibly explain a very large Firestore read spike even without any backend publisher involvement.

The most serious patterns are:

1. Unbounded global real-time listeners mounted on CRC screens
2. Collection-group listeners over `alerts`, `epro_submissions`, and `dropout_predictions` with no `limit()`
3. Client-side fan-out reads in chatbot code that fetch subcollections across many patients
4. Unbounded per-patient history listeners for chat, alerts, vitals, ePRO, appointments, and side effect reports
5. WebRTC call contexts that create nested `onSnapshot` listeners without retaining and cleaning the unsubscribe handles

The likely root cause is not one single bug. It is the combined effect of:

- global dashboards listening to entire collections
- history / alert views listening to entire collection groups
- long-lived chat and patient history listeners with no caps
- call listener leaks that can stack over repeated usage

The most dangerous files in the current active trees are:

- `src/pages/CRCHome.jsx`
- `src/services/alertService.js`
- `src/services/dropoutService.js`
- `src/services/incidentService.js`
- `src/components/GeminiChatbot.jsx`
- `src/context/CallContext.jsx`
- `src/pages/HistoryPage.jsx`
- `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/components/GeminiChatbot.js`
- `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/alertService.js`
- `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/context/CallContext.web.js`
- `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/eproService.js`
- `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/sideEffectService.js`

---

## High-Confidence Root Causes

### 1. CRC dashboard mounts several unbounded global listeners at once

File:
- `src/pages/CRCHome.jsx:150-167`
- `src/pages/CRCHome.jsx:233-282`
- `src/pages/CRCHome.jsx:331-336`

Problem:
- The main CRC page subscribes to:
  - all patients
  - all CRC users
  - all unresolved alerts
  - all alerts globally
  - all `epro_submissions` globally
  - all incidents globally
  - full vitals history for the selected patient
  - full appointment history for the selected patient
  - full alert history for the selected patient
- Several of these listeners are unbounded and collection-group based.

Why this is dangerous:
- CRC dashboard is a long-lived page.
- Every document change in any matching collection can fan out to the mounted listeners.
- `collectionGroup(db, 'alerts')` and `collectionGroup(db, 'epro_submissions')` are especially expensive in a live app with many users.

Most dangerous lines:
- `src/pages/CRCHome.jsx:151-153`
- `src/pages/CRCHome.jsx:159-161`
- `src/pages/CRCHome.jsx:247-256`
- `src/pages/CRCHome.jsx:266-279`
- `src/pages/CRCHome.jsx:331-333`

Safe replacement pattern:

```js
useEffect(() => {
  const patientsQuery = query(
    collection(db, 'users'),
    where('role', '==', 'patient'),
    orderBy('createdAt', 'desc'),
    limit(20)
  );

  return onSnapshot(
    patientsQuery,
    (snapshot) => {
      setPatients(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    },
    (error) => {
      console.error('Patient roster subscription failed:', error);
    }
  );
}, []);
```

Safe replacement for selected-patient vitals:

```js
useEffect(() => {
  if (!selectedPatientId) {
    setPVitals([]);
    return undefined;
  }

  const vitalsQuery = query(
    collection(db, 'users', selectedPatientId, 'vitals'),
    orderBy('timestamp', 'desc'),
    limit(20)
  );

  return onSnapshot(
    vitalsQuery,
    (snapshot) => {
      setPVitals(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    },
    (error) => {
      console.error('Selected patient vitals subscription failed:', error);
    }
  );
}, [selectedPatientId]);
```

---

### 2. Global alert collection-group listener is unbounded

Files:
- `src/pages/CRCHome.jsx:247-256`
- `src/pages/HistoryPage.jsx:18-29`
- `src/services/alertService.js:18-28`
- `src/services/alertService.js:31-49`
- `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/alertService.js:18-31`

Problem:
- Multiple places subscribe to `collectionGroup(db, 'alerts')` with no `limit()`.
- One helper even defaults to `limit(5000)`, which is still dangerous on a hot collection and far above your stated safety threshold.

Most dangerous lines:
- `src/pages/CRCHome.jsx:247`
- `src/pages/HistoryPage.jsx:19`
- `src/services/alertService.js:19`
- `src/services/alertService.js:32-36`
- `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/alertService.js:19`

Why this is dangerous:
- Alerts are cross-user, frequently updated, and often remain open long enough to keep listeners alive.
- Each listener sees the entire matching dataset, not only the visible page.

Safe replacement pattern:

```js
export const subscribeToUnresolvedAlerts = (onUpdate, onError) => {
  const q = query(
    collectionGroup(db, 'alerts'),
    where('status', '==', 'unread'),
    orderBy('timestamp', 'desc'),
    limit(20)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      onUpdate(
        snapshot.docs.map((d) => ({
          id: d.id,
          ref: d.ref,
          uid: d.ref.parent.parent.id,
          ...d.data(),
        }))
      );
    },
    onError
  );
};
```

For historical alert browsing, the safe approach is:
- page 1 only from Firestore
- pagination with `startAfter`
- never keep a live listener on the entire audit history

Safe history query:

```js
const alertsQuery = query(
  collectionGroup(db, 'alerts'),
  orderBy('timestamp', 'desc'),
  limit(20)
);
```

Then move page 2+ to explicit pagination instead of a global live listener.

---

### 3. Dropout dashboard listens to the entire `dropout_predictions` collection group

Files:
- `src/components/DropoutRiskPanel.jsx:124-135`
- `src/services/dropoutService.js:204-221`

Problem:
- `subscribeToAllDropoutPredictionSnapshots()` subscribes to every document in the collection group, then filters client-side to `id === 'current'`.
- This is exactly the kind of pattern that scales badly.

Most dangerous lines:
- `src/components/DropoutRiskPanel.jsx:124-135`
- `src/services/dropoutService.js:205-218`

Why this is dangerous:
- Firestore still reads the matching query set before the client-side `filter((entry) => entry.id === 'current')`.
- If many users have `dropout_predictions/current`, CRC dashboard opens one global listener over all of them.

Safe replacement pattern:

```js
export function subscribeToAllDropoutPredictionSnapshots(onUpdate, onError) {
  const q = query(
    collectionGroup(db, 'dropout_predictions'),
    where('__name__', '>=', 'current'),
    where('__name__', '<=', 'current'),
    limit(20)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const rows = snapshot.docs.map((entry) => {
        const userDoc = entry.ref.parent.parent;
        return {
          id: entry.id,
          userId: userDoc?.id || '',
          ...entry.data(),
        };
      });
      onUpdate(rows);
    },
    onError
  );
}
```

Note:
- Firestore document ID filtering in collection-group queries is awkward.
- The better product fix is to mirror a CRC-facing top-level collection such as `dropout_prediction_current` rather than collection-group scanning all users from the client.

---

### 4. Incident inbox reads the entire `incident_records` collection live

Files:
- `src/services/incidentService.js:421-435`
- `src/pages/CRCHome.jsx:287-318`
- `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/incidentService.js:421-435`

Problem:
- `subscribeToIncidentRecords()` subscribes to the full collection when no CRC filter is passed.
- The CRC home page then filters incident visibility client-side.

Why this is dangerous:
- The client receives all incident docs, even if only a subset is visible to the current CRC.

Safe replacement pattern:

```js
export function subscribeToIncidentRecords(onUpdate, onError, options = {}) {
  const q = query(
    collection(db, 'incident_records'),
    where('primary_crc_id', '==', options.crcId),
    orderBy('updated_at', 'desc'),
    limit(20)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      onUpdate(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    },
    onError
  );
}
```

If a CRC must see unassigned incidents too:
- add a second small query for `primary_crc_id == null`
- never subscribe to the entire collection and filter in memory

---

### 5. Chatbot fan-out reads across many patients from the client

Files:
- `src/components/GeminiChatbot.jsx:160-215`
- `src/components/GeminiChatbot.jsx:217-261`
- `src/components/GeminiChatbot.jsx:263-318`
- `src/components/GeminiChatbot.jsx:398-406`
- `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/components/GeminiChatbot.js:130-150`
- `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/components/GeminiChatbot.js:189-240`

Problems:

1. Chat history listener is unbounded:
   - `src/components/GeminiChatbot.jsx:76-81`
   - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/components/GeminiChatbot.js:136-147`

2. CRC global mode loops over many patients and performs per-patient subcollection reads:
   - `fetchGlobalPatientSummary()` reads vitals and appointments for up to 50 patients
   - `fetchGlobalSchedule()` reads appointments for up to 20 patients, with no limit on the appointment query

3. `handleClearHistory()` reads the entire chat history collection before batch deletion:
   - `src/components/GeminiChatbot.jsx:403-406`

Why this is dangerous:
- One chat message in CRC global mode can trigger dozens or hundreds of Firestore reads.
- If several CRCs keep the docked chatbot open, the fan-out becomes very expensive.

Safe replacement patterns:

Limit chat history:

```js
const historyQuery = query(
  historyCollectionRef,
  orderBy('timestamp', 'desc'),
  limit(100)
);

const unsubscribe = onSnapshot(historyQuery, (snapshot) => {
  const nextMessages = snapshot.docs
    .map((entry) => ({ id: entry.id, ...entry.data() }))
    .reverse();
  setMessages(nextMessages);
  setIsHistoryLoaded(true);
});
```

Do not fan out from the client across many patients:

```js
const fetchGlobalPatientSummary = async () => {
  if (!allPatients.length) {
    return 'No patients found in the current in-memory roster.';
  }

  return allPatients
    .slice(0, 20)
    .map((patient) => {
      return `- ${patient.nickname || patient.email || patient.id}`;
    })
    .join('\n');
};
```

For any real multi-patient clinical summary:
- use already-loaded UI state
- or call a backend summary endpoint
- do not issue per-patient Firestore fan-out reads from the browser

Safe schedule query if you absolutely must read:

```js
const appointmentQuery = query(
  collection(db, 'users', patient.id, 'appointments'),
  orderBy('datetime', 'asc'),
  limit(2)
);
```

Safe clear-history behavior:
- either delete only the most recent visible window
- or move full-history deletion to a backend tool
- do not `getDocs(historyCollectionRef)` from the UI with no cap

---

### 6. Call contexts leak nested `onSnapshot` listeners

Files:
- `src/context/CallContext.jsx:162-176`
- `src/context/CallContext.jsx:232-248`
- `src/context/CallContext.jsx:290-294`
- `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/context/CallContext.web.js:54-73`
- `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/context/CallContext.web.js:200-218`
- `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/context/CallContext.web.js:262-268`

Problems:

1. Incoming-call listener is replaced without guaranteed cleanup in the web CRC context:
- `src/context/CallContext.jsx:162-176`

2. `startCall()` creates `onSnapshot()` listeners for:
- call document
- answerCandidates

and never stores the unsubscribe functions:
- `src/context/CallContext.jsx:232-248`

3. `answerCall()` creates another `onSnapshot()` over `offerCandidates` and never cleans it:
- `src/context/CallContext.jsx:290-294`

The same leak pattern exists in:
- `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/context/CallContext.web.js:200-218`
- `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/context/CallContext.web.js:262-268`

Why this is dangerous:
- Every new call can leave behind one or more live listeners.
- Over repeated usage, reads continue even after the UI appears idle.

Safe replacement pattern:

```js
const unsubscribeSessionRefs = useRef([]);

const clearSessionListeners = () => {
  unsubscribeSessionRefs.current.forEach((unsubscribe) => {
    try {
      unsubscribe?.();
    } catch (error) {
      console.error('Call listener cleanup failed:', error);
    }
  });
  unsubscribeSessionRefs.current = [];
};

const registerSessionListener = (unsubscribe) => {
  unsubscribeSessionRefs.current.push(unsubscribe);
};

// inside startCall
registerSessionListener(
  onSnapshot(callDocRef, (snapshot) => {
    const data = snapshot.data();
    if (!pc.currentRemoteDescription && data?.answer) {
      const answerDescription = new RTCSessionDescription(data.answer);
      pc.setRemoteDescription(answerDescription).then(() => {
        candidateQueue.current.forEach((candidate) => pc.addIceCandidate(candidate).catch(console.error));
        candidateQueue.current = [];
      });
      updateStatus('active');
    }
  })
);

registerSessionListener(
  onSnapshot(collection(callDocRef, 'answerCandidates'), (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        addCandidateToPC(new RTCIceCandidate(change.doc.data()));
      }
    });
  })
);

// call clearSessionListeners() inside endCall and before creating a new session
```

This is a true listener-leak class bug, not just a query optimization problem.

---

### 7. Unbounded per-patient history listeners exist all over the patient surfaces

Files:
- `src/services/alertService.js:52-57`
- `src/services/alertService.js:188-193`
- `src/services/appointmentService.js:21-27`
- `src/services/trialTemplateService.js:254-270`
- `src/pages/CRCHome.jsx:331-336`
- `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/alertService.js:26-31`
- `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/alertService.js:154-159`
- `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/appointmentService.js:21-27`
- `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/eproService.js:328-341`
- `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/sideEffectService.js:160-173`
- `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/pages/PatientHome.js:69-76`

Problem:
- Histories and per-user timelines are subscribed with no upper bound.
- These are long-lived pages where historical rows only grow over time.

Safe replacement patterns:

Alerts history:

```js
export const subscribeToAlertHistory = (userId, onUpdate, onError) => {
  const q = query(
    collection(db, 'users', userId, 'alerts'),
    orderBy('timestamp', 'desc'),
    limit(20)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      onUpdate(snapshot.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() })));
    },
    onError
  );
};
```

Chat messages:

```js
export const subscribeToChat = (alertRef, onUpdate, onError) => {
  const q = query(
    collection(alertRef, 'messages'),
    orderBy('timestamp', 'asc'),
    limit(100)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      onUpdate(snapshot.docs.map((d) => d.data()));
    },
    onError
  );
};
```

Appointments:

```js
export const subscribeToAppointments = (userId, onUpdate, onError) => {
  const q = query(
    collection(db, 'users', userId, 'appointments'),
    orderBy('datetime', 'asc'),
    limit(20)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      onUpdate(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    },
    onError
  );
};
```

ePRO submissions:

```js
export function subscribeToEproSubmissions(userId, onUpdate, onError) {
  const eproQuery = query(
    collection(db, 'users', userId, 'epro_submissions'),
    orderBy('updated_at', 'desc'),
    limit(20)
  );

  return onSnapshot(
    eproQuery,
    (snapshot) => {
      onUpdate(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    },
    onError
  );
}
```

Side effect reports:

```js
export function subscribeToSideEffectReports(userId, onUpdate, onError) {
  const reportsQuery = query(
    collection(db, 'users', userId, 'side_effect_reports'),
    orderBy('submitted_at', 'desc'),
    limit(20)
  );

  return onSnapshot(
    reportsQuery,
    (snapshot) => {
      onUpdate(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    },
    onError
  );
}
```

---

### 8. Protocol and user maintenance flows still contain unbounded collection reads

Files:
- `src/components/ProtocolManager.jsx:274-275`
- `src/components/ProtocolManager.jsx:482-483`
- `src/services/trialTemplateService.js:254-270`
- `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/trialTemplateService.js:293-310`

Problem:
- Some admin paths still query all matching users or all protocols without limits.
- These are not the most likely cause of the 3.3M read spike, but they still violate the safe-query rule.

Examples:
- deleting a protocol reads all assigned users with no `limit()`
- saving a protocol reads all assigned users with no `limit()`
- protocol template subscription reads all protocols live with no cap

Recommendation:
- for admin mutation flows, move mass reassignment to a backend function
- for UI list rendering, cap protocol list to `limit(20)`
- if more rows are needed, paginate

Safe protocol subscription:

```js
export function subscribeToTrialTemplates(onUpdate, onError) {
  const templatesQuery = query(
    collection(db, 'protocols'),
    orderBy('uploadedAt', 'desc'),
    limit(20)
  );

  return onSnapshot(
    templatesQuery,
    (snapshot) => {
      onUpdate(
        snapshot.docs.map((entry) => {
          const data = entry.data();
          return {
            id: entry.id,
            ...data,
            vital_templates: coerceVitalTemplates(data.vital_templates, data.monitoredVitals),
          };
        })
      );
    },
    onError
  );
}
```

For protocol delete/save fan-out:
- do not iterate directly from the browser over unbounded user query results
- use a backend worker or chunked pagination

---

### 9. Deprecated root patient web screen still has listener churn

File:
- `src/pages/PatientHome.jsx:48-74`

Problem:
- The effect depends on `triggerReason`, so changing that value tears down and recreates:
  - user doc listener
  - vitals history listener
  - appointment listener
  - alerts listener

Why this matters:
- AGENTS says the patient web screens under the root web app are deprecated reference paths.
- Even if this screen is not primary anymore, if it is still reachable, it creates unnecessary listener churn.

Safe replacement:
- remove `triggerReason` from the effect dependency array
- open the widget in a separate effect

Safe split:

```js
useEffect(() => {
  const unsubUser = onSnapshot(doc(db, 'users', user.uid), ...);
  const unsubHistory = onSnapshot(
    query(collection(db, 'users', user.uid, 'vitals'), orderBy('timestamp', 'desc'), limit(20)),
    ...
  );
  const unsubAppt = subscribeToAppointments(user.uid, setAppointments);
  const unsubAlerts = subscribeToAlertHistory(user.uid, setAllAlerts);

  return () => {
    unsubUser();
    unsubHistory();
    unsubAppt();
    unsubAlerts();
  };
}, [user.uid]);

useEffect(() => {
  if (triggerReason) {
    setWidgetOpen(true);
  }
}, [triggerReason]);
```

---

## Checkpoint-by-Checkpoint Assessment

### Checkpoint 1: `onSnapshot` leak or runaway listener

Confirmed high-confidence issues:
- `src/context/CallContext.jsx`
- `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/context/CallContext.web.js`
- `src/pages/PatientHome.jsx` listener churn due to wrong dependency choice

Confirmed safe patterns already present in many places:
- several `useEffect(..., [])` listeners do return unsubscribe properly
- many per-doc listeners are correctly scoped to one document

Conclusion:
- There is not one universal `onSnapshot in render` mistake everywhere.
- The real listener bug is the WebRTC call context and a few dependency-driven resubscribe patterns.

### Checkpoint 2: Unbounded collection scans

Confirmed and widespread.

This is the biggest class of issue in the current frontend:
- global `collectionGroup` listeners
- unbounded per-user timeline listeners
- client fan-out `getDocs` loops
- protocol/user admin queries without caps

Conclusion:
- This is the most likely primary cause class behind the read storm.

### Checkpoint 3: Retry storm on `permission-denied`

High-confidence finding:
- I did not find a clear, direct, repeated `permission-denied -> setState -> rerun query -> permission-denied` loop in the reviewed active files.

What I did find:
- many catch blocks log and continue
- some catch blocks set benign fallback state
- none of the major read-heavy codepaths appear to be driven primarily by permission-denied retry recursion

Conclusion:
- The evidence points much more strongly to read amplification from live listeners and unbounded scans than to a permission-denied retry storm.

Still recommended guard:

```js
function isPermissionDenied(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return code.includes('permission-denied') || message.includes('permission denied');
}

async function safeFirestoreCall(run, { onDenied } = {}) {
  try {
    return await run();
  } catch (error) {
    if (isPermissionDenied(error)) {
      console.error('Firestore permission denied:', error);
      onDenied?.(error);
      return null;
    }
    throw error;
  }
}
```

Rule:
- on permission denied, do not set state that re-enters the same fetching effect
- do not auto-retry
- do not toggle a dependency used by the query effect

---

## Highest-Priority Fix Order

If Codex only fixes a few files first, the recommended order is:

1. `src/pages/CRCHome.jsx`
2. `src/services/alertService.js`
3. `src/services/dropoutService.js`
4. `src/services/incidentService.js`
5. `src/components/GeminiChatbot.jsx`
6. `src/context/CallContext.jsx`
7. `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/components/GeminiChatbot.js`
8. `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/alertService.js`
9. `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/context/CallContext.web.js`
10. `src/pages/HistoryPage.jsx`

That order targets the biggest likely read multipliers first.

---

## Concrete “Do Not Allow” Rules For The Fix Pass

Codex should enforce these rules while patching:

1. No client-side `collectionGroup` listener without a hard cap
2. No UI list query without `limit(20)` unless there is explicit pagination
3. No chat / history listener without a hard cap
4. No multi-patient fan-out reads inside chatbot UI code
5. No nested `onSnapshot` without storing and cleaning the unsubscribe handle
6. No `permission-denied` catch path that updates state used to trigger the same query again

---

## Final Judgment

The current frontend can absolutely create a read storm even if no backend publisher is running.

The highest-confidence explanation is:

- global CRC dashboard listeners
- global alert / ePRO / dropout / incident collection-group scans
- uncapped histories
- listener leaks in call contexts
- chatbot fan-out reads

This is not a single isolated mistake. It is a systemic frontend Firestore query safety problem.

If you want the immediate short version to give Codex, it is this:

> The main bug is not one loop. The main bug class is unbounded client listeners and collection scans. Fix global `collectionGroup` listeners first, cap every UI list query with `limit(20)`, cap all histories, remove client-side multi-patient fan-out reads from chatbot code, and clean nested call-context `onSnapshot` listeners.

