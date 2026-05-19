import React, { useState } from 'react';
import { auth, db } from '../firebase';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { enforceRoleSecurity } from '../utils';

function getSurfaceLabel(type) {
  return type === 'crc' ? 'CRC' : 'patient';
}

function getAuthErrorMessage({ error, type, isReg }) {
  const surfaceLabel = getSurfaceLabel(type);
  const code = error?.code;
  const rawMessage = String(error?.message || '').replace('Firebase: ', '');

  if (code === 'auth/invalid-email') {
    return `Please enter a valid ${surfaceLabel.toLowerCase()} email address.`;
  }
  if (code === 'auth/wrong-password') {
    return `${surfaceLabel} login failed. The password is incorrect. Please try again.`;
  }
  if (code === 'auth/user-not-found') {
    return `No ${surfaceLabel.toLowerCase()} account was found for this email address in the current Firebase project.`;
  }
  if (code === 'auth/invalid-credential') {
    return `${surfaceLabel} login failed. The email address does not exist in the current Firebase project, or the password is incorrect.`;
  }
  if (code === 'auth/email-already-in-use') {
    return `${surfaceLabel} account already exists. Please log in instead.`;
  }
  if (code === 'auth/too-many-requests') {
    return `${surfaceLabel} sign-in is temporarily locked. Please wait a moment and try again.`;
  }
  if (code === 'auth/network-request-failed') {
    return 'Network error. Please confirm your connection and try again.';
  }
  if (!isReg && rawMessage === 'Only @hospital.com allowed') {
    return 'CRC sign-in requires an @hospital.com email address.';
  }
  if (!isReg && rawMessage === 'Staff use CRC portal') {
    return 'CRC staff must use the CRC website. Patient login does not accept @hospital.com email addresses.';
  }
  if (isReg && rawMessage === 'Name, Gender, and Date of Birth are required.') {
    return 'Complete the required patient registration details before continuing.';
  }
  return rawMessage;
}

export default function Login({ type, onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [gender, setGender] = useState('');
  const [dob, setDob] = useState('');
  const [isReg, setIsReg] = useState(false);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [rememberMe, setRememberMe] = useState(type === 'crc');
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);

  const handleAuth = async (event) => {
    event.preventDefault();
    setError('');
    setInfoMessage('');

    try {
      if (type === 'crc' && !email.endsWith('@hospital.com')) throw new Error('Only @hospital.com allowed');
      if (type === 'patient' && email.endsWith('@hospital.com')) throw new Error('Staff use CRC portal');

      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);

      if (isReg) {
        if (type === 'patient' && (!firstName || !lastName || !gender || !dob)) {
          throw new Error('Name, Gender, and Date of Birth are required.');
        }

        const response = await createUserWithEmailAndPassword(auth, email, password);
        const user = response.user;

        await setDoc(
          doc(db, 'users', user.uid),
          {
            firstName,
            lastName,
            nickname: `${firstName} ${lastName}`,
            gender,
            dob,
            role: type,
            email: user.email,
          },
          { merge: true }
        );

        const isTestAccount = email.toLowerCase().includes('test') || email.toLowerCase().includes('demo');
        if (!isTestAccount) {
          await sendEmailVerification(user);
          await signOut(auth);
          setVerificationSent(true);
        } else {
          await enforceRoleSecurity(user, type);
          onLogin(user);
        }
      } else {
        const response = await signInWithEmailAndPassword(auth, email, password);
        const user = response.user;
        const isTestAccount = user.email.toLowerCase().includes('test') || user.email.toLowerCase().includes('demo');
        const isCRC = type === 'crc';

        if (!isCRC && !isTestAccount && !user.emailVerified) {
          const enforcementStartDate = new Date('2026-01-12T00:00:00').getTime();
          const userCreationTime = new Date(user.metadata.creationTime).getTime();
          if (userCreationTime > enforcementStartDate) {
            await signOut(auth);
            throw new Error('Email not verified. Please check your inbox.');
          }
        }

        await enforceRoleSecurity(user, type);
        onLogin(user);
      }
    } catch (authError) {
      setError(getAuthErrorMessage({ error: authError, type, isReg }));

      if (!isReg && auth.currentUser && !auth.currentUser.emailVerified) {
        const isTest = email.toLowerCase().includes('test');
        if (type !== 'crc' && !isTest) {
          const created = new Date(auth.currentUser.metadata.creationTime).getTime();
          const cutoff = new Date('2026-01-12T00:00:00').getTime();
          if (created > cutoff) signOut(auth);
        }
      }
    }
  };

  const handleForgotPassword = async () => {
    setError('');
    setInfoMessage('');

    if (!email.trim()) {
      setError('Enter the CRC email address first so the reset email goes to the right account.');
      return;
    }

    setIsSendingReset(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setInfoMessage(`Password reset email sent to ${email.trim()}.`);
    } catch (authError) {
      setError(getAuthErrorMessage({ error: authError, type, isReg: false }));
    } finally {
      setIsSendingReset(false);
    }
  };

  if (verificationSent) {
    return (
      <div className="login-card">
        <div className="dashboard-kicker">Verification</div>
        <h2 className="mt-0">Check your email</h2>
        <p>We sent a verification link to <strong>{email}</strong>.</p>
        <p className="section-note">Open the email, complete verification, then return here to sign in.</p>
        <button
          onClick={() => {
            setVerificationSent(false);
            setIsReg(false);
          }}
          className="btn btn-primary"
          style={{ width: '100%', marginTop: '16px' }}
        >
          Back to login
        </button>
      </div>
    );
  }

  return (
    <div className="login-card login-card--auth">
      <div className="dashboard-kicker">{type === 'crc' ? 'CRC sign-in' : 'Patient access'}</div>
      <h2 className="mt-0 login-card__title">{type === 'crc' ? 'Welcome back' : isReg ? 'Patient Sign Up' : 'Patient Login'}</h2>
      <p className="section-note login-card__lead">
        {type === 'crc'
          ? 'Use your hospital email to enter the CRC workspace.'
                : 'Use the patient app account for questionnaires, adverse events, appointments, and vitals.'}
      </p>

      <form onSubmit={handleAuth} className="login-form">
        {isReg && type === 'patient' ? (
          <>
            <div className="login-form__grid">
              <div className="login-form__field">
                <label>First name</label>
                <input type="text" placeholder="First name" value={firstName} onChange={(event) => setFirstName(event.target.value)} required />
              </div>
              <div className="login-form__field">
                <label>Last name</label>
                <input type="text" placeholder="Last name" value={lastName} onChange={(event) => setLastName(event.target.value)} required />
              </div>
            </div>
            <div className="login-form__grid">
              <div className="login-form__field">
                <label>Gender</label>
                <select value={gender} onChange={(event) => setGender(event.target.value)} required>
                  <option value="">Select gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </div>
              <div className="login-form__field">
                <label>Date of birth</label>
                <input type="date" value={dob} onChange={(event) => setDob(event.target.value)} required />
              </div>
            </div>
          </>
        ) : null}

        <div className="login-form__field">
          <label>Email address</label>
          <input
            type="email"
            placeholder={type === 'crc' ? 'name@hospital.com' : 'patient@example.com'}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>

        <div className="login-form__field">
          <label>Password</label>
          <input type="password" placeholder="Enter password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </div>

        {type === 'crc' ? (
          <div className="login-form__utilityRow">
            <label className="login-form__checkbox">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(event) => setRememberMe(event.target.checked)}
              />
              <span>Remember me</span>
            </label>
            <button type="button" className="login-form__linkButton" onClick={handleForgotPassword} disabled={isSendingReset}>
              {isSendingReset ? 'Sending...' : 'Forgot password?'}
            </button>
          </div>
        ) : null}

        <button className={`btn ${type === 'crc' ? 'btn-primary' : 'btn-success'}`}>
          {isReg ? 'Create account' : type === 'crc' ? 'Sign in' : 'Continue'}
        </button>
      </form>

      {error ? (
        <div style={{ marginTop: '14px', padding: '12px 14px', background: 'var(--danger-soft)', border: '1px solid #f0c3c3', borderRadius: '14px' }}>
          <p className="text-red" style={{ margin: 0, fontSize: '14px' }}>{error}</p>
        </div>
      ) : null}

      {infoMessage ? (
        <div className="login-card__info">
          <p style={{ margin: 0 }}>{infoMessage}</p>
        </div>
      ) : null}

      {type === 'patient' ? (
        <p
          onClick={() => {
            setIsReg(!isReg);
            setError('');
            setInfoMessage('');
          }}
          style={{ color: 'var(--brand)', cursor: 'pointer', textDecoration: 'underline', marginTop: '16px', fontWeight: '700' }}
        >
          {isReg ? 'Already registered? Log in instead' : 'New here? Create a patient account'}
        </p>
      ) : null}
    </div>
  );
}
