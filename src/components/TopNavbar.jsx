import React, { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { APP_NAME } from '../config';
import { db } from '../firebase';
import { getSignedUrl } from '../services/storageService';
import ProfileModal from './ProfileModal';

export default function TopNavbar({
  user,
  defaultRole,
  onLogout,
  alerts = [],
  onAlertClick,
  onHomeClick,
}) {
  const [displayName, setDisplayName] = useState(user.email);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showResourceMenu, setShowResourceMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const navigate = useNavigate();

  const pdfResources = [{ id: 'ctcae', title: 'CTCAE Guidelines (PDF)', filePath: 'CTCAE.pdf' }];

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.nickname) setDisplayName(data.nickname);
      }
    });

    return () => unsubscribe();
  }, [user]);

  const displayInitials = useMemo(() => {
    const words = String(displayName || 'User')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2);

    if (!words.length) return 'U';
    return words.map((word) => word[0].toUpperCase()).join('');
  }, [displayName]);

  const closeAllMenus = () => {
    setShowProfileMenu(false);
    setShowResourceMenu(false);
    setShowNotifications(false);
  };

  const handleOpenPdf = async (resource) => {
    const newTab = window.open('', '_blank');
    if (!newTab) {
      alert('Please allow popups for this site to open the resource.');
      return;
    }

    newTab.document.write('Loading...');
    try {
      const secureUrl = await getSignedUrl(resource.filePath);
      if (secureUrl) {
        newTab.location.href = secureUrl;
      } else {
        newTab.close();
        alert('Unable to generate the document link.');
      }
      setShowResourceMenu(false);
    } catch (error) {
      console.error('Failed to open resource:', error);
      newTab.close();
      alert('Unable to open the document.');
    }
  };

  const handleHomePress = () => {
    closeAllMenus();
    navigate('/home');
    onHomeClick?.();
  };

  const handleHistoryPress = () => {
    closeAllMenus();
    navigate('/history');
  };

  return (
    <>
      <header className="topnav">
        <button type="button" className="topnav__brandButton" onClick={handleHomePress}>
          <span className="topnav__brandEyebrow">{defaultRole} workspace</span>
          <span className="topnav__brandName">{APP_NAME}</span>
        </button>

        <div className="topnav__right">
          {defaultRole === 'CRC' ? (
            <button type="button" className="topnav__actionButton topnav__actionButton--ghost" onClick={handleHistoryPress}>
              Open history
            </button>
          ) : null}

          <div className="topnav__menuAnchor">
            <button
              type="button"
              className="topnav__actionButton"
              onClick={() => {
                closeAllMenus();
                setShowResourceMenu((current) => !current);
              }}
            >
              Resources
            </button>
            {showResourceMenu ? (
              <div className="topnav__dropdown">
                <div className="topnav__dropdownHeader">Clinical Resources</div>
                {pdfResources.map((resource) => (
                  <button
                    key={resource.id}
                    type="button"
                    className="topnav__dropdownItem"
                    onClick={() => handleOpenPdf(resource)}
                  >
                    {resource.title}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="topnav__menuAnchor">
            <button
              type="button"
              className="topnav__actionButton"
              onClick={() => {
                closeAllMenus();
                setShowNotifications((current) => !current);
              }}
            >
              Alerts
              {alerts.length ? <span className="topnav__badge">{alerts.length}</span> : null}
            </button>
            {showNotifications ? (
              <div className="topnav__dropdown topnav__dropdown--wide">
                <div className="topnav__dropdownHeader">Active Alerts ({alerts.length})</div>
                {alerts.length === 0 ? (
                  <div className="topnav__dropdownEmpty">No active alerts.</div>
                ) : (
                  alerts.map((alert) => (
                    <button
                      key={alert.id}
                      type="button"
                      className="topnav__dropdownItem"
                      onClick={() => {
                        onAlertClick?.(alert);
                        setShowNotifications(false);
                      }}
                    >
                      <div className="topnav__alertTitle">{alert.reason}</div>
                      <div className="topnav__alertMeta">{alert.patientName || 'System alert'}</div>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>

          <div className="topnav__menuAnchor">
            <button
              type="button"
              className="topnav__profileButton"
              onClick={() => {
                closeAllMenus();
                setShowProfileMenu((current) => !current);
              }}
            >
              <span className="topnav__avatar">{displayInitials}</span>
              <span className="topnav__profileText">
                <strong>{displayName ? displayName.split(' ')[0] : 'User'}</strong>
                <span>{defaultRole}</span>
              </span>
            </button>
            {showProfileMenu ? (
              <div className="topnav__dropdown topnav__dropdown--right">
                <div className="topnav__dropdownHeader">Profile</div>
                <button
                  type="button"
                  className="topnav__dropdownItem"
                  onClick={() => {
                    setShowEditProfile(true);
                    setShowProfileMenu(false);
                  }}
                >
                  Edit profile
                </button>
                <button type="button" className="topnav__dropdownItem topnav__dropdownItem--danger" onClick={onLogout}>
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {showEditProfile ? (
        <div className="modal-shell">
          <div className="modal-card">
            <button className="modal-close" onClick={() => setShowEditProfile(false)}>
              Close
            </button>
            <ProfileModal user={user} defaultRole={defaultRole} onClose={() => setShowEditProfile(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}
