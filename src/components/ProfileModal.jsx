import React, { useState, useEffect } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { reauthenticateWithCredential, EmailAuthProvider, updatePassword } from 'firebase/auth';
import { db } from '../firebase';
import { styles } from '../styles';

const ProfileModal = ({ user, defaultRole, onClose }) => {
  // Profile State
  const [tempBio, setTempBio] = useState("");
  const [tempFirst, setTempFirst] = useState("");
  const [tempLast, setTempLast] = useState("");
  const [tempGender, setTempGender] = useState("");
  const [tempDob, setTempDob] = useState("");
  
  // Password State
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  
  // 2FA State
  const [is2FAActive, setIs2FAActive] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [generatedCode, setGeneratedCode] = useState(null);
  
  // Feedback Messages
  const [profileMsg, setProfileMsg] = useState("");
  const [passMsg, setPassMsg] = useState({ text: "", type: "" });

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "users", user.uid), (d) => {
      if (d.exists()) { 
        const data = d.data();
        setTempBio(data.bio || `New ${defaultRole}`);
        setTempGender(data.gender || "");
        setTempDob(data.dob || "");
        
        if (data.firstName) {
          setTempFirst(data.firstName);
          setTempLast(data.lastName || "");
        } else {
          const names = (data.nickname || "").split(" ");
          setTempFirst(names[0] || "");
          setTempLast(names.slice(1).join(" ") || "");
        }
      }
    });
    return () => unsub();
  }, [user, defaultRole]);

  // --- SAVE PROFILE INFO ---
  const handleSaveProfile = async () => {
    try { 
      await setDoc(doc(db, "users", user.uid), { 
        bio: tempBio, 
        firstName: tempFirst,
        lastName: tempLast,
        gender: tempGender,
        dob: tempDob,
        nickname: `${tempFirst} ${tempLast}`.trim() 
      }, { merge: true }); 
      setProfileMsg("Profile Saved!");
      setTimeout(() => setProfileMsg(""), 3000);
    } 
    catch (e) { alert(e.message); }
  };

  // --- STEP 1: VERIFY OLD PASS & SEND CODE ---
  const handleInitiateChange = async () => {
    setPassMsg({ text: "", type: "" });
    
    // Validation
    if (!currentPass || !newPass || !confirmPass) {
      setPassMsg({ text: "Please fill all password fields.", type: "error" });
      return;
    }
    if (newPass !== confirmPass) {
      setPassMsg({ text: "New passwords do not match.", type: "error" });
      return;
    }
    if (newPass.length < 6) {
      setPassMsg({ text: "Password must be at least 6 characters.", type: "error" });
      return;
    }

    try {
      // 1. Re-authenticate User
      const credential = EmailAuthProvider.credential(user.email, currentPass);
      await reauthenticateWithCredential(user, credential);

      // 2. Generate 6-Digit Code
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      setGeneratedCode(code);
      
      // 3. Simulate Email Sending (In production, replace this with a backend API call)
      // For now, we Alert the code so you can test it.
      alert(`[DEMO EMAIL] Your Verification Code is: ${code}`);
      
      console.log(`Sending code ${code} to ${user.email}`);

      // 4. Show 2FA Input
      setIs2FAActive(true);
      setPassMsg({ text: "Verification code sent to email.", type: "success" });

    } catch (e) {
      console.error(e);
      if (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') {
        setPassMsg({ text: "Incorrect current password.", type: "error" });
      } else {
        setPassMsg({ text: "Error: " + e.message, type: "error" });
      }
    }
  };

  // --- STEP 2: VERIFY CODE & UPDATE PASSWORD ---
  const handleVerifyAndUpdate = async () => {
    if (verificationCode !== generatedCode) {
      setPassMsg({ text: "Invalid verification code.", type: "error" });
      return;
    }

    try {
      await updatePassword(user, newPass);

      setPassMsg({ text: "Password updated successfully!", type: "success" });
      
      // Reset Form
      setCurrentPass("");
      setNewPass("");
      setConfirmPass("");
      setVerificationCode("");
      setIs2FAActive(false); // Close 2FA view

    } catch (e) {
      setPassMsg({ text: "Error updating password: " + e.message, type: "error" });
    }
  };

  return (
    <div style={styles.modalOverlay}>
      <div style={{
          ...styles.modalContent, 
          maxHeight: '90vh', 
          overflowY: 'auto'
        }} className="modal-content">
        
        <h2 className="mt-0">Edit Profile</h2>
        
        {/* --- SECTION 1: PERSONAL INFO --- */}
        <div style={{display:'flex', gap:'10px', marginBottom:'15px'}}>
          <div style={{flex:1}}>
            <label className="bold">First Name:</label>
            <input type="text" value={tempFirst} onChange={(e) => setTempFirst(e.target.value)} />
          </div>
          <div style={{flex:1}}>
            <label className="bold">Last Name:</label>
            <input type="text" value={tempLast} onChange={(e) => setTempLast(e.target.value)} />
          </div>
        </div>

        <div style={{display:'flex', gap:'10px', marginBottom:'15px'}}>
          <div style={{flex:1}}>
            <label className="bold">Gender:</label>
            <select value={tempGender} onChange={(e) => setTempGender(e.target.value)}>
              <option value="">Select...</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </div>
          <div style={{flex:1}}>
            <label className="bold">Date of Birth:</label>
            <input type="date" value={tempDob} onChange={(e) => setTempDob(e.target.value)} />
          </div>
        </div>

        <label className="bold">Bio:</label>
        <textarea rows="3" value={tempBio} onChange={(e) => setTempBio(e.target.value)} className="mb-20" />

        <div style={{display:'flex', gap:'10px', justifyContent:'space-between', alignItems:'center', marginBottom: '20px', borderBottom: '1px solid #eee', paddingBottom: '15px'}}>
           {profileMsg && <span className="text-green">{profileMsg}</span>}
           <button onClick={handleSaveProfile} className="btn btn-success">Save Profile Info</button>
        </div>

        {/* --- SECTION 2: CHANGE PASSWORD (2FA FLOW) --- */}
        <h3 style={{marginTop: '0', color: '#333'}}>Change Password</h3>
        
        <div style={{background: '#f9f9f9', padding: '15px', borderRadius: '8px', border: '1px solid #eee'}}>
          
          {!is2FAActive ? (
            // VIEW A: INPUT PASSWORDS
            <>
              <label className="bold" style={{fontSize: '13px'}}>Current Password:</label>
              <input 
                type="password" 
                placeholder="Required"
                value={currentPass} 
                onChange={(e) => setCurrentPass(e.target.value)} 
                style={{marginBottom: '10px'}}
              />

              <div style={{display:'flex', gap:'10px'}}>
                <div style={{flex:1}}>
                  <label className="bold" style={{fontSize: '13px'}}>New Password:</label>
                  <input 
                    type="password" 
                    value={newPass} 
                    onChange={(e) => setNewPass(e.target.value)} 
                  />
                </div>
                <div style={{flex:1}}>
                  <label className="bold" style={{fontSize: '13px'}}>Confirm New:</label>
                  <input 
                    type="password" 
                    value={confirmPass} 
                    onChange={(e) => setConfirmPass(e.target.value)} 
                  />
                </div>
              </div>

              <div style={{marginTop: '15px', textAlign: 'right'}}>
                <button onClick={handleInitiateChange} className="btn btn-primary btn-small">Proceed to Verification</button>
              </div>
            </>
          ) : (
            // VIEW B: ENTER 2FA CODE
            <div style={{textAlign: 'center', padding: '10px'}}>
              <h4 style={{marginTop: 0, color: '#007bff'}}>🔒 Identity Verification</h4>
              <p style={{fontSize: '13px', color: '#555'}}>
                We sent a code to <strong>{user.email}</strong>.<br/>
                Please enter it below to confirm.
              </p>
              
              <input 
                type="text" 
                placeholder="Ex: 123456" 
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value)}
                style={{
                  textAlign: 'center', 
                  fontSize: '18px', 
                  letterSpacing: '3px', 
                  width: '150px',
                  margin: '10px auto',
                  display: 'block'
                }}
                maxLength={6}
              />

              <div style={{display:'flex', gap:'10px', justifyContent:'center', marginTop:'15px'}}>
                <button onClick={() => setIs2FAActive(false)} className="btn btn-secondary btn-small">Cancel</button>
                <button onClick={handleVerifyAndUpdate} className="btn btn-success btn-small">Confirm & Update</button>
              </div>
            </div>
          )}

          {/* Feedback Message */}
          {passMsg.text && (
            <div style={{
              marginTop: '10px', 
              textAlign: 'center',
              color: passMsg.type === 'error' ? 'red' : 'green', 
              fontWeight: 'bold', 
              fontSize: '13px'
            }}>
              {passMsg.text}
            </div>
          )}
        </div>

        {/* --- CLOSE BUTTON --- */}
        <div style={{marginTop: '20px', textAlign: 'right'}}>
          <button onClick={onClose} className="btn btn-secondary">Close</button>
        </div>

      </div>
    </div>
  );
};

export default ProfileModal;