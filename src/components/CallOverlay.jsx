import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useCall } from '../context/CallContext';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const formatDuration = (seconds) => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
};

const Icon = ({ name, size = 24, rotate = false }) => {
  const paths = {
    chevronDown: 'M7 10l5 5 5-5',
    chevronUp: 'M7 14l5-5 5 5',
    call: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.77.63 2.6a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.48-1.2a2 2 0 0 1 2.11-.45c.83.3 1.7.51 2.6.63A2 2 0 0 1 22 16.92z',
    mic: 'M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z M19 10v1a7 7 0 0 1-14 0v-1 M12 18v4 M8 22h8',
    micOff: 'M2 2l20 20 M9 9v2a3 3 0 0 0 5.12 2.12 M15 9.34V5a3 3 0 0 0-5.94-.6 M17 10v1a6.97 6.97 0 0 1-1.6 4.45 M5 10v1a7 7 0 0 0 10.3 6.18 M12 18v4 M8 22h8',
    video: 'M15 10l4.55-2.28A1 1 0 0 1 21 8.62v6.76a1 1 0 0 1-1.45.9L15 14 M3 7h12v10H3z',
    videoOff: 'M2 2l20 20 M15 10l4.55-2.28A1 1 0 0 1 21 8.62v6.76 M15 14v3H6.17 M3 7h4.17',
    speaker: 'M11 5L6 9H3v6h3l5 4V5z M15.54 8.46a5 5 0 0 1 0 7.07 M19.07 4.93a10 10 0 0 1 0 14.14',
    speakerOff: 'M2 2l20 20 M11 5L6 9H3v6h3l5 4v-7 M16 9.5a5 5 0 0 1-.5 5.5 M19.07 4.93a10 10 0 0 1 1.3 11.7',
    settings: 'M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 8.6 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 8.6a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.2.34.52.6.9.7.18.05.37.08.56.08H21a2 2 0 1 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15z',
    user: 'M20 21a8 8 0 1 0-16 0 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={rotate ? { transform: 'rotate(135deg)' } : undefined}
    >
      <path d={paths[name]} />
    </svg>
  );
};

const CallButton = ({ icon, label, onClick, active = false, off = false, danger = false, success = false, rotate = false }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    style={{
      ...styles.controlButton,
      ...(active ? styles.controlButtonActive : null),
      ...(off ? styles.controlButtonOff : null),
      ...(danger ? styles.controlButtonDanger : null),
      ...(success ? styles.controlButtonSuccess : null),
    }}
  >
    <span style={styles.controlHalo} />
    <Icon name={icon} size={danger || success ? 27 : 24} rotate={rotate} />
  </button>
);

const CallOverlay = () => {
  const {
    callStatus,
    callType,
    otherUserName,
    answerCall,
    endCall,
    remoteStream,
    localStream,
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
  } = useCall();

  const remoteVideoRef = useRef(null);
  const localVideoRef = useRef(null);
  const audioRef = useRef(null);
  const ringtoneRef = useRef(new Audio('/sounds/ringtone.mp3'));
  const ringbackRef = useRef(new Audio('/sounds/ringback.mp3'));
  const dragRef = useRef({ dragging: false, offsetX: 0, offsetY: 0, moved: false });

  const [showSettings, setShowSettings] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isSpeakerEnabled, setIsSpeakerEnabled] = useState(true);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [position, setPosition] = useState(() => ({
    x: Math.max(24, window.innerWidth - 420),
    y: 96,
  }));

  const audioInputs = devices.filter((device) => device.kind === 'audioinput');
  const videoInputs = devices.filter((device) => device.kind === 'videoinput');
  const audioOutputs = devices.filter((device) => device.kind === 'audiooutput');
  const isVideo = callType === 'video';
  const isActive = callStatus === 'active';
  const isIncoming = callStatus === 'incoming';
  const displayName = otherUserName || 'Patient';

  useEffect(() => {
    const ringtone = ringtoneRef.current;
    const ringback = ringbackRef.current;
    ringtoneRef.current.loop = true;
    ringbackRef.current.loop = true;
    return () => {
      ringtone.pause();
      ringback.pause();
    };
  }, []);

  useEffect(() => {
    const ringtone = ringtoneRef.current;
    const ringback = ringbackRef.current;

    ringtone.pause();
    ringback.pause();
    ringtone.currentTime = 0;
    ringback.currentTime = 0;

    const nextSound = callStatus === 'incoming' ? ringtone : callStatus === 'calling' ? ringback : null;
    if (nextSound) {
      nextSound.play().catch((error) => console.warn('Audio autoplay blocked:', error));
    }

    if (callStatus === 'idle') {
      window.setTimeout(() => {
        setIsMinimized(false);
        setShowSettings(false);
      }, 0);
    }

    return () => {
      ringtone.pause();
      ringback.pause();
    };
  }, [callStatus]);

  useEffect(() => {
    if (!isActive) {
      window.setTimeout(() => setDurationSeconds(0), 0);
      return undefined;
    }
    const intervalId = setInterval(() => setDurationSeconds((current) => current + 1), 1000);
    return () => clearInterval(intervalId);
  }, [isActive]);

  useEffect(() => {
    const attachSink = (element) => {
      if (selectedAudioOutput && element && typeof element.setSinkId === 'function') {
        element.setSinkId(selectedAudioOutput).catch((error) => console.warn('Failed to set sinkId', error));
      }
    };

    attachSink(audioRef.current);
    attachSink(remoteVideoRef.current);
    attachSink(ringtoneRef.current);
    attachSink(ringbackRef.current);
  }, [selectedAudioOutput, callStatus]);

  useEffect(() => {
    const volume = isSpeakerEnabled ? 1 : 0;
    [audioRef.current, remoteVideoRef.current, ringtoneRef.current, ringbackRef.current].forEach((element) => {
      if (element) element.volume = volume;
    });
  }, [isSpeakerEnabled, callStatus]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play?.().catch((error) => console.warn('Remote video play blocked:', error));
    }
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.muted = true;
      localVideoRef.current.play?.().catch((error) => console.warn('Local video play blocked:', error));
    }
    if (audioRef.current && remoteStream) {
      audioRef.current.srcObject = remoteStream;
      audioRef.current.play().catch((error) => console.warn('Stream audio play blocked:', error));
    }
  }, [remoteStream, localStream, callStatus]);

  const statusLabel = useMemo(() => {
    if (isIncoming) return isVideo ? 'Incoming video call' : 'Incoming voice call';
    if (isActive) return formatDuration(durationSeconds);
    return 'Calling...';
  }, [durationSeconds, isActive, isIncoming, isVideo]);

  const startDrag = (event) => {
    dragRef.current = {
      dragging: true,
      moved: false,
      offsetX: event.clientX - position.x,
      offsetY: event.clientY - position.y,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveDrag = (event) => {
    if (!dragRef.current.dragging) return;
    const width = isMinimized ? 78 : 360;
    const height = isMinimized ? 78 : 520;
    const nextX = clamp(event.clientX - dragRef.current.offsetX, 16, window.innerWidth - width - 16);
    const nextY = clamp(event.clientY - dragRef.current.offsetY, 16, window.innerHeight - height - 16);
    dragRef.current.moved = true;
    setPosition({ x: nextX, y: nextY });
  };

  const endDrag = () => {
    dragRef.current.dragging = false;
  };

  if (callStatus === 'idle') return null;

  if (isIncoming) {
    return (
      <section style={styles.incomingBanner} aria-label={statusLabel} role="dialog">
        <div style={styles.incomingIcon}>
          <Icon name={isVideo ? 'video' : 'call'} size={22} />
        </div>
        <div style={styles.incomingCopy}>
          <span style={styles.incomingEyebrow}>{isVideo ? 'Incoming video call' : 'Incoming voice call'}</span>
          <strong style={styles.incomingName}>{displayName}</strong>
        </div>
        <div style={styles.incomingBannerActions}>
          <button type="button" onClick={() => endCall(true)} style={{ ...styles.bannerButton, ...styles.bannerDecline }}>
            Decline
          </button>
          <button type="button" onClick={answerCall} style={{ ...styles.bannerButton, ...styles.bannerAccept }}>
            Accept
          </button>
        </div>
      </section>
    );
  }

  if (isMinimized) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label="Restore call window"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onDoubleClick={() => setIsMinimized(false)}
        onClick={() => {
          if (!dragRef.current.moved) setIsMinimized(false);
        }}
        style={{ ...styles.minimizedBubble, left: position.x, top: position.y }}
      >
        <Icon name={isVideo ? 'video' : 'call'} size={24} />
        <span style={styles.bubblePulse} />
      </div>
    );
  }

  return (
    <section
      style={{ ...styles.callWindow, left: position.x, top: position.y }}
      aria-label="CRC call window"
    >
      <audio ref={audioRef} autoPlay playsInline style={{ display: 'none' }} />

      <header
        style={styles.callHeader}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
      >
        <button
          type="button"
          onClick={() => {
            setShowSettings(false);
            setIsMinimized(true);
          }}
          style={styles.topButton}
          aria-label="Minimize call"
        >
          <Icon name="chevronDown" size={23} />
        </button>
        <div style={styles.identityBlock}>
          <strong style={styles.calleeName}>{displayName}</strong>
          <span style={styles.statusText}>{statusLabel}</span>
        </div>
      </header>

      <div style={styles.stage}>
        {isVideo && remoteStream ? (
          <video ref={remoteVideoRef} autoPlay playsInline style={styles.remoteVideo} />
        ) : (
          <div style={styles.avatarWrap}>
            <Icon name="user" size={86} />
          </div>
        )}

        {isVideo && localStream ? (
          <video ref={localVideoRef} autoPlay playsInline muted style={styles.localVideo} />
        ) : null}
      </div>

      <div style={styles.bottomDock}>
        <CallButton
          icon="chevronUp"
          label={showSettings ? 'Hide call settings' : 'Show call settings'}
          onClick={() => setShowSettings((current) => !current)}
          off={showSettings}
        />
        <CallButton
          icon={isCameraEnabled ? 'video' : 'videoOff'}
          label={isCameraEnabled ? 'Turn camera off' : 'Turn camera on'}
          onClick={toggleCamera}
          off={!isCameraEnabled}
        />
        <CallButton
          icon={isSpeakerEnabled ? 'speaker' : 'speakerOff'}
          label={isSpeakerEnabled ? 'Speaker on' : 'Speaker off'}
          onClick={() => setIsSpeakerEnabled((current) => !current)}
          off={!isSpeakerEnabled}
        />
        <CallButton
          icon={isMicrophoneMuted ? 'micOff' : 'mic'}
          label={isMicrophoneMuted ? 'Unmute microphone' : 'Mute microphone'}
          onClick={toggleMute}
          off={isMicrophoneMuted}
        />
        <CallButton icon="call" label="End call" onClick={() => endCall(true)} danger rotate />
      </div>

      {showSettings ? (
        <div style={styles.settingsPanel}>
          <div style={styles.settingsTitle}>Call settings</div>
          <label style={styles.settingRow}>
            <span>Microphone</span>
            <select onChange={(event) => switchAudioInput(event.target.value)} value={selectedAudioInput} style={styles.select}>
              {audioInputs.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>{device.label || 'Default microphone'}</option>
              ))}
            </select>
          </label>
          {isVideo ? (
            <label style={styles.settingRow}>
              <span>Camera</span>
              <select onChange={(event) => switchVideoInput(event.target.value)} value={selectedVideoInput} style={styles.select}>
                {videoInputs.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>{device.label || 'Default camera'}</option>
                ))}
              </select>
            </label>
          ) : null}
          {audioOutputs.length > 0 ? (
            <label style={styles.settingRow}>
              <span>Speaker output</span>
              <select onChange={(event) => setSelectedAudioOutput(event.target.value)} value={selectedAudioOutput} style={styles.select}>
                {audioOutputs.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>{device.label || 'Default speaker'}</option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};

const styles = {
  callWindow: {
    position: 'fixed',
    width: '360px',
    height: '520px',
    borderRadius: '28px',
    overflow: 'hidden',
    zIndex: 11000,
    background: '#073c34',
    boxShadow: '0 28px 70px rgba(0,0,0,0.34)',
    border: '1px solid rgba(255,255,255,0.16)',
  },
  callHeader: {
    height: '132px',
    padding: '20px 22px 16px',
    background: '#01372f',
    color: '#fff',
    cursor: 'grab',
    userSelect: 'none',
  },
  topButton: {
    width: '48px',
    height: '48px',
    borderRadius: '24px',
    border: '0',
    background: 'rgba(10,10,10,0.42)',
    color: '#fff',
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
    transition: 'background-color 180ms ease, transform 180ms ease',
  },
  identityBlock: {
    display: 'grid',
    justifyItems: 'center',
    gap: '6px',
    marginTop: '8px',
  },
  calleeName: {
    maxWidth: '280px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '28px',
    lineHeight: 1.1,
    textShadow: '0 2px 10px rgba(0,0,0,0.4)',
  },
  statusText: {
    fontSize: '15px',
    fontWeight: 700,
    color: 'rgba(255,255,255,0.74)',
  },
  stage: {
    position: 'relative',
    height: '294px',
    background: '#154f46',
    display: 'grid',
    placeItems: 'center',
  },
  remoteVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    background: '#001b18',
  },
  localVideo: {
    position: 'absolute',
    right: '18px',
    bottom: '18px',
    width: '104px',
    height: '148px',
    borderRadius: '18px',
    objectFit: 'cover',
    background: '#001b18',
    border: '1px solid rgba(255,255,255,0.32)',
  },
  avatarWrap: {
    width: '154px',
    height: '154px',
    borderRadius: '77px',
    display: 'grid',
    placeItems: 'center',
    color: '#d7ebe8',
    background: '#003b33',
    border: '1px solid rgba(255,255,255,0.24)',
  },
  bottomDock: {
    position: 'absolute',
    left: '22px',
    right: '22px',
    bottom: '18px',
    minHeight: '76px',
    borderRadius: '28px',
    padding: '10px 14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '10px',
    background: 'rgba(99,99,99,0.76)',
  },
  incomingActions: {
    position: 'absolute',
    left: '0',
    right: '0',
    bottom: '34px',
    display: 'flex',
    justifyContent: 'center',
    gap: '22px',
  },
  incomingBanner: {
    position: 'fixed',
    top: '18px',
    left: '50%',
    transform: 'translateX(-50%)',
    width: 'min(520px, calc(100vw - 32px))',
    minHeight: '78px',
    zIndex: 12000,
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    padding: '12px 14px',
    borderRadius: '22px',
    background: 'rgba(4, 58, 50, 0.96)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.18)',
    boxShadow: '0 22px 60px rgba(0,0,0,0.28)',
  },
  incomingIcon: {
    flex: '0 0 auto',
    width: '48px',
    height: '48px',
    borderRadius: '24px',
    display: 'grid',
    placeItems: 'center',
    background: 'rgba(255,255,255,0.12)',
    color: '#dff8f4',
  },
  incomingCopy: {
    flex: 1,
    minWidth: 0,
    display: 'grid',
    gap: '2px',
  },
  incomingEyebrow: {
    fontSize: '12px',
    fontWeight: 800,
    color: 'rgba(223,248,244,0.76)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  incomingName: {
    fontSize: '18px',
    lineHeight: 1.2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  incomingBannerActions: {
    flex: '0 0 auto',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  bannerButton: {
    minWidth: '86px',
    minHeight: '48px',
    border: '0',
    borderRadius: '24px',
    padding: '0 18px',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 800,
    cursor: 'pointer',
    transition: 'transform 160ms ease, filter 160ms ease',
  },
  bannerDecline: {
    background: '#ef003f',
  },
  bannerAccept: {
    background: '#19a85b',
  },
  controlButton: {
    position: 'relative',
    width: '54px',
    height: '54px',
    borderRadius: '27px',
    border: '0',
    color: '#050505',
    background: '#fff',
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
    overflow: 'hidden',
    transition: 'background-color 220ms ease, color 220ms ease, transform 180ms ease',
  },
  controlButtonActive: {
    background: '#fff',
    color: '#050505',
  },
  controlButtonOff: {
    background: '#050505',
    color: '#fff',
  },
  controlButtonDanger: {
    background: '#ef003f',
    color: '#fff',
  },
  controlButtonSuccess: {
    background: '#19a85b',
    color: '#fff',
  },
  controlHalo: {
    position: 'absolute',
    inset: 0,
    background: '#fff',
    opacity: 0,
    transition: 'opacity 180ms ease',
  },
  settingsPanel: {
    position: 'absolute',
    left: '22px',
    right: '22px',
    bottom: '108px',
    padding: '16px',
    borderRadius: '22px',
    background: '#fff',
    color: '#17201f',
    boxShadow: '0 18px 42px rgba(0,0,0,0.28)',
    display: 'grid',
    gap: '12px',
    zIndex: 2,
  },
  settingsTitle: {
    fontWeight: 800,
    fontSize: '14px',
  },
  settingRow: {
    display: 'grid',
    gap: '5px',
    fontSize: '12px',
    fontWeight: 700,
  },
  select: {
    width: '100%',
    border: '1px solid #d8dfdd',
    borderRadius: '10px',
    padding: '8px',
    fontSize: '12px',
  },
  minimizedBubble: {
    position: 'fixed',
    width: '78px',
    height: '78px',
    borderRadius: '22px',
    zIndex: 11000,
    display: 'grid',
    placeItems: 'center',
    color: '#fff',
    background: '#063b33',
    boxShadow: '0 18px 50px rgba(0,0,0,0.3)',
    border: '1px solid rgba(255,255,255,0.18)',
    cursor: 'grab',
  },
  bubblePulse: {
    position: 'absolute',
    top: '12px',
    right: '12px',
    width: '10px',
    height: '10px',
    borderRadius: '5px',
    background: '#2ee66f',
  },
};

export default CallOverlay;
