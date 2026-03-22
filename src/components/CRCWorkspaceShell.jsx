import React from 'react';
import { useNavigate } from 'react-router-dom';
import { APP_NAME } from '../config';
import TopNavbar from './TopNavbar';

export default function CRCWorkspaceShell({
  user,
  onLogout,
  navSections = [],
  activeNavId,
  alerts = [],
  onAlertClick,
  onHomeClick,
  headerTitle,
  headerDescription,
  headerSearchValue,
  headerSearchPlaceholder,
  onHeaderSearchChange,
  headerSearchDisabled = false,
  headerContext = [],
  sidebarContent,
  sidebarFooter,
  children,
}) {
  const navigate = useNavigate();

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
    <div className="crc-shell">
      <aside className="crc-sidebar">
        <button
          type="button"
          className="crc-sidebar__brand"
          onClick={() => {
            navigate('/home');
            onHomeClick?.();
          }}
        >
          <span className="crc-sidebar__brandMark">TL</span>
          <span>
            <span className="crc-sidebar__brandEyebrow">CRC workspace</span>
            <span className="crc-sidebar__brandName">{APP_NAME}</span>
          </span>
        </button>

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
                    }`}
                    onClick={() => handleNavClick(item)}
                  >
                    <span className="crc-sidebar__navIcon">{item.shortLabel || item.label.slice(0, 1)}</span>
                    <span className="crc-sidebar__navText">
                      <span className="crc-sidebar__navTitle">{item.label}</span>
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

        {sidebarContent ? <div className="crc-sidebar__body">{sidebarContent}</div> : null}

        <div className="crc-sidebar__footer">
          {sidebarFooter ||
            'Structured study-linked records, CRC-only risk visibility, and browser alerts stay inside this workspace.'}
        </div>
      </aside>

      <div className="crc-shell__workspace">
        <TopNavbar
          user={user}
          defaultRole="CRC"
          onLogout={onLogout}
          alerts={alerts}
          onAlertClick={onAlertClick}
          title={headerTitle}
          description={headerDescription}
          searchValue={headerSearchValue}
          searchPlaceholder={headerSearchPlaceholder}
          onSearchChange={onHeaderSearchChange}
          searchDisabled={headerSearchDisabled}
          contextItems={headerContext}
        />

        <main className="crc-shell__content">{children}</main>
      </div>
    </div>
  );
}
