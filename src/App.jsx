import React, { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { APP_BACKGROUND_IMAGE, APP_ICON, APP_NAME } from './config';
import Login from './components/Login';
import { auth } from './firebase';
import HistoryPage from './pages/HistoryPage';
import CRCHome from './pages/CRCHome';

function UnsupportedWebAccess({ user, onLogout }) {
  return (
    <div className="login-wrapper">
      <div className="login-card" style={{ maxWidth: '520px', textAlign: 'left' }}>
        <h2 className="mt-0">CRC Website Only</h2>
        <p>
          Signed in as <strong>{user.email}</strong>.
        </p>
        <p>
          TrialLight v1 keeps the website reserved for CRC workflows. Patient access is handled in the
          mobile app so study actions stay role-specific.
        </p>
        <div
          style={{
            marginTop: '16px',
            padding: '12px',
            borderRadius: '8px',
            background: '#fff4e5',
            border: '1px solid #ffd59e',
            color: '#7a4b00',
            fontSize: '14px',
          }}
        >
          If this is a patient account, sign out here and continue in the patient mobile app instead.
        </div>
        <button className="btn btn-primary" style={{ width: '100%', marginTop: '18px' }} onClick={onLogout}>
          Sign Out
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = `${APP_NAME} CRC Portal`;

    let iconLink = document.querySelector("link[rel~='icon']");
    if (!iconLink) {
      iconLink = document.createElement('link');
      iconLink.rel = 'icon';
      document.head.appendChild(iconLink);
    }
    iconLink.href = APP_ICON;

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser || null);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
  };

  const appStyle = {
    backgroundImage: APP_BACKGROUND_IMAGE ? `url("${APP_BACKGROUND_IMAGE}")` : 'none',
    backgroundSize: 'cover',
    backgroundAttachment: 'fixed',
    minHeight: '100vh',
    width: '100vw',
    backgroundColor: '#21313a',
  };

  const isCrcUser = Boolean(user?.email?.endsWith('@hospital.com'));

  if (loading) {
    return (
      <div
        style={{
          ...appStyle,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          color: 'white',
        }}
      >
        <h2>Loading CRC session...</h2>
      </div>
    );
  }

  return (
    <div style={appStyle}>
      <Routes>
        <Route
          path="/login"
          element={
            user ? (
              <Navigate to="/home" replace />
            ) : (
              <div className="login-wrapper">
                <h1
                  style={{
                    color: 'white',
                    textShadow: '0 2px 5px rgba(0,0,0,0.5)',
                    textAlign: 'center',
                    marginBottom: '20px',
                  }}
                >
                  {APP_NAME} CRC Portal
                </h1>
                <div
                  className="login-card"
                  style={{
                    marginBottom: '16px',
                    padding: '14px 16px',
                    maxWidth: '460px',
                    background: 'rgba(255,255,255,0.95)',
                    textAlign: 'left',
                  }}
                >
                  <strong>V1 boundary</strong>
                  <div style={{ marginTop: '8px', fontSize: '14px', color: '#555' }}>
                    The website is reserved for CRC workflows. Patient access belongs in the mobile app.
                  </div>
                </div>
                <Login type="crc" onLogin={() => {}} />
              </div>
            )
          }
        />

        <Route
          path="/home"
          element={
            !user ? (
              <Navigate to="/login" replace />
            ) : isCrcUser ? (
              <CRCHome user={user} onLogout={handleLogout} />
            ) : (
              <UnsupportedWebAccess user={user} onLogout={handleLogout} />
            )
          }
        />

        <Route
          path="/history"
          element={
            !user ? (
              <Navigate to="/login" replace />
            ) : isCrcUser ? (
              <HistoryPage user={user} onLogout={handleLogout} />
            ) : (
              <Navigate to="/home" replace />
            )
          }
        />

        <Route path="*" element={<Navigate to={user ? '/home' : '/login'} replace />} />
      </Routes>
    </div>
  );
}
