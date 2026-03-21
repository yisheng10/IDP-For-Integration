import React, { useState } from 'react';
import { auth, db } from '../firebase';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  sendEmailVerification, 
  signOut,
  setPersistence,           
  browserSessionPersistence 
} from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { enforceRoleSecurity } from '../utils';

const Login = ({ type, onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  // Names
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  
  // Gender & DOB
  const [gender, setGender] = useState('');
  const [dob, setDob] = useState('');
  
  const [isReg, setIsReg] = useState(false);
  const [error, setError] = useState('');
  const [verificationSent, setVerificationSent] = useState(false);

  const handleAuth = async (e) => {
    e.preventDefault(); 
    setError('');
    
    try {
      // Role Validation
      if (type==='crc' && !email.endsWith('@hospital.com')) throw new Error("Only @hospital.com allowed");
      if (type==='patient' && email.endsWith('@hospital.com')) throw new Error("Staff use CRC portal");
      
      await setPersistence(auth, browserSessionPersistence);

      if (isReg) {
        // --- 1. SIGN UP LOGIC (New Patients) ---
        if (type === 'patient' && (!firstName || !lastName || !gender || !dob)) {
          throw new Error("Name, Gender, and Date of Birth are required.");
        }

        const res = await createUserWithEmailAndPassword(auth, email, password);
        const user = res.user;

        // Save User Info
        await setDoc(doc(db, "users", user.uid), {
          firstName: firstName,
          lastName: lastName,
          nickname: `${firstName} ${lastName}`,
          gender: gender,
          dob: dob,
          role: type,
          email: user.email
        }, { merge: true });

        // SEND VERIFICATION EMAIL (Only for real users)
        // Skip for testing emails
        const isTestAccount = email.toLowerCase().includes('test') || email.toLowerCase().includes('demo');
        
        if (!isTestAccount) {
          await sendEmailVerification(user);
          await signOut(auth); // Force logout to enforce verification
          setVerificationSent(true);
        } else {
          // If test account, allow immediate login
          await enforceRoleSecurity(user, type);
          onLogin(user);
        }

      } else {
        // --- 2. LOGIN LOGIC ---
        const res = await signInWithEmailAndPassword(auth, email, password);
        const user = res.user;

        // --- VERIFICATION RULES ---
        const isTestAccount = user.email.toLowerCase().includes('test') || user.email.toLowerCase().includes('demo');
        const isCRC = type === 'crc'; 
        
        // Rule: Enforce verification ONLY if:
        // 1. Not a CRC
        // 2. Not a Test Account
        // 3. Not verified yet
        if (!isCRC && !isTestAccount && !user.emailVerified) {
          
          // Optional: Grandfathering check (if you still want it)
          const ENFORCEMENT_START_DATE = new Date('2026-01-12T00:00:00').getTime(); 
          const userCreationTime = new Date(user.metadata.creationTime).getTime();

          if (userCreationTime > ENFORCEMENT_START_DATE) {
             await signOut(auth);
             throw new Error("Email not verified. Please check your inbox.");
          }
        }

        await enforceRoleSecurity(user, type);
        onLogin(user);
      }

    } catch (e) { 
      let msg = e.message.replace('Firebase: ', '');
      if(e.code === 'auth/invalid-email') msg = "Please enter a valid email address.";
      setError(msg);

      // Clean up session if login failed due to verification logic
      if (!isReg && auth.currentUser && !auth.currentUser.emailVerified) {
         const isTest = email.toLowerCase().includes('test');
         if(type !== 'crc' && !isTest) {
            // Re-check cutoff before kicking out (to match logic above)
            const created = new Date(auth.currentUser.metadata.creationTime).getTime();
            const cutoff = new Date('2026-01-12T00:00:00').getTime();
            if(created > cutoff) signOut(auth);
         }
      }
    }
  };

  if (verificationSent) {
    return (
      <div className="login-card">
        <h2 className="mt-0 text-green">✓ Check Your Email</h2>
        <p>We have sent a verification link to <strong>{email}</strong>.</p>
        <p style={{fontSize:'13px', color:'#555'}}>
          Please click the link in the email to verify your account, then log in.
        </p>
        <button 
          onClick={() => { setVerificationSent(false); setIsReg(false); }} 
          className="btn btn-primary"
          style={{width: '100%', marginTop: '15px'}}
        >
          Back to Login
        </button>
      </div>
    );
  }

  return (
    <div className="login-card">
      <h2 className="mt-0">{type==='crc' ? 'CRC Portal' : (isReg?'Patient Sign Up':'Patient Login')}</h2>
      
      <form onSubmit={handleAuth} style={{display:'flex', flexDirection:'column', gap:'15px'}}>
        
        {/* FIELDS FOR NEW PATIENTS */}
        {isReg && type === 'patient' && (
          <>
            <div style={{display:'flex', gap:'10px'}}>
              <input type="text" placeholder="First Name" value={firstName} onChange={e=>setFirstName(e.target.value)} required />
              <input type="text" placeholder="Last Name" value={lastName} onChange={e=>setLastName(e.target.value)} required />
            </div>
            
            <div style={{display:'flex', gap:'10px'}}>
              <select value={gender} onChange={e=>setGender(e.target.value)} required style={{flex:1}}>
                <option value="">Select Gender</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
              <input 
                type="date" 
                value={dob} 
                onChange={e=>setDob(e.target.value)} 
                required 
                style={{flex:1}} 
                title="Date of Birth"
              />
            </div>
          </>
        )}

        <input type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required />
        <input type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} required />
        
        <button className={`btn ${type==='crc'?'btn-primary':'btn-success'}`}>
          {isReg ? 'Sign Up & Verify' : 'Login'}
        </button>
      </form>
      
      {error && (
        <div style={{marginTop:'10px', padding:'10px', background:'#ffebee', borderRadius:'5px', border:'1px solid red'}}>
          <p className="text-red" style={{margin:0, fontSize:'14px'}}>{error}</p>
        </div>
      )}
      
      {type==='patient' && (
        <p onClick={()=> { setIsReg(!isReg); setError(''); }} style={{color:'blue', cursor:'pointer', textDecoration:'underline', marginTop:'15px'}}>
          {isReg ? 'Already verify? Login instead' : 'New here? Sign Up'}
        </p>
      )}
    </div>
  );
};

export default Login;