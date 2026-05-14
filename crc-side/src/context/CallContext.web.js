import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { auth, db } from '../firebase';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

const CallContext = createContext(null);

export const useCall = () => useContext(CallContext);

const servers = {
  iceServers: [
    { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ],
};

export const CallProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [callStatus, setCallStatus] = useState('idle');
  const [callType, setCallType] = useState('audio');
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [callDocId, setCallDocId] = useState(null);
  const [otherUserName, setOtherUserName] = useState('');

  const peerConnection = useRef(null);
  const localStreamRef = useRef(null);
  const unsubscribeActiveCallRef = useRef(null);
  const unsubscribeAnswerListenerRef = useRef(null);
  const unsubscribeAnswerCandidatesRef = useRef(null);
  const unsubscribeOfferCandidatesRef = useRef(null);
  const statusRef = useRef('idle');
  const candidateQueue = useRef([]);

  const updateStatus = useCallback((status) => {
    statusRef.current = status;
    setCallStatus(status);
  }, []);

  const addCandidateToPC = (candidate) => {
    const pc = peerConnection.current;
    if (pc && pc.remoteDescription && pc.remoteDescription.type) {
      pc.addIceCandidate(candidate).catch((error) => console.error(error));
    } else {
      candidateQueue.current.push(candidate);
    }
  };

  const clearNegotiationListeners = useCallback(() => {
    if (unsubscribeAnswerListenerRef.current) {
      unsubscribeAnswerListenerRef.current();
      unsubscribeAnswerListenerRef.current = null;
    }
    if (unsubscribeAnswerCandidatesRef.current) {
      unsubscribeAnswerCandidatesRef.current();
      unsubscribeAnswerCandidatesRef.current = null;
    }
    if (unsubscribeOfferCandidatesRef.current) {
      unsubscribeOfferCandidatesRef.current();
      unsubscribeOfferCandidatesRef.current = null;
    }
  }, []);

  const listenForIncomingCalls = useCallback((uid) => {
    if (unsubscribeActiveCallRef.current) {
      unsubscribeActiveCallRef.current();
    }

    const signalDoc = doc(db, 'users', uid, 'active_call', 'current');
    unsubscribeActiveCallRef.current = onSnapshot(signalDoc, (snapshot) => {
      const data = snapshot.data();
      if (!data) return;
      if (data.callerId === uid) return;
      if (statusRef.current === 'calling' || statusRef.current === 'active') return;

      if (data.type === 'offer') {
        setCallDocId(data.callId);
        setOtherUserName(data.callerName || 'Unknown');
        setCallType(data.callType || 'audio');
        updateStatus('incoming');
      }
    });
  }, [updateStatus]);

  const endCall = useCallback(async (notifyOthers = true) => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (peerConnection.current) {
      peerConnection.current.close();
    }
    clearNegotiationListeners();

    setLocalStream(null);
    setRemoteStream(null);
    localStreamRef.current = null;
    peerConnection.current = null;
    updateStatus('idle');
    candidateQueue.current = [];

    const currentCallDocId = callDocId;
    setCallDocId(null);

    if (notifyOthers && currentCallDocId) {
      try {
        await updateDoc(doc(db, 'calls', currentCallDocId), { status: 'ended' });
      } catch {
        // Ignore if call doc already closed.
      }
    }

    if (user?.uid) {
      try {
        await deleteDoc(doc(db, 'users', user.uid, 'active_call', 'current'));
      } catch {
        // Ignore cleanup failures.
      }
    }
  }, [callDocId, clearNegotiationListeners, updateStatus, user]);

  useEffect(() => {
    const unsubscribeAuth = auth.onAuthStateChanged(async (nextUser) => {
      setUser(nextUser);
      if (nextUser?.uid) {
        try {
          await deleteDoc(doc(db, 'users', nextUser.uid, 'active_call', 'current'));
        } catch {
          // Ignore cleanup failures.
        }
        listenForIncomingCalls(nextUser.uid);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeActiveCallRef.current) {
        unsubscribeActiveCallRef.current();
        unsubscribeActiveCallRef.current = null;
      }
      clearNegotiationListeners();
    };
  }, [clearNegotiationListeners, listenForIncomingCalls]);

  useEffect(() => {
    let unsubscribeCallDoc = null;
    if (callDocId) {
      unsubscribeCallDoc = onSnapshot(doc(db, 'calls', callDocId), (snapshot) => {
        const data = snapshot.data();
        if (!data || data.status === 'ended') {
          if (statusRef.current !== 'idle') endCall(false);
        }
      });
    }

    return () => {
      if (unsubscribeCallDoc) unsubscribeCallDoc();
    };
  }, [callDocId, endCall]);

  const buildConstraints = (isVideo) => ({
    audio: true,
    video: isVideo ? { width: 1280, height: 720 } : false,
  });

  const startCall = async (calleeId, calleeName, isVideo = false) => {
    if (!user?.uid) throw new Error('Patient call requires an authenticated user.');
    if (!calleeId) throw new Error('CRC target is not configured for this patient.');
    if (calleeId === user.uid) throw new Error('Cannot call the current user.');

    updateStatus('calling');
    setOtherUserName(calleeName || 'CRC');
    setCallType(isVideo ? 'video' : 'audio');
    candidateQueue.current = [];
    clearNegotiationListeners();

    const stream = await navigator.mediaDevices.getUserMedia(buildConstraints(isVideo));
    setLocalStream(stream);
    localStreamRef.current = stream;

    const pc = new RTCPeerConnection(servers);
    peerConnection.current = pc;
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    pc.ontrack = (event) => {
      if (event.streams[0]) setRemoteStream(event.streams[0]);
    };

    const callDocRef = await addDoc(collection(db, 'calls'), {
      callerId: user.uid,
      callerName: user.email?.split('@')[0] || 'patient',
      calleeId,
      calleeName: calleeName || 'CRC',
      status: 'offering',
      callType: isVideo ? 'video' : 'audio',
      timestamp: new Date().toISOString(),
    });
    setCallDocId(callDocRef.id);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        addDoc(collection(callDocRef, 'offerCandidates'), event.candidate.toJSON());
      }
    };

    const offerDescription = await pc.createOffer();
    await pc.setLocalDescription(offerDescription);
    await updateDoc(callDocRef, {
      offer: {
        sdp: offerDescription.sdp,
        type: offerDescription.type,
      },
    });

    await setDoc(doc(db, 'users', calleeId, 'active_call', 'current'), {
      type: 'offer',
      callerName: user.email?.split('@')[0] || 'patient',
      callerId: user.uid,
      callType: isVideo ? 'video' : 'audio',
      callId: callDocRef.id,
    });

    unsubscribeAnswerListenerRef.current = onSnapshot(callDocRef, (snapshot) => {
      const data = snapshot.data();
      if (!pc.currentRemoteDescription && data?.answer) {
        const answerDescription = new RTCSessionDescription(data.answer);
        pc.setRemoteDescription(answerDescription).then(() => {
          candidateQueue.current.forEach((candidate) => pc.addIceCandidate(candidate).catch(console.error));
          candidateQueue.current = [];
        });
        updateStatus('active');
      }
    });

    unsubscribeAnswerCandidatesRef.current = onSnapshot(collection(callDocRef, 'answerCandidates'), (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          addCandidateToPC(new RTCIceCandidate(change.doc.data()));
        }
      });
    });
  };

  const answerCall = async () => {
    if (!callDocId) return;

    updateStatus('active');
    candidateQueue.current = [];
    clearNegotiationListeners();

    const callDocRef = doc(db, 'calls', callDocId);
    const callSnapshot = await getDoc(callDocRef);
    const callData = callSnapshot.data();
    const isVideo = callData?.callType === 'video';
    setCallType(isVideo ? 'video' : 'audio');

    const stream = await navigator.mediaDevices.getUserMedia(buildConstraints(isVideo));
    setLocalStream(stream);
    localStreamRef.current = stream;

    const pc = new RTCPeerConnection(servers);
    peerConnection.current = pc;
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    pc.ontrack = (event) => {
      if (event.streams[0]) setRemoteStream(event.streams[0]);
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        addDoc(collection(callDocRef, 'answerCandidates'), event.candidate.toJSON());
      }
    };

    await pc.setRemoteDescription(new RTCSessionDescription(callData.offer));
    candidateQueue.current.forEach((candidate) => pc.addIceCandidate(candidate).catch(console.error));
    candidateQueue.current = [];

    const answerDescription = await pc.createAnswer();
    await pc.setLocalDescription(answerDescription);
    await updateDoc(callDocRef, {
      answer: {
        type: answerDescription.type,
        sdp: answerDescription.sdp,
      },
    });

    unsubscribeOfferCandidatesRef.current = onSnapshot(collection(callDocRef, 'offerCandidates'), (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          addCandidateToPC(new RTCIceCandidate(change.doc.data()));
        }
      });
    });
  };

  return (
    <CallContext.Provider
      value={{
        user,
        callStatus,
        callType,
        localStream,
        remoteStream,
        otherUserName,
        startCall,
        answerCall,
        endCall,
      }}
    >
      {children}
    </CallContext.Provider>
  );
};
