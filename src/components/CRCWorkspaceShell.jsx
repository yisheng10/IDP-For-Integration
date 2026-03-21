import React from 'react';
import { useNavigate } from 'react-router-dom';
import { APP_NAME } from '../config';
import TopNavbar from './TopNavbar';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', path: '/home' },
  { id: 'history', label: 'History', path: '/history' },
];

export default function CRCWorkspaceShell({
  user,
  onLogout,
  activePage,
  alerts = [],
  onAlertClick,
  onHomeClick,
  headerEyebrow,
  title,
  description,
  stats = [],
  sidebarContent,
  utilityContent,
  children,
}) {
  const navigate = useNavigate();

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

        <nav className="crc-sidebar__nav" aria-label="CRC navigation">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`crc-sidebar__navButton ${
                activePage === item.id ? 'crc-sidebar__navButton--active' : ''
              }`}
              onClick={() => {
                navigate(item.path);
                if (item.id === 'dashboard') onHomeClick?.();
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="crc-sidebar__body">{sidebarContent}</div>

        <div className="crc-sidebar__footer">
          Structured study-linked records, CRC-only risk visibility, and browser alerts stay inside this workspace.
        </div>
      </aside>

      <div className="crc-shell__workspace">
        <TopNavbar
          user={user}
          defaultRole="CRC"
          onLogout={onLogout}
          alerts={alerts}
          onAlertClick={onAlertClick}
          onHomeClick={onHomeClick}
        />

        <section className="crc-hero card">
          <div className="crc-hero__copy">
            <div className="dashboard-kicker">{headerEyebrow}</div>
            <h1 className="dashboard-title">{title}</h1>
            <p className="dashboard-subtitle">{description}</p>
          </div>

          {stats.length ? (
            <div className="crc-hero__stats">
              {stats.map((entry) => (
                <div key={entry.label} className="stat-card">
                  <strong>{entry.value}</strong>
                  <span>{entry.label}</span>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <div className={`crc-page ${utilityContent ? 'crc-page--with-utility' : ''}`}>
          <main className="crc-page__main">{children}</main>
          {utilityContent ? <aside className="crc-page__utility">{utilityContent}</aside> : null}
        </div>
      </div>
    </div>
  );
}
