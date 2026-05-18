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

function StatusShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3l7 3.5v4.7c0 4.4-2.8 7-7 8.8-4.2-1.8-7-4.4-7-8.8V6.5L12 3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="m9.4 11.8 1.8 1.8 3.6-3.9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StatusLockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5.5" y="10.5" width="13" height="10" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function StatusClockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.8v4.8l3 1.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StatusIndicator({ icon, label }) {
  return (
    <div className="topnav__statusItem" aria-label={label}>
      <span className="topnav__statusIcon" aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
    </div>
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
  searchValue = '',
  onSearchChange,
  searchPlaceholder = 'Search loaded patients',
  searchResults = [],
  onSearchSelect,
  statusItems = [],
}) {
  const [displayName, setDisplayName] = useState(user.email);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const profileRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.nickname) setDisplayName(data.nickname);
      }
    });

    return () => unsubscribe();
  }, [user.uid]);

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
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setShowSearchResults(false);
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
  const hasSearchResults = Array.isArray(searchResults) && searchResults.length > 0;

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

        <div className="topnav__searchWrap" ref={searchRef}>
          <input
            type="search"
            className="topnav__searchInput"
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={(event) => {
              onSearchChange?.(event.target.value);
              setShowSearchResults(true);
            }}
            onFocus={() => setShowSearchResults(true)}
          />
          {showSearchResults && searchValue.trim() ? (
            <div className="topnav__dropdown topnav__dropdown--wide">
              <div className="topnav__dropdownHeader">
                {hasSearchResults ? 'Loaded patient matches' : 'No loaded patients match this search'}
              </div>
              {hasSearchResults ? (
                searchResults.map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    className="topnav__dropdownItem"
                    onClick={() => {
                      onSearchSelect?.(result);
                      setShowSearchResults(false);
                    }}
                  >
                    <div className="topnav__searchResultTitle">{result.nickname || result.email || 'Unnamed patient'}</div>
                    <div className="topnav__searchResultMeta">
                      {(result.subject_id || result.subjectId || 'No subject ID') + ' • ' + (result.primary_crc_name || 'Unassigned CRC')}
                    </div>
                  </button>
                ))
              ) : (
                <div className="topnav__dropdownEmpty">
                  Search only works against the currently loaded CRC patient roster window.
                </div>
              )}
            </div>
          ) : null}
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

          {statusItems.length ? (
            <div className="topnav__statusRail" aria-label="Workspace status">
              {statusItems.map((item) => {
                let iconNode = <StatusShieldIcon />;
                if (item.icon === 'lock') iconNode = <StatusLockIcon />;
                if (item.icon === 'clock') iconNode = <StatusClockIcon />;
                return <StatusIndicator key={item.label} icon={iconNode} label={item.label} />;
              })}
            </div>
          ) : null}

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
