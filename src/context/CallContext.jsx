import { Room, RoomEvent, Track } from 'livekit-client';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
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
import { auth, db } from '../firebase';
import { fetchLiveKitCallToken } from '../services/liveKitCallService';

/* eslint-disable react-refresh/only-export-components */
const CallContext = createContext();

export const useCall = () => useContext(CallContext);

function streamFromTracks(tracks) {
  const mediaTracks = tracks
    .map((track) => track?.mediaStreamTrack)
    .filter(Boolean);
  return mediaTracks.length ? new MediaStream(mediaTracks) : null;
}

function getDisplayName(currentUser, fallback = 'TrialLight user') {
  return currentUser?.displayName || currentUser?.email?.split('@')[0] || fallback;
}

export const CallProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [callStatus, setCallStatus] = useState('idle');
  const [callType, setCallType] = useState('audio');
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [callDocId, setCallDocId] = useState(null);
  const [otherUserName, setOtherUserName] = useState('');
  const [devices, setDevices] = useState([]);
  const [selectedAudioInput, setSelectedAudioInput] = useState('');
  const [selectedVideoInput, setSelectedVideoInput] = useState('');
  const [selectedAudioOutput, setSelectedAudioOutput] = useState('');
  const [isMicrophoneMuted, setIsMicrophoneMuted] = useState(false);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);

  const liveKitRoomRef = useRef(null);
  const remoteTracksRef = useRef([]);
  const unsubscribeActiveCallRef = useRef(null);
  const unsubscribeCallDocRef = useRef(null);
  const statusRef = useRef('idle');
  const callDocIdRef = useRef(null);
  const otherUserIdRef = useRef(null);
  const callTypeRef = useRef('audio');
  const prevStatusRef = useRef('idle');
  const playEndedSoundRef = useRef(false);

  const answerRef = useRef(new Audio('/sounds/answered.mp3'));
  const endedRef = useRef(new Audio('/sounds/ended.mp3'));

  const updateStatus = useCallback((status) => {
    prevStatusRef.current = statusRef.current;
    statusRef.current = status;
    setCallStatus(status);
  }, []);

  const syncLocalTracks = useCallback((room) => {
    const tracks = Array.from(room?.localParticipant?.trackPublications?.values?.() || [])
      .map((publication) => publication?.track)
      .filter(Boolean);
    setLocalStream(streamFromTracks(tracks));
  }, []);

  const syncRemoteTracks = useCallback((room) => {
    const tracks = [];
    const participants = Array.from(room?.remoteParticipants?.values?.() || []);
    participants.forEach((participant) => {
      Array.from(participant?.trackPublications?.values?.() || []).forEach((publication) => {
        const track = publication?.track || publication?.audioTrack || publication?.videoTrack;
        if (publication?.isSubscribed && track) tracks.push(track);
      });
    });
    remoteTracksRef.current = tracks;
    setRemoteStream(streamFromTracks(tracks));
  }, []);

  const clearCallDocListener = useCallback(() => {
    if (unsubscribeCallDocRef.current) {
      unsubscribeCallDocRef.current();
      unsubscribeCallDocRef.current = null;
    }
  }, []);

  const disconnectLiveKitRoom = useCallback(async () => {
    const room = liveKitRoomRef.current;
    liveKitRoomRef.current = null;
    remoteTracksRef.current = [];
    setLocalStream(null);
    setRemoteStream(null);
    if (room) {
      try {
        await room.disconnect();
      } catch {
        // Ignore room cleanup failures.
      }
      room.removeAllListeners();
    }
  }, []);

  const resetCallControls = useCallback((isVideo = false) => {
    setIsMicrophoneMuted(false);
    setIsCameraEnabled(Boolean(isVideo));
  }, []);

  const attachCallDocListener = useCallback((nextCallDocId) => {
    clearCallDocListener();
    if (!nextCallDocId) return;

    unsubscribeCallDocRef.current = onSnapshot(doc(db, 'calls', nextCallDocId), (snapshot) => {
      const data = snapshot.data();
      if (!data || data.status === 'ended') {
        if (statusRef.current !== 'idle') {
          playEndedSoundRef.current = true;
          disconnectLiveKitRoom();
          resetCallControls(false);
          updateStatus('idle');
        }
        const cleanupIds = [
          auth.currentUser?.uid,
          user?.uid,
          data?.callerId,
          data?.calleeId,
          otherUserIdRef.current,
        ].filter(Boolean);
        Promise.all(
          [...new Set(cleanupIds)].map((uid) => deleteDoc(doc(db, 'users', uid, 'active_call', 'current')).catch(() => {}))
        );
        callDocIdRef.current = null;
        otherUserIdRef.current = null;
        setCallDocId(null);
        setOtherUserName('');
        return;
      }

      if (data.callType === 'audio' || data.callType === 'video') {
        callTypeRef.current = data.callType;
        setCallType(data.callType);
        setIsCameraEnabled(data.callType === 'video');
      }

      if (data.status === 'active' || data.status === 'accepted' || data.acceptedAt) {
        updateStatus('active');
      }
    });
  }, [clearCallDocListener, disconnectLiveKitRoom, resetCallControls, updateStatus, user]);

  const connectLiveKitRoom = useCallback(async ({ nextCallDocId, displayName, isVideo, activateOnConnect = false }) => {
    await disconnectLiveKitRoom();
    const liveKitSession = await fetchLiveKitCallToken({
      callId: nextCallDocId,
      displayName,
    });
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });

    liveKitRoomRef.current = room;
    remoteTracksRef.current = [];

    room.on(RoomEvent.LocalTrackPublished, () => {
      syncLocalTracks(room);
    });
    room.on(RoomEvent.LocalTrackUnpublished, () => {
      syncLocalTracks(room);
    });
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind !== Track.Kind.Audio && track.kind !== Track.Kind.Video) return;
      syncRemoteTracks(room);
    });
    room.on(RoomEvent.TrackUnsubscribed, () => {
      syncRemoteTracks(room);
    });
    room.on(RoomEvent.ParticipantDisconnected, () => {
      syncRemoteTracks(room);
    });
    room.on(RoomEvent.Disconnected, () => {
      if (statusRef.current !== 'idle') updateStatus('idle');
      setLocalStream(null);
      setRemoteStream(null);
    });

    await room.connect(liveKitSession.livekitUrl, liveKitSession.token);
    await room.localParticipant.setMicrophoneEnabled(true, selectedAudioInput ? { deviceId: selectedAudioInput } : undefined);
    await room.localParticipant.setCameraEnabled(Boolean(isVideo), selectedVideoInput ? { deviceId: selectedVideoInput } : undefined);
    syncLocalTracks(room);
    syncRemoteTracks(room);
    resetCallControls(isVideo);

    if (activateOnConnect) {
      updateStatus('active');
    }

    return liveKitSession;
  }, [
    disconnectLiveKitRoom,
    resetCallControls,
    selectedAudioInput,
    selectedVideoInput,
    syncLocalTracks,
    syncRemoteTracks,
    updateStatus,
  ]);

  const listenForIncomingCalls = useCallback((uid) => {
    if (unsubscribeActiveCallRef.current) {
      unsubscribeActiveCallRef.current();
      unsubscribeActiveCallRef.current = null;
    }

    const signalDoc = doc(db, 'users', uid, 'active_call', 'current');
    unsubscribeActiveCallRef.current = onSnapshot(signalDoc, (snapshot) => {
      const data = snapshot.data();
      if (!data) return;
      if (data.callerId === uid) return;
      if (statusRef.current === 'calling' || statusRef.current === 'active') return;
      if (data.type !== 'offer') return;

      callDocIdRef.current = data.callId || null;
      otherUserIdRef.current = data.callerId || null;
      setCallDocId(data.callId);
      setOtherUserName(data.callerName || 'Unknown');
      callTypeRef.current = data.callType === 'video' ? 'video' : 'audio';
      setCallType(callTypeRef.current);
      resetCallControls(callTypeRef.current === 'video');
      updateStatus('incoming');
    });
  }, [resetCallControls, updateStatus]);

  const endCall = useCallback(async (notifyOthers = true) => {
    clearCallDocListener();
    await disconnectLiveKitRoom();
    resetCallControls(false);
    playEndedSoundRef.current = true;
    updateStatus('idle');

    const currentCallDocId = callDocIdRef.current || callDocId;
    const currentOtherUserId = otherUserIdRef.current;
    callDocIdRef.current = null;
    otherUserIdRef.current = null;
    setCallDocId(null);
    setOtherUserName('');

    if (notifyOthers && currentCallDocId) {
      try {
        await updateDoc(doc(db, 'calls', currentCallDocId), {
          status: 'ended',
          endedAt: new Date().toISOString(),
        });
      } catch {
        // Ignore if the call document was already closed.
      }
    }

    const cleanupIds = [user?.uid, currentOtherUserId].filter(Boolean);
    await Promise.all(
      cleanupIds.map((uid) => deleteDoc(doc(db, 'users', uid, 'active_call', 'current')).catch(() => {}))
    );
  }, [callDocId, clearCallDocListener, disconnectLiveKitRoom, resetCallControls, updateStatus, user]);

  useEffect(() => {
    answerRef.current.loop = false;
    endedRef.current.loop = false;

    const unsubscribeAuth = auth.onAuthStateChanged(async (nextUser) => {
      setUser(nextUser);
      if (nextUser?.uid) {
        listenForIncomingCalls(nextUser.uid);
      }
    });

    navigator.mediaDevices?.enumerateDevices?.().then(setDevices).catch(console.error);
    const refreshDevices = () => {
      navigator.mediaDevices?.enumerateDevices?.().then(setDevices).catch(console.error);
    };
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);

    return () => {
      unsubscribeAuth();
      navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices);
      if (unsubscribeActiveCallRef.current) {
        unsubscribeActiveCallRef.current();
        unsubscribeActiveCallRef.current = null;
      }
      clearCallDocListener();
      disconnectLiveKitRoom();
    };
  }, [clearCallDocListener, disconnectLiveKitRoom, listenForIncomingCalls]);

  useEffect(() => {
    const curr = callStatus;
    const prev = prevStatusRef.current;

    const playSound = (audioRef) => {
      if (selectedAudioOutput && typeof audioRef.current.setSinkId === 'function') {
        audioRef.current.setSinkId(selectedAudioOutput).catch((error) => console.warn(error));
      }
      audioRef.current.volume = 1;
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch((error) => console.warn('Audio blocked:', error));
    };

    if (curr === 'active' && prev !== 'active') {
      playSound(answerRef);
    } else if (curr === 'idle' && prev !== 'idle') {
      if (playEndedSoundRef.current) {
        playSound(endedRef);
      }
      playEndedSoundRef.current = false;
    }

    prevStatusRef.current = curr;
  }, [callStatus, selectedAudioOutput]);

  const startCall = async (calleeId, calleeName, isVideo = false) => {
    const currentUser = auth.currentUser || user;
    if (!currentUser?.uid) throw new Error('CRC call requires an authenticated user.');
    if (!calleeId) return alert('User ID missing.');
    if (calleeId === currentUser.uid) return alert('Cannot call yourself.');

    clearCallDocListener();
    const nextCallType = isVideo ? 'video' : 'audio';
    setOtherUserName(calleeName || 'Patient');
    setCallType(nextCallType);
    callTypeRef.current = nextCallType;
    updateStatus('calling');

    const callerName = getDisplayName(currentUser, 'CRC');
    const callDocRef = await addDoc(collection(db, 'calls'), {
      callerId: currentUser.uid,
      callerName,
      calleeId,
      calleeName: calleeName || 'Patient',
      status: 'offering',
      callType: nextCallType,
      signalingMode: 'livekit',
      timestamp: new Date().toISOString(),
    });

    callDocIdRef.current = callDocRef.id;
    otherUserIdRef.current = calleeId;
    setCallDocId(callDocRef.id);
    attachCallDocListener(callDocRef.id);

    const activeCallRef = doc(db, 'users', calleeId, 'active_call', 'current');
    await setDoc(activeCallRef, {
      type: 'offer',
      callerName,
      callerId: currentUser.uid,
      callType: nextCallType,
      callId: callDocRef.id,
      signalingMode: 'livekit',
    });

    try {
      const liveKitSession = await connectLiveKitRoom({
        nextCallDocId: callDocRef.id,
        displayName: callerName,
        isVideo,
        activateOnConnect: false,
      });

      await setDoc(activeCallRef, {
        livekitRoomName: liveKitSession.roomName,
      }, { merge: true });
    } catch (error) {
      await updateDoc(callDocRef, {
        status: 'ended',
        endedAt: new Date().toISOString(),
        endReason: 'caller-livekit-connect-failed',
      }).catch(() => {});
      await deleteDoc(activeCallRef).catch(() => {});
      resetCallControls(false);
      updateStatus('idle');
      throw error;
    }
  };

  const answerCall = async () => {
    const currentUser = auth.currentUser || user;
    const currentCallDocId = callDocIdRef.current || callDocId;
    if (!currentCallDocId) return;

    clearCallDocListener();
    const callDocRef = doc(db, 'calls', currentCallDocId);
    const callSnapshot = await getDoc(callDocRef);
    const callData = callSnapshot.data() || {};
    const nextCallType = callData.callType === 'video' ? 'video' : 'audio';
    callTypeRef.current = nextCallType;
    setCallType(nextCallType);
    otherUserIdRef.current = callData.callerId || otherUserIdRef.current;
    attachCallDocListener(currentCallDocId);

    await connectLiveKitRoom({
      nextCallDocId: currentCallDocId,
      displayName: getDisplayName(currentUser, 'CRC'),
      isVideo: nextCallType === 'video',
      activateOnConnect: true,
    });
    await updateDoc(callDocRef, {
      status: 'active',
      acceptedAt: new Date().toISOString(),
      acceptedBy: currentUser?.uid || null,
    });
    if (currentUser?.uid) {
      await deleteDoc(doc(db, 'users', currentUser.uid, 'active_call', 'current')).catch(() => {});
    }
  };

  const toggleMute = useCallback(async () => {
    const activeRoom = liveKitRoomRef.current;
    if (!activeRoom) {
      setIsMicrophoneMuted(true);
      return;
    }

    const nextMuted = !isMicrophoneMuted;
    try {
      await activeRoom.localParticipant.setMicrophoneEnabled(!nextMuted, selectedAudioInput ? { deviceId: selectedAudioInput } : undefined);
      syncLocalTracks(activeRoom);
      setIsMicrophoneMuted(nextMuted);
    } catch (error) {
      console.error('Microphone toggle failed', error);
      setIsMicrophoneMuted(true);
    }
  }, [isMicrophoneMuted, selectedAudioInput, syncLocalTracks]);

  const toggleCamera = useCallback(async () => {
    const activeRoom = liveKitRoomRef.current;
    if (!activeRoom) {
      setIsCameraEnabled(false);
      return;
    }

    const nextEnabled = !isCameraEnabled;
    const nextCallType = nextEnabled ? 'video' : 'audio';
    try {
      await activeRoom.localParticipant.setCameraEnabled(nextEnabled, selectedVideoInput ? { deviceId: selectedVideoInput } : undefined);
      syncLocalTracks(activeRoom);
      setIsCameraEnabled(nextEnabled);
      setCallType(nextCallType);
      callTypeRef.current = nextCallType;

      const currentCallDocId = callDocIdRef.current || callDocId;
      if (currentCallDocId) {
        await updateDoc(doc(db, 'calls', currentCallDocId), { callType: nextCallType }).catch(() => {});
      }
      if (otherUserIdRef.current) {
        await setDoc(
          doc(db, 'users', otherUserIdRef.current, 'active_call', 'current'),
          { callType: nextCallType },
          { merge: true }
        ).catch(() => {});
      }
    } catch (error) {
      console.error('Camera toggle failed', error);
      setIsCameraEnabled(false);
    }
  }, [callDocId, isCameraEnabled, selectedVideoInput, syncLocalTracks]);

  const switchAudioInput = async (deviceId) => {
    setSelectedAudioInput(deviceId);
    const activeRoom = liveKitRoomRef.current;
    if (!activeRoom || isMicrophoneMuted) return;
    try {
      await activeRoom.localParticipant.setMicrophoneEnabled(true, deviceId ? { deviceId } : undefined);
      syncLocalTracks(activeRoom);
      setIsMicrophoneMuted(false);
    } catch (error) {
      console.error('Mic switch error', error);
    }
  };

  const switchVideoInput = async (deviceId) => {
    setSelectedVideoInput(deviceId);
    const activeRoom = liveKitRoomRef.current;
    if (!activeRoom || !isCameraEnabled) return;
    try {
      await activeRoom.localParticipant.setCameraEnabled(true, deviceId ? { deviceId } : undefined);
      syncLocalTracks(activeRoom);
      setIsCameraEnabled(true);
    } catch (error) {
      console.error('Camera switch error', error);
    }
  };

  return (
    <CallContext.Provider value={{
      user,
      callStatus,
      callType,
      startCall,
      answerCall,
      endCall,
      localStream,
      remoteStream,
      otherUserName,
      devices,
      selectedAudioInput,
      selectedVideoInput,
      selectedAudioOutput,
      switchAudioInput,
      switchVideoInput,
      setSelectedAudioOutput,
      isMicrophoneMuted,
      isCameraEnabled,
      toggleMute,
      toggleCamera,
    }}>
      {children}
    </CallContext.Provider>
  );
};
