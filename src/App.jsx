import React, { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { APP_ICON, APP_NAME } from './config';
import Login from './components/Login';
import { auth } from './firebase';
import CRCHome from './pages/CRCHome';
import { TrialLightCrcWordmark } from './components/TrialLightCrcBrand';
import TrialLightCrcIllustration from './components/TrialLightCrcIllustration';

class CRCWorkspaceErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('CRC workspace runtime error:', error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="login-wrapper">
          <div className="login-card" style={{ maxWidth: '640px' }}>
            <div className="dashboard-kicker">CRC workspace error</div>
            <h2 className="mt-0" style={{ marginBottom: '10px' }}>
              The CRC workspace could not finish loading
            </h2>
            <p className="section-note">
              The sign-in succeeded, but the main CRC workspace crashed during startup. The message below is the
              actual runtime error, not a generic white screen.
            </p>
            <div
              className="info-banner"
              style={{
                marginTop: '16px',
                background: 'rgba(255, 245, 245, 0.96)',
                borderColor: '#efc3c3',
                color: 'var(--danger)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              <strong>Runtime error:</strong> {this.state.error?.message || 'Unknown CRC workspace error'}
            </div>
            <div className="workspace-actionStrip" style={{ marginTop: '18px' }}>
              <button className="btn btn-primary" onClick={() => window.location.assign('/login')}>
                Back to sign-in
              </button>
              <button className="btn btn-secondary" onClick={() => window.location.reload()}>
                Reload workspace
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function UnsupportedWebAccess({ user, onLogout }) {
  return (
    <div className="login-wrapper">
      <div className="login-card" style={{ maxWidth: '560px' }}>
        <div className="dashboard-kicker">Access boundary</div>
        <h2 className="mt-0" style={{ marginBottom: '12px' }}>CRC Website Only</h2>
        <p>
          Signed in as <strong>{user.email}</strong>.
        </p>
        <p>
          TrialLight v1 keeps the website reserved for CRC workflows. Patient access is handled in the
          mobile app so study actions stay role-specific.
        </p>
        <div className="info-banner" style={{ marginTop: '16px', background: 'var(--warning-soft)', borderColor: '#f0d6a9', color: 'var(--warning)' }}>
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
  const [authBootstrapWarning, setAuthBootstrapWarning] = useState(false);

  useEffect(() => {
    document.title = `${APP_NAME} CRC Workspace`;

    let iconLink = document.querySelector("link[rel~='icon']");
    if (!iconLink) {
      iconLink = document.createElement('link');
      iconLink.rel = 'icon';
      document.head.appendChild(iconLink);
    }
    iconLink.href = APP_ICON;

    let authResolved = false;
    const bootstrapTimeout = window.setTimeout(() => {
      if (!authResolved) {
        setAuthBootstrapWarning(true);
        setLoading(false);
      }
    }, 4000);

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      authResolved = true;
      window.clearTimeout(bootstrapTimeout);
      setUser(currentUser || null);
      setLoading(false);
    });

    return () => {
      authResolved = true;
      window.clearTimeout(bootstrapTimeout);
      unsubscribe();
    };
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
  };

  const appStyle = {
    minHeight: '100vh',
    width: '100vw',
    backgroundColor: '#edf3f8',
  };

  const isCrcUser = Boolean(user?.email?.endsWith('@hospital.com'));

  if (loading) {
    return (
      <div style={appStyle}>
        <div className="login-wrapper">
          <div className="login-card" style={{ maxWidth: '560px' }}>
            <div className="dashboard-kicker">Starting workspace</div>
            <h2 className="mt-0" style={{ marginBottom: '10px' }}>
              Loading CRC session...
            </h2>
            <p className="section-note">
              Checking the saved Firebase sign-in state. If this takes longer than a few seconds, the
              sign-in screen will open automatically.
            </p>
          </div>
        </div>
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
                  <div className="login-portal login-portal--split">
                  <div className="login-card login-card--intro">
                      <TrialLightCrcWordmark className="login-portal__brandLockup" />
                      <p className="login-portal__subtitle">
                        A CRC and PI workspace for Drug Clinical Trial: Adverse Event Guidance, Patient Disengagement Prediction, and Protocol-linked Follow-up.
                      </p>
                      <TrialLightCrcIllustration />
                    </div>

                  <div className="login-portal__authColumn">
                    <Login type="crc" onLogin={() => {}} />
                    <div className="login-card login-card--access">
                      <div className="dashboard-kicker">CRC access only</div>
                      <p className="section-note" style={{ margin: 0 }}>
                        This system is for clinical research coordinators and authorized study staff only.
                      </p>
                    </div>
                    <div className="login-portal__legal">
                      By signing in, you agree to the TrialLight Terms of Use and Privacy Policy.
                    </div>
                    {authBootstrapWarning ? (
                      <div
                        className="info-banner login-portal__warning"
                        style={{
                          background: 'rgba(255, 248, 235, 0.96)',
                          borderColor: '#f0d6a9',
                          color: 'var(--warning)',
                        }}
                      >
                        Saved session recovery took longer than expected, so the website continued to the sign-in
                        screen. If you were expecting an automatic sign-in, refresh once after login services
                        stabilize.
                      </div>
                    ) : null}
                  </div>
                </div>
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
              <CRCWorkspaceErrorBoundary>
                <CRCHome user={user} onLogout={handleLogout} />
              </CRCWorkspaceErrorBoundary>
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
              <Navigate to="/home?section=safety&tab=history" replace />
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
