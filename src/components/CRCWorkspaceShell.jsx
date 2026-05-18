import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import TopNavbar from './TopNavbar';
import { TrialLightCrcMark, TrialLightCrcWordmark } from './TrialLightCrcBrand';

const SIDEBAR_STORAGE_KEY = 'triallight_crc_sidebar_collapsed';

function IconWrapper({ children }) {
  return <span className="crc-sidebar__navIconSvg">{children}</span>;
}

function CollapseIcon({ collapsed }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {collapsed ? (
        <path
          d="m9 6 6 6-6 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="m15 6-6 6 6 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

function NavIcon({ icon }) {
  switch (icon) {
    case 'dashboard':
      return (
        <IconWrapper>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
        </IconWrapper>
      );
    case 'patients':
      return (
        <IconWrapper>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="9.5" cy="8" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M17 11a3 3 0 1 0 0-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </IconWrapper>
      );
    case 'safety':
      return (
        <IconWrapper>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 3l8 4v5c0 5-3.5 7.7-8 9-4.5-1.3-8-4-8-9V7l8-4Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <path
              d="M9.5 12.5 11 14l3.5-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </IconWrapper>
      );
    case 'guidance':
      return (
        <IconWrapper>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 3a7 7 0 0 0-4 12.8V19a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-3.2A7 7 0 0 0 12 3Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <path d="M9.5 11.5h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </IconWrapper>
      );
    case 'dropout':
      return (
        <IconWrapper>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 18h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path
              d="m6 15 3-4 3 2 5-7 1 1"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </IconWrapper>
      );
    case 'protocol':
      return (
        <IconWrapper>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M7 3h8l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <path d="M15 3v5h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M9 12h6M9 16h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </IconWrapper>
      );
    case 'epro':
      return (
        <IconWrapper>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </IconWrapper>
      );
    case 'history':
      return (
        <IconWrapper>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4 12a8 8 0 1 0 2.3-5.6L4 8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M12 8v4l2.5 1.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </IconWrapper>
      );
    case 'resources':
      return (
        <IconWrapper>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v16H7.5A2.5 2.5 0 0 0 5 21.5V5.5Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <path
              d="M5 19.5A2.5 2.5 0 0 1 7.5 17H19"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </IconWrapper>
      );
    default:
      return null;
  }
}

export default function CRCWorkspaceShell({
  user,
  onLogout,
  navSections = [],
  activeNavId,
  alerts = [],
  onAlertsClick,
  alertButtonLabel,
  alertButtonUrgent = false,
  onHomeClick,
  headerTitle,
  headerDescription,
  searchValue = '',
  onSearchChange,
  searchPlaceholder,
  searchResults = [],
  onSearchSelect,
  statusItems = [],
  minimalNav = false,
  children,
}) {
  const navigate = useNavigate();
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(isCollapsed));
  }, [isCollapsed]);

  const handleNavClick = (item) => {
    if (!item) return;

    if (typeof item.onClick === 'function') {
      item.onClick();
      return;
    }

    if (item.path) {
      navigate(item.path);
    }
  };

  return (
    <div
      className={`crc-shell ${isCollapsed ? 'crc-shell--sidebarCollapsed' : ''} ${
        minimalNav ? 'crc-shell--minimalNav' : ''
      }`}
    >
      {!minimalNav ? (
        <aside className={`crc-sidebar ${isCollapsed ? 'crc-sidebar--collapsed' : ''}`}>
        <div className="crc-sidebar__header">
          <button
            type="button"
            className="crc-sidebar__brand"
            onClick={() => {
              navigate('/home?section=today');
              onHomeClick?.();
            }}
          >
            {isCollapsed ? (
              <TrialLightCrcMark size={50} />
            ) : (
              <TrialLightCrcWordmark className="crc-sidebar__brandLockup" subline="CRC Workspace" />
            )}
          </button>

          <button
            type="button"
            className="crc-sidebar__collapseToggle"
            onClick={() => setIsCollapsed((current) => !current)}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <CollapseIcon collapsed={isCollapsed} />
          </button>
        </div>

        <div className="crc-sidebar__scroll">
          <div className="crc-sidebar__navGroups" aria-label="CRC navigation">
            {navSections.map((group) => (
              <div key={group.title} className="crc-sidebar__navGroup">
                <div className="crc-sidebar__navLabel">{group.title}</div>
                <div className="crc-sidebar__nav">
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`crc-sidebar__navButton ${
                        activeNavId === item.id ? 'crc-sidebar__navButton--active' : ''
                      } ${item.emphasis ? `crc-sidebar__navButton--${item.emphasis}` : ''}`}
                      onClick={() => handleNavClick(item)}
                      title={item.label}
                    >
                      <span className="crc-sidebar__navIcon">
                        <NavIcon icon={item.icon} />
                      </span>
                      <span className="crc-sidebar__navText">
                        <span className="crc-sidebar__navTitleRow">
                          <span className="crc-sidebar__navTitle">{item.label}</span>
                          {item.badge ? <span className="crc-sidebar__navBadge">{item.badge}</span> : null}
                        </span>
                        {item.description ? (
                          <span className="crc-sidebar__navDescription">{item.description}</span>
                        ) : null}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            </div>
          </div>
        </aside>
      ) : null}

      <div className={`crc-shell__workspace ${minimalNav ? 'crc-shell__workspace--minimalNav' : ''}`}>
        <TopNavbar
          user={user}
          defaultRole="CRC"
          onLogout={onLogout}
          alerts={alerts}
          onAlertsClick={onAlertsClick}
        alertButtonLabel={alertButtonLabel}
        alertButtonUrgent={alertButtonUrgent}
        title={headerTitle}
        description={headerDescription}
        searchValue={searchValue}
        onSearchChange={onSearchChange}
        searchPlaceholder={searchPlaceholder}
        searchResults={searchResults}
        onSearchSelect={onSearchSelect}
        statusItems={statusItems}
      />

      <main className="crc-shell__content">{children}</main>
      </div>
    </div>
  );
}
