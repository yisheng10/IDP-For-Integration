import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { db, auth } from '../firebase';
import { 
  collection, addDoc, onSnapshot, doc, updateDoc, setDoc, deleteDoc, getDoc 
} from 'firebase/firestore';

const CallContext = createContext();

export const useCall = () => useContext(CallContext);

export const CallProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [callStatus, setCallStatus] = useState('idle'); 
  const [callType, setCallType] = useState('audio'); 
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [callDocId, setCallDocId] = useState(null);
  const [otherUserName, setOtherUserName] = useState('');

  // --- DEVICE STATES ---
  const [devices, setDevices] = useState([]);
  const [selectedAudioInput, setSelectedAudioInput] = useState('');
  const [selectedVideoInput, setSelectedVideoInput] = useState('');
  const [selectedAudioOutput, setSelectedAudioOutput] = useState('');

  const peerConnection = useRef(null);
  const localStreamRef = useRef(null);
  const unsubscribeCallRef = useRef(null);
  const unsubscribeAnswerListenerRef = useRef(null);
  const unsubscribeAnswerCandidatesRef = useRef(null);
  const unsubscribeOfferCandidatesRef = useRef(null);
  
  const statusRef = useRef('idle'); 
  const prevStatusRef = useRef('idle'); // Track history for sound transitions

  const candidateQueue = useRef([]); 

  const clearNegotiationListeners = () => {
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
  };

  // --- SHORT NOTIFICATION SOUNDS (Managed Here) ---
  // Ringtone/Ringback are now in CallOverlay for better reliability
  const answerRef = useRef(new Audio('/sounds/answered.mp3'));
  const endedRef = useRef(new Audio('/sounds/ended.mp3'));

  const servers = {
    iceServers: [
      { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ],
  };

  const updateStatus = useCallback((status) => {
    prevStatusRef.current = statusRef.current; 
    statusRef.current = status;
    setCallStatus(status);
  }, []);

  const addCandidateToPC = useCallback((candidate) => {
    const pc = peerConnection.current;
    if (pc && pc.remoteDescription && pc.remoteDescription.type) {
      pc.addIceCandidate(candidate).catch(e => console.error(e));
    } else {
      candidateQueue.current.push(candidate);
    }
  }, []);

  const listenForIncomingCalls = useCallback((uid) => {
    const signalDoc = doc(db, 'users', uid, 'active_call', 'current');
    if (unsubscribeCallRef.current) {
      unsubscribeCallRef.current();
      unsubscribeCallRef.current = null;
    }
    unsubscribeCallRef.current = onSnapshot(signalDoc, async (snapshot) => {
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
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach((track) => track.stop());
    if (peerConnection.current) peerConnection.current.close();
    clearNegotiationListeners();

    setLocalStream(null);
    setRemoteStream(null);
    localStreamRef.current = null;
    peerConnection.current = null;
    
    updateStatus('idle'); 
    setCallDocId(null);
    candidateQueue.current = [];

    if (notifyOthers && callDocId) {
      try {
        await updateDoc(doc(db, 'calls', callDocId), { status: 'ended' });
        if (user?.uid) await deleteDoc(doc(db, 'users', user.uid, 'active_call', 'current'));
      } catch {
        // Ignore cleanup failures.
      }
    }
  }, [callDocId, updateStatus, user]);

  useEffect(() => {
    answerRef.current.loop = false;
    endedRef.current.loop = false;

    const unsubAuth = auth.onAuthStateChanged(async (u) => {
      setUser(u);
      if (u) {
        try {
          if (u.uid) await deleteDoc(doc(db, 'users', u.uid, 'active_call', 'current'));
        } catch {
          // Ignore cleanup failures.
        }
        listenForIncomingCalls(u.uid);
      }
    });

    navigator.mediaDevices.enumerateDevices().then(setDevices).catch(console.error);
    navigator.mediaDevices.addEventListener('devicechange', () => {
      navigator.mediaDevices.enumerateDevices().then(setDevices).catch(console.error);
    });

    return () => {
      unsubAuth();
      if (unsubscribeCallRef.current) {
        unsubscribeCallRef.current();
        unsubscribeCallRef.current = null;
      }
      clearNegotiationListeners();
    };
  }, [listenForIncomingCalls]);

  useEffect(() => {
    const curr = callStatus;
    const prev = prevStatusRef.current;

    const playSound = (audioRef) => {
      if (selectedAudioOutput && typeof audioRef.current.setSinkId === 'function') {
        audioRef.current.setSinkId(selectedAudioOutput).catch(e => console.warn(e));
      }
      audioRef.current.volume = 1.0; 
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(e => console.warn("Audio blocked (User Interaction Required):", e));
    };

    if (curr === 'active' && prev !== 'active') {
      playSound(answerRef);
    } else if (curr === 'idle' && prev !== 'idle') {
      playSound(endedRef);
    }

    prevStatusRef.current = curr;
  }, [callStatus, selectedAudioOutput]);

  const switchAudioInput = async (deviceId) => {
    setSelectedAudioInput(deviceId);
    if ((callStatus === 'active' || callStatus === 'calling') && localStreamRef.current) {
        try {
           const newStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
           const newTrack = newStream.getAudioTracks()[0];
           const oldTrack = localStreamRef.current.getAudioTracks()[0];
           if (oldTrack) { localStreamRef.current.removeTrack(oldTrack); oldTrack.stop(); }
           localStreamRef.current.addTrack(newTrack);
           setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
           if (peerConnection.current) {
               const sender = peerConnection.current.getSenders().find(s => s.track.kind === 'audio');
               if (sender) sender.replaceTrack(newTrack);
           }
        } catch (e) { console.error("Mic Switch Error", e); }
    }
  };

  const switchVideoInput = async (deviceId) => {
    setSelectedVideoInput(deviceId);
    if ((callStatus === 'active' || callStatus === 'calling') && callType === 'video' && localStreamRef.current) {
        try {
           const newStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId }, width: 1280, height: 720 } });
           const newTrack = newStream.getVideoTracks()[0];
           const oldTrack = localStreamRef.current.getVideoTracks()[0];
           if (oldTrack) { localStreamRef.current.removeTrack(oldTrack); oldTrack.stop(); }
           localStreamRef.current.addTrack(newTrack);
           setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
           if (peerConnection.current) {
               const sender = peerConnection.current.getSenders().find(s => s.track.kind === 'video');
               if (sender) sender.replaceTrack(newTrack);
           }
        } catch (e) { console.error("Cam Switch Error", e); }
    }
  };

  // --- GLOBAL CALL MONITOR ---
  useEffect(() => {
    let unsubCallDoc = null;
    if (callDocId) {
      unsubCallDoc = onSnapshot(doc(db, 'calls', callDocId), (snapshot) => {
        const data = snapshot.data();
        if (!data || data.status === 'ended') {
          if (statusRef.current !== 'idle') endCall(false);
        }
      });
    }
    return () => { if (unsubCallDoc) unsubCallDoc(); };
  }, [callDocId, endCall]);

  // --- START CALL ---
  const startCall = async (calleeId, calleeName, isVideo = false) => {
    if (!calleeId) return alert("User ID missing.");
    if (calleeId === user.uid) return alert("Cannot call yourself.");

    updateStatus('calling'); 
    setOtherUserName(calleeName);
    setCallType(isVideo ? 'video' : 'audio');
    candidateQueue.current = [];
    clearNegotiationListeners();

    const constraints = {
        audio: selectedAudioInput ? { deviceId: { exact: selectedAudioInput } } : true,
        video: isVideo ? (selectedVideoInput ? { deviceId: { exact: selectedVideoInput }, width: 1280, height: 720 } : { width: 1280, height: 720 }) : false
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    setLocalStream(stream);
    localStreamRef.current = stream;

    const pc = new RTCPeerConnection(servers);
    peerConnection.current = pc;
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.ontrack = (event) => { if (event.streams[0]) setRemoteStream(event.streams[0]); };

    const callDocRef = await addDoc(collection(db, 'calls'), {
      callerId: user.uid,
      callerName: user.email.split('@')[0], 
      calleeId: calleeId,
      calleeName: calleeName,
      status: 'offering',
      callType: isVideo ? 'video' : 'audio', 
      timestamp: new Date().toISOString()
    });
    setCallDocId(callDocRef.id);

    pc.onicecandidate = (event) => {
      if (event.candidate) addDoc(collection(callDocRef, 'offerCandidates'), event.candidate.toJSON());
    };

    const offerDescription = await pc.createOffer();
    await pc.setLocalDescription(offerDescription);

    await updateDoc(callDocRef, { offer: { sdp: offerDescription.sdp, type: offerDescription.type } });

    await setDoc(doc(db, 'users', calleeId, 'active_call', 'current'), {
      type: 'offer',
      callerName: user.email.split('@')[0],
      callerId: user.uid,
      callType: isVideo ? 'video' : 'audio', 
      callId: callDocRef.id
    });

    unsubscribeAnswerListenerRef.current = onSnapshot(callDocRef, (snapshot) => {
      const data = snapshot.data();
      if (!pc.currentRemoteDescription && data?.answer) {
        const answerDescription = new RTCSessionDescription(data.answer);
        pc.setRemoteDescription(answerDescription).then(() => {
           candidateQueue.current.forEach(c => pc.addIceCandidate(c).catch(console.error));
           candidateQueue.current = [];
        });
        updateStatus('active'); 
      }
    });

    unsubscribeAnswerCandidatesRef.current = onSnapshot(collection(callDocRef, 'answerCandidates'), (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') addCandidateToPC(new RTCIceCandidate(change.doc.data()));
      });
    });
  };

  // --- ANSWER CALL ---
  const answerCall = async () => {
    updateStatus('active'); 
    candidateQueue.current = [];
    clearNegotiationListeners();

    const callDocRef = doc(db, 'calls', callDocId);
    const callSnap = await getDoc(callDocRef);
    const callData = callSnap.data();
    if (callData?.signalingMode === 'native-placeholder' || !callData?.offer) {
      setCallType(callData?.callType || 'audio');
      setLocalStream(null);
      setRemoteStream(null);
      await updateDoc(callDocRef, {
        status: 'active',
        acceptedAt: new Date().toISOString(),
        acceptedBy: user?.uid || null,
      });
      if (user?.uid) {
        await deleteDoc(doc(db, 'users', user.uid, 'active_call', 'current')).catch(() => {});
      }
      return;
    }
    
    const isVideo = callData.callType === 'video';
    setCallType(callData.callType);

    const constraints = {
        audio: selectedAudioInput ? { deviceId: { exact: selectedAudioInput } } : true,
        video: isVideo ? (selectedVideoInput ? { deviceId: { exact: selectedVideoInput }, width: 1280, height: 720 } : { width: 1280, height: 720 }) : false
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    setLocalStream(stream);
    localStreamRef.current = stream;

    const pc = new RTCPeerConnection(servers);
    peerConnection.current = pc;
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.ontrack = (event) => { if (event.streams[0]) setRemoteStream(event.streams[0]); };
    pc.onicecandidate = (event) => {
      if (event.candidate) addDoc(collection(callDocRef, 'answerCandidates'), event.candidate.toJSON());
    };

    await pc.setRemoteDescription(new RTCSessionDescription(callData.offer));
    candidateQueue.current.forEach(c => pc.addIceCandidate(c).catch(console.error));
    candidateQueue.current = [];

    const answerDescription = await pc.createAnswer();
    await pc.setLocalDescription(answerDescription);

    await updateDoc(callDocRef, {
      answer: { type: answerDescription.type, sdp: answerDescription.sdp },
      status: 'active',
      acceptedAt: new Date().toISOString(),
      acceptedBy: user?.uid || null,
    });
    if (user?.uid) {
      await deleteDoc(doc(db, 'users', user.uid, 'active_call', 'current')).catch(() => {});
    }

    unsubscribeOfferCandidatesRef.current = onSnapshot(collection(callDocRef, 'offerCandidates'), (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') addCandidateToPC(new RTCIceCandidate(change.doc.data()));
      });
    });
  };

  return (
    <CallContext.Provider value={{ 
        user, callStatus, callType, startCall, answerCall, endCall, 
        localStream, remoteStream, otherUserName,
        devices, selectedAudioInput, selectedVideoInput, selectedAudioOutput,
        switchAudioInput, switchVideoInput, setSelectedAudioOutput
    }}>
      {children}
    </CallContext.Provider>
  );
};
