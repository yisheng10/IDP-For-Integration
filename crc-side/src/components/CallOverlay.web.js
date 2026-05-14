import React, { useEffect, useRef } from 'react';
import { useCall } from '../context/CallContext';

export default function CallOverlay() {
  const {
    callStatus,
    callType,
    otherUserName,
    answerCall,
    endCall,
    remoteStream,
    localStream,
  } = useCall();

  const remoteVideoRef = useRef(null);
  const localVideoRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    if (callStatus !== 'active') return;

    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.muted = true;
    }
    if (callType === 'audio' && audioRef.current && remoteStream) {
      audioRef.current.srcObject = remoteStream;
      audioRef.current.play().catch(() => {});
    }
  }, [callStatus, callType, localStream, remoteStream]);

  if (callStatus === 'idle') return null;

  const isVideo = callType === 'video';

  return (
    <div style={styles.overlay}>
      {isVideo && callStatus === 'active' ? (
        <div style={styles.videoContainer}>
          <video ref={remoteVideoRef} autoPlay playsInline style={styles.remoteVideo} />
          <video ref={localVideoRef} autoPlay playsInline muted style={styles.localVideo} />
          <div style={styles.controls}>
            <button onClick={() => endCall(true)} style={styles.declineButton}>
              End
            </button>
          </div>
        </div>
      ) : (
        <div style={styles.card}>
          <audio ref={audioRef} autoPlay style={{ display: 'none' }} />
          <div style={styles.avatar}>Call</div>
          <h2 style={styles.title}>
            {callStatus === 'incoming'
              ? isVideo
                ? 'Incoming video call'
                : 'Incoming voice call'
              : callStatus === 'active'
                ? 'Connected'
                : 'Calling...'}
          </h2>
          <p style={styles.name}>{otherUserName || 'CRC'}</p>

          <div style={styles.controls}>
            {callStatus === 'incoming' ? (
              <button onClick={answerCall} style={styles.answerButton}>
                Accept
              </button>
            ) : null}
            <button onClick={() => endCall(true)} style={styles.declineButton}>
              {callStatus === 'incoming' ? 'Decline' : 'End'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(12, 23, 34, 0.78)',
    zIndex: 99999,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    width: '320px',
    backgroundColor: '#ffffff',
    borderRadius: '24px',
    padding: '28px',
    textAlign: 'center',
    boxShadow: '0 20px 48px rgba(15, 23, 42, 0.35)',
  },
  avatar: {
    width: '84px',
    height: '84px',
    margin: '0 auto 16px',
    borderRadius: '999px',
    backgroundColor: '#e8f1fb',
    color: '#0f609b',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: '700',
  },
  title: {
    margin: '0 0 8px',
    color: '#14324a',
  },
  name: {
    margin: '0 0 16px',
    color: '#52606d',
    fontWeight: '700',
  },
  controls: {
    display: 'flex',
    justifyContent: 'center',
    gap: '12px',
    marginTop: '16px',
  },
  answerButton: {
    backgroundColor: '#1f7a45',
    color: '#fff',
    border: 'none',
    borderRadius: '999px',
    padding: '12px 20px',
    cursor: 'pointer',
    fontWeight: '700',
  },
  declineButton: {
    backgroundColor: '#b42318',
    color: '#fff',
    border: 'none',
    borderRadius: '999px',
    padding: '12px 20px',
    cursor: 'pointer',
    fontWeight: '700',
  },
  videoContainer: {
    position: 'relative',
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  remoteVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  localVideo: {
    position: 'absolute',
    bottom: '24px',
    right: '24px',
    width: '160px',
    height: '200px',
    objectFit: 'cover',
    borderRadius: '16px',
    border: '2px solid rgba(255,255,255,0.72)',
    backgroundColor: '#08131f',
  },
};
