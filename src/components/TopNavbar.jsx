import React, { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { APP_NAME } from '../config';
import { db } from '../firebase';
import { getSignedUrl } from '../services/storageService';
import ProfileModal from './ProfileModal';

const TopNavbar = ({ user, defaultRole, onLogout, alerts = [], onAlertClick, onHomeClick }) => {
  const [displayName, setDisplayName] = useState(user.email);
  const navigate = useNavigate();
  
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showResourceMenu, setShowResourceMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);

  const pdfResources = [
    { id: 'ctcae', title: 'CTCAE Guidelines (PDF)', filePath: 'CTCAE.pdf' }
  ];

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "users", user.uid), (d) => {
      if (d.exists()) {
        const data = d.data();
        if (data.nickname) setDisplayName(data.nickname);
      }
    });
    return () => unsub();
  }, [user]);

  const handleOpenPdf = async (resource) => {
    const newTab = window.open('', '_blank');
    if (!newTab) { alert("Please allow popups."); return; }
    newTab.document.write('Loading...');
    try {
      const secureUrl = await getSignedUrl(resource.filePath);
      if (secureUrl) newTab.location.href = secureUrl;
      else { newTab.close(); alert("Link error"); }
      setShowResourceMenu(false);
    } catch (e) { newTab.close(); }
  };

  const closeAllMenus = () => {
    setShowProfileMenu(false);
    setShowResourceMenu(false);
    setShowNotifications(false);
  };

  const handleHomePress = () => {
    closeAllMenus();
    navigate('/home'); 
    if (onHomeClick) onHomeClick(); 
  };

  // --- NEW: HISTORY HANDLER ---
  const handleHistoryPress = () => {
    closeAllMenus();
    navigate('/history');
  };

  return (
    <div style={styles.navbar}>
      <div style={styles.leftGroup}>
        
        {/* Home Icon */}
        <button onClick={handleHomePress} style={styles.navItem} title="Home">
          <span style={{fontSize: '24px'}}>🏠</span>
          <span style={styles.navText}>Home</span>
        </button>

        {/* --- NEW: HISTORY BUTTON (CRC Only) --- */}
        {defaultRole === 'CRC' && (
          <button onClick={handleHistoryPress} style={styles.navItem} title="All History">
            <span style={{fontSize: '24px'}}>📜</span>
            <span style={styles.navText}>History</span>
          </button>
        )}

        {/* Profile Icon */}
        <button onClick={() => { closeAllMenus(); setShowProfileMenu(!showProfileMenu); }} style={styles.navItem} title="Profile">
          <span style={{fontSize: '24px'}}>👤</span>
          <span style={styles.navText}>{displayName ? displayName.split(' ')[0] : 'User'}</span>
        </button>

        {/* Resources Icon */}
        <button onClick={() => { closeAllMenus(); setShowResourceMenu(!showResourceMenu); }} style={styles.navItem} title="Resources">
           <span style={{fontSize: '24px'}}>📚</span>
          <span style={styles.navText}>Resources</span>
        </button>

        {/* Notification Bell */}
        <button onClick={() => { closeAllMenus(); setShowNotifications(!showNotifications); }} style={styles.navItem} title="Notifications">
          <div style={{position: 'relative'}}>
            <span style={{fontSize: '24px'}}>🔔</span>
            {alerts && alerts.length > 0 && (
              <div style={styles.badge}><span style={styles.badgeText}>{alerts.length}</span></div>
            )}
          </div>
        </button>
      </div>

      <span style={styles.appName}>{APP_NAME}</span>

      {/* --- MENUS --- */}
      {showProfileMenu && (
        <div style={{...styles.dropdown, left: '10px'}}>
          <button style={styles.dropdownItem} onClick={() => { setShowEditProfile(true); setShowProfileMenu(false); }}>Edit Profile</button>
          <button style={{...styles.dropdownItem, color: 'red'}} onClick={onLogout}>Logout</button>
        </div>
      )}

      {showResourceMenu && (
        <div style={{...styles.dropdown, left: '80px', width: '220px'}}>
          <div style={styles.dropdownHeader}>Clinical Guidelines</div>
          {pdfResources.map((item) => (
            <button key={item.id} style={{...styles.dropdownItem, color: '#007bff'}} onClick={() => handleOpenPdf(item)}>📄 {item.title}</button>
          ))}
        </div>
      )}

      {showNotifications && (
        <div style={{...styles.dropdown, left: '140px', width: '300px'}}>
          <div style={styles.dropdownHeader}>Active Alerts ({alerts.length})</div>
          <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
            {alerts.length === 0 ? <div style={{padding:'10px', color:'#999'}}>No alerts.</div> : (
              alerts.map(alert => (
                <button key={alert.id} style={styles.dropdownItem} onClick={() => { if(onAlertClick) onAlertClick(alert); setShowNotifications(false); }}>
                  <div style={{color: '#d32f2f', fontWeight: 'bold'}}>{alert.reason}</div>
                  <div style={{fontSize: '11px', color: '#666'}}>{alert.patientName || 'System'}</div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {showEditProfile && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent}>
            <button style={styles.closeModalBtn} onClick={() => setShowEditProfile(false)}>✕</button>
            <ProfileModal user={user} defaultRole={defaultRole} onClose={() => setShowEditProfile(false)} />
          </div>
        </div>
      )}
    </div>
  );
};

const styles = {
  navbar: { height: '60px', backgroundColor: '#333', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 15px', position: 'relative', color: 'white', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' },
  leftGroup: { display: 'flex', alignItems: 'center', gap: '20px' },
  navItem: { background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white', padding: 0 },
  navText: { color: 'white', fontSize: '10px', marginTop: '2px' }, 
  appName: { fontSize: '18px', fontWeight: 'bold' },
  badge: { position: 'absolute', top: '-5px', right: '-5px', backgroundColor: 'red', borderRadius: '50%', width: '16px', height: '16px', display: 'flex', justifyContent: 'center', alignItems: 'center' },
  badgeText: { color: 'white', fontSize: '10px', fontWeight: 'bold' },
  dropdown: { position: 'absolute', top: '65px', width: '200px', backgroundColor: 'white', borderRadius: '5px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)', border: '1px solid #ddd', zIndex: 1000, overflow: 'hidden', color: '#333' },
  dropdownHeader: { fontWeight: 'bold', padding: '10px', borderBottom: '1px solid #eee', backgroundColor: '#f9f9f9', fontSize: '13px' },
  dropdownItem: { width: '100%', padding: '12px', borderBottom: '1px solid #eee', background: 'white', border: 'none', textAlign: 'left', cursor: 'pointer', fontSize: '14px', display: 'block' },
  modalOverlay: { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: 'white', padding: '20px', borderRadius: '10px', width: '90%', maxWidth: '500px', position: 'relative', color: '#333' },
  closeModalBtn: { position: 'absolute', top: '10px', right: '10px', background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer' }
};

export default TopNavbar;