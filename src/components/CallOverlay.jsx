import React, { useEffect, useRef, useState } from 'react';
import { useCall } from '../context/CallContext';

const CallOverlay = () => {
  const { 
    callStatus, callType, otherUserName, answerCall, endCall, 
    remoteStream, localStream, 
    devices, selectedAudioInput, selectedVideoInput, selectedAudioOutput,
    switchAudioInput, switchVideoInput, setSelectedAudioOutput 
  } = useCall();
  
  const remoteVideoRef = useRef(null);
  const localVideoRef = useRef(null);
  const audioRef = useRef(null); 
  
  // --- ROBUST AUDIO MANAGEMENT (FIXED) ---
  // We use JS Audio objects instead of HTML tags to prevent "Ghost Loops"
  const ringtoneRef = useRef(new Audio('/sounds/ringtone.mp3'));
  const ringbackRef = useRef(new Audio('/sounds/ringback.mp3'));

  const [showSettings, setShowSettings] = useState(false);

  // Group devices for UI
  const audioInputs = devices.filter(d => d.kind === 'audioinput');
  const videoInputs = devices.filter(d => d.kind === 'videoinput');
  const audioOutputs = devices.filter(d => d.kind === 'audiooutput');

  // 1. SETUP AUDIO LOOPS
  useEffect(() => {
    ringtoneRef.current.loop = true;
    ringbackRef.current.loop = true;
    
    // Safety cleanup on unmount
    return () => {
      ringtoneRef.current.pause();
      ringbackRef.current.pause();
    };
  }, []);

  // 2. MANAGE RINGTONE / RINGBACK PLAYBACK
  useEffect(() => {
    const handleSound = async () => {
      // RESET BOTH FIRST
      ringtoneRef.current.pause();
      ringbackRef.current.pause();
      ringtoneRef.current.currentTime = 0;
      ringbackRef.current.currentTime = 0;

      try {
        if (callStatus === 'incoming') {
          await ringtoneRef.current.play();
        } else if (callStatus === 'calling') {
          await ringbackRef.current.play();
        }
      } catch (e) {
        console.warn("Audio Autoplay Blocked (User interaction needed):", e);
      }
    };

    handleSound();

    // Cleanup when status changes (Double safety)
    return () => {
      ringtoneRef.current.pause();
      ringbackRef.current.pause();
    };
  }, [callStatus]);

  // 3. APPLY SPEAKER SELECTION
  useEffect(() => {
    const attachSink = (element) => {
        if (selectedAudioOutput && element && typeof element.setSinkId === 'function') {
            element.setSinkId(selectedAudioOutput).catch(err => console.warn('Failed to set sinkId', err));
        }
    };
    
    // Apply to Streams
    attachSink(audioRef.current);
    attachSink(remoteVideoRef.current);
    
    // Apply to Ringtones
    attachSink(ringtoneRef.current);
    attachSink(ringbackRef.current);
  }, [selectedAudioOutput, callStatus]);

  // 4. ATTACH CALL STREAMS (Voice/Video)
  useEffect(() => {
    if (callStatus === 'active') {
      if (remoteVideoRef.current && remoteStream) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
      if (localVideoRef.current && localStream) {
        localVideoRef.current.srcObject = localStream;
        localVideoRef.current.muted = true; // Always mute self
      }
      
      // Explicitly play audio stream to overcome "doesn't play" bugs
      if (callType === 'audio' && audioRef.current && remoteStream) {
        audioRef.current.srcObject = remoteStream;
        audioRef.current.play().catch(e => console.error("Stream Play Error:", e));
      }
    }
  }, [remoteStream, localStream, callStatus, callType]);

  if (callStatus === 'idle') return null;

  const isVideo = callType === 'video';

  return (
    <div style={styles.overlay}>
      
      {/* SETTINGS MODAL */}
      {showSettings && (
        <div style={styles.settingsModal}>
           <div style={styles.settingsHeader}>
              <span>Call Settings</span>
              <button onClick={() => setShowSettings(false)} style={styles.closeBtn}>✕</button>
           </div>
           
           <div style={styles.settingRow}>
             <label>Microphone:</label>
             <select onChange={(e) => switchAudioInput(e.target.value)} value={selectedAudioInput}>
               {audioInputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Default Mic'}</option>)}
             </select>
           </div>

           {isVideo && (
             <div style={styles.settingRow}>
               <label>Camera:</label>
               <select onChange={(e) => switchVideoInput(e.target.value)} value={selectedVideoInput}>
                 {videoInputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Default Camera'}</option>)}
               </select>
             </div>
           )}

           {audioOutputs.length > 0 && (
             <div style={styles.settingRow}>
               <label>Speaker:</label>
               <select onChange={(e) => setSelectedAudioOutput(e.target.value)} value={selectedAudioOutput}>
                 {audioOutputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Default Speaker'}</option>)}
               </select>
             </div>
           )}
        </div>
      )}

      {/* VIDEO MODE */}
      {isVideo && callStatus === 'active' ? (
        <div style={styles.videoContainer}>
          <video ref={remoteVideoRef} autoPlay playsInline style={styles.remoteVideo} />
          <video ref={localVideoRef} autoPlay playsInline muted style={styles.localVideo} />
        </div>
      ) : (
        /* AUDIO MODE OR INCOMING */
        <div style={styles.card}>
          {/* Main Voice Stream */}
          <audio ref={audioRef} autoPlay playsInline style={{display:'none'}} />
          
          <div style={styles.avatar}>👤</div>
          
          <h2 style={{margin: '10px 0', color: '#333'}}>
            {callStatus === 'incoming' 
              ? (isVideo ? 'Incoming Video Call...' : 'Incoming Voice Call...') 
              : (callStatus === 'active' ? 'Connected' : 'Calling...')}
          </h2>
          <p style={{fontSize: '18px', fontWeight: 'bold', color: '#007bff'}}>{otherUserName}</p>

          <div style={styles.controls}>
            {callStatus === 'incoming' && (
              <button onClick={answerCall} style={styles.btnAnswer}>
                {isVideo ? '📹 Accept' : '📞 Accept'}
              </button>
            )}
            <button onClick={() => endCall(true)} style={styles.btnDecline}>
              {callStatus === 'incoming' ? 'Decline' : 'End Call'}
            </button>
          </div>
        </div>
      )}

      {/* CONTROLS OVERLAY (Mute, Settings, End) */}
      {callStatus === 'active' && (
        <div style={styles.floatingControls}>
           <button onClick={() => setShowSettings(!showSettings)} style={styles.controlBtn} title="Settings">⚙️</button>
           <button onClick={() => endCall(true)} style={styles.endBtn}>End</button>
        </div>
      )}
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
    backgroundColor: 'rgba(0,0,0,0.9)', zIndex: 11000,
    display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column'
  },
  videoContainer: {
    position: 'relative', width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: 'black'
  },
  remoteVideo: { width: '100%', height: '100%', objectFit: 'cover' },
  localVideo: {
    position: 'absolute', bottom: '100px', right: '20px', 
    width: '120px', height: '160px', borderRadius: '10px', 
    border: '2px solid white', backgroundColor: '#333', objectFit: 'cover', zIndex: 2
  },
  card: {
    backgroundColor: 'white', padding: '30px', borderRadius: '20px',
    textAlign: 'center', width: '300px', boxShadow: '0 10px 25px rgba(0,0,0,0.5)'
  },
  avatar: {
    width: '80px', height: '80px', borderRadius: '50%', backgroundColor: '#eee',
    margin: '0 auto', display: 'flex', justifyContent: 'center', alignItems: 'center',
    fontSize: '40px'
  },
  controls: {
    display: 'flex', justifyContent: 'center', gap: '20px', marginTop: '25px'
  },
  btnAnswer: {
    backgroundColor: '#28a745', color: 'white', border: 'none',
    width: '60px', height: '60px', borderRadius: '50%', cursor: 'pointer',
    fontSize: '12px', fontWeight: 'bold'
  },
  btnDecline: {
    backgroundColor: '#dc3545', color: 'white', border: 'none',
    width: '60px', height: '60px', borderRadius: '50%', cursor: 'pointer',
    fontSize: '12px', fontWeight: 'bold'
  },
  floatingControls: {
    position: 'absolute', bottom: '30px', left: '0', right: '0', 
    display: 'flex', justifyContent: 'center', gap: '15px', zIndex: 3
  },
  controlBtn: {
    width: '50px', height: '50px', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.2)',
    color: 'white', border: '1px solid white', fontSize: '20px', cursor: 'pointer',
    backdropFilter: 'blur(5px)'
  },
  endBtn: {
     backgroundColor: '#dc3545', color: 'white', border: 'none',
     padding: '0 30px', height: '50px', borderRadius: '25px', 
     fontSize: '16px', fontWeight: 'bold', cursor: 'pointer'
  },
  settingsModal: {
    position: 'absolute', top: '20px', right: '20px', 
    backgroundColor: 'white', padding: '15px', borderRadius: '10px',
    width: '250px', zIndex: 12000, color: '#333',
    boxShadow: '0 5px 15px rgba(0,0,0,0.3)'
  },
  settingsHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: '10px', fontWeight: 'bold', borderBottom: '1px solid #eee', paddingBottom:'5px'
  },
  closeBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize:'16px' },
  settingRow: { marginBottom: '10px', display: 'flex', flexDirection: 'column', textAlign: 'left', fontSize:'12px' },
};

export default CallOverlay;