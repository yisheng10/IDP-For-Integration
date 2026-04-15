import React, { useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import ProfileModal from './ProfileModal';

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3a4 4 0 0 0-4 4v1.1c0 .9-.3 1.8-.9 2.5l-1.2 1.5A2 2 0 0 0 7.5 15h9a2 2 0 0 0 1.6-3.2l-1.2-1.5a4 4 0 0 1-.9-2.5V7a4 4 0 0 0-4-4Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 18a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function TopNavbar({
  user,
  defaultRole,
  onLogout,
  alerts = [],
  onAlertsClick,
  alertButtonLabel,
  alertButtonUrgent = false,
  title,
  description,
}) {
  const [displayName, setDisplayName] = useState(user.email);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const profileRef = useRef(null);

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
  };

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setShowProfileMenu(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeAllMenus();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const alertCount = alerts.filter((alert) => alert.status === 'unread').length;
  const resolvedAlertLabel = alertButtonLabel || (alertCount ? `Urgent (${alertCount})` : 'Urgent');

  return (
    <>
      <header className="topnav">
        <div className="topnav__headline">
          <div className="topnav__headlineCopy">
            <span className="topnav__eyebrow">{defaultRole} workspace</span>
            <h1 className="topnav__title">{title}</h1>
            <p className="topnav__description">{description}</p>
          </div>
        </div>

        <div className="topnav__right">
          <button
            type="button"
            className={`topnav__alertLauncher ${alertButtonUrgent ? 'topnav__alertLauncher--urgent' : ''}`}
            onClick={() => {
              closeAllMenus();
              onAlertsClick?.();
            }}
          >
            <span className="topnav__actionIcon">
              <BellIcon />
            </span>
            <span>{resolvedAlertLabel}</span>
          </button>

          <div className="topnav__menuAnchor" ref={profileRef}>
            <button
              type="button"
              className="topnav__profileButton"
              onClick={() => {
                closeAllMenus();
                setShowProfileMenu((current) => !current);
              }}
              aria-expanded={showProfileMenu}
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
