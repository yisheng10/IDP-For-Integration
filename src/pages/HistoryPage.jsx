import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
// Direct Firebase imports to bypass service layer
import { collectionGroup, query, orderBy, onSnapshot } from 'firebase/firestore'; 
import { db } from '../firebase';
import LiveChatWidget from '../components/LiveChatWidget';
import TopNavbar from '../components/TopNavbar';

const HistoryPage = ({ user, onLogout }) => {
  const [allAlerts, setAllAlerts] = useState([]);
  const [filteredAlerts, setFilteredAlerts] = useState([]);
  
  // Filters
  const [searchText, setSearchText] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [filterStatus, setFilterStatus] = useState("all"); 

  // Sorting
  const [sortConfig, setSortConfig] = useState({ key: 'timestamp', direction: 'desc' });

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Chat Widget State
  const [selectedAlert, setSelectedAlert] = useState(null);
  
  const navigate = useNavigate();

  useEffect(() => {
    // --- DIRECT FIREBASE FETCH (UNLIMITED) ---
    // This fetches every single document in any 'alerts' collection across the database
    const q = query(
      collectionGroup(db, 'alerts'), 
      orderBy('timestamp', 'desc')
    );
    
    const unsub = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(d => {
        // Safe UID extraction from path: users/{uid}/alerts/{alertId}
        const parentDoc = d.ref.parent.parent;
        const uid = parentDoc ? parentDoc.id : 'unknown';
        
        return { 
          id: d.id, 
          ref: d.ref, 
          uid: uid, 
          ...d.data() 
        };
      });
      setAllAlerts(data);
    }, (error) => {
      console.error("History Fetch Error:", error);
    });
    
    return () => unsub();
  }, []);

  // Filtering & Sorting Logic
  useEffect(() => {
    let result = [...allAlerts]; 

    // 1. Text Search
    if (searchText) {
      const lower = searchText.toLowerCase();
      result = result.filter(a => 
        (a.patientName || "").toLowerCase().includes(lower) ||
        (a.reason || "").toLowerCase().includes(lower) ||
        (a.uid || "").toLowerCase().includes(lower)
      );
    }

    // 2. Date Filter
    if (filterDate) {
      result = result.filter(a => {
        const aDate = new Date(a.timestamp).toISOString().split('T')[0];
        return aDate === filterDate;
      });
    }

    // 3. Status Filter (Improved Logic)
    if (filterStatus === 'unread') {
      result = result.filter(a => a.status === 'unread');
    } else if (filterStatus === 'read') {
      // Treat anything NOT 'unread' as Resolved (captures 'read', 'resolved', etc.)
      result = result.filter(a => a.status !== 'unread');
    }

    // 4. Sorting
    if (sortConfig.key) {
      result.sort((a, b) => {
        let valA = a[sortConfig.key] || "";
        let valB = b[sortConfig.key] || "";

        if (sortConfig.key === 'patientName') {
           valA = a.patientName || a.senderName || "";
           valB = b.patientName || b.senderName || "";
        }

        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    setFilteredAlerts(result);
    setCurrentPage(1); 
  }, [searchText, filterDate, filterStatus, allAlerts, sortConfig]);

  // --- PAGINATION LOGIC ---
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredAlerts.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(filteredAlerts.length / itemsPerPage);

  const handleHomeClick = () => navigate('/home');

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const getSortIndicator = (key) => {
    if (sortConfig.key !== key) return <span style={{color:'#ccc', fontSize:'10px', marginLeft:'5px'}}>⇅</span>;
    return sortConfig.direction === 'asc' ? ' ↑' : ' ↓';
  };

  const getStatusBadge = (status) => {
    const isActive = status === 'unread';
    return (
      <span style={{
        padding: '4px 8px', 
        borderRadius: '12px', 
        backgroundColor: isActive ? '#ffebee' : '#e8f5e9', 
        color: isActive ? '#d32f2f' : '#2e7d32',
        fontWeight: 'bold',
        fontSize: '11px',
        border: `1px solid ${isActive ? '#ffcdd2' : '#c8e6c9'}`
      }}>
        {isActive ? 'ACTIVE' : 'RESOLVED'}
      </span>
    );
  };

  return (
    <div style={{minHeight: '100vh', background: '#f4f6f8'}}>
      <TopNavbar 
        user={user} 
        defaultRole="CRC" 
        onLogout={onLogout} 
        onHomeClick={handleHomeClick} 
      />

      <div className="main-container">
        <div className="card" style={{borderTop: '4px solid #6c757d'}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'20px'}}>
            <h2 className="mt-0">📜 Global Alert History</h2>
            <div style={{color:'#666', fontSize:'14px'}}>
              Total Records: <strong>{filteredAlerts.length}</strong> (All Time)
            </div>
          </div>

          {/* FILTERS BAR */}
          <div style={styles.filterBar}>
            <input 
              type="text" 
              placeholder="🔍 Search Patient Name, ID or Reason..." 
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{flex: 2, padding:'10px', minWidth:'200px'}}
            />
            <input 
              type="date" 
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              style={{flex: 1, padding:'10px', minWidth:'150px'}}
            />
            <select 
              value={filterStatus} 
              onChange={(e) => setFilterStatus(e.target.value)}
              style={{flex: 1, padding:'10px', minWidth:'150px'}}
            >
              <option value="all">All Statuses</option>
              <option value="unread">Active (Unread)</option>
              <option value="read">Resolved (History)</option>
            </select>
            
            {(searchText || filterDate || filterStatus !== 'all') && (
              <button 
                onClick={() => { setSearchText(""); setFilterDate(""); setFilterStatus("all"); }}
                className="btn btn-secondary"
                style={{padding:'10px 20px'}}
              >
                Clear Filters
              </button>
            )}
          </div>

          {/* DATA TABLE */}
          <div className="table-wrapper" style={{background:'white', borderRadius:'8px', border:'1px solid #eee', overflow:'hidden'}}>
            <table style={{width:'100%', borderCollapse:'collapse'}}>
              <thead>
                <tr style={{background:'#f8f9fa', borderBottom:'2px solid #dee2e6', textAlign:'left'}}>
                  <th style={styles.thClickable} onClick={() => handleSort('timestamp')}>
                    Date & Time {getSortIndicator('timestamp')}
                  </th>
                  <th style={styles.thClickable} onClick={() => handleSort('status')}>
                    Status {getSortIndicator('status')}
                  </th>
                  <th style={styles.thClickable} onClick={() => handleSort('patientName')}>
                    Patient Name {getSortIndicator('patientName')}
                  </th>
                  <th style={styles.thClickable} onClick={() => handleSort('reason')}>
                    Reason / Title {getSortIndicator('reason')}
                  </th>
                  <th style={styles.thClickable} onClick={() => handleSort('lastSender')}>
                    Last Sender {getSortIndicator('lastSender')}
                  </th>
                  <th style={{...styles.th, textAlign:'right', cursor:'default'}}>Action</th>
                </tr>
              </thead>
              <tbody>
                {currentItems.length === 0 ? (
                  <tr><td colSpan="6" style={{padding:'40px', textAlign:'center', color:'#888', fontStyle:'italic'}}>No matching records found.</td></tr>
                ) : (
                  currentItems.map(alert => (
                    <tr key={alert.id} style={{borderBottom:'1px solid #f0f0f0', transition: 'background 0.2s'}} className="hover-row">
                      <td style={styles.td}>
                        {new Date(alert.timestamp).toLocaleDateString()} <span style={{color:'#888', fontSize:'11px'}}>{new Date(alert.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                      </td>
                      <td style={styles.td}>{getStatusBadge(alert.status)}</td>
                      <td style={{...styles.td, fontWeight:'bold', color:'#333'}}>
                        {alert.patientName || alert.senderName || 'Unknown'}
                      </td>
                      <td style={{...styles.td, color:'#555'}}>{alert.reason}</td>
                      <td style={{...styles.td, fontSize:'13px'}}>{alert.lastSender === 'crc' ? 'Staff' : 'Patient'}</td>
                      <td style={{...styles.td, textAlign:'right'}}>
                        <button 
                          className="btn btn-primary btn-small"
                          onClick={() => setSelectedAlert(alert)}
                        >
                          View Thread
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* --- PAGINATION CONTROLS --- */}
          {filteredAlerts.length > 0 && (
            <div style={styles.paginationBar}>
              <div style={{display:'flex', alignItems:'center', gap:'10px'}}>
                <span style={{fontSize:'14px', color:'#666'}}>Rows per page:</span>
                <select 
                  value={itemsPerPage} 
                  onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                  style={{padding:'5px', borderRadius:'4px', border:'1px solid #ccc'}}
                >
                  <option value={10}>10</option>
                  <option value={30}>30</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>

              <div style={{display:'flex', alignItems:'center', gap:'10px'}}>
                <span style={{fontSize:'14px', color:'#666'}}>
                  Page <strong>{currentPage}</strong> of <strong>{totalPages || 1}</strong>
                </span>
                
                <div style={{display:'flex', gap:'5px'}}>
                  <button 
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="btn btn-secondary btn-small"
                    style={{padding:'5px 10px', opacity: currentPage === 1 ? 0.5 : 1}}
                  >
                    ◀ Prev
                  </button>
                  <button 
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className="btn btn-secondary btn-small"
                    style={{padding:'5px 10px', opacity: currentPage === totalPages ? 0.5 : 1}}
                  >
                    Next ▶
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {selectedAlert && (
        <LiveChatWidget 
          user={user}
          role="crc"
          userName="CRC Admin"
          existingAlert={selectedAlert}
          recipientId={selectedAlert.uid}
          recipientName={selectedAlert.patientName}
          onClose={() => setSelectedAlert(null)}
          // --- FIX: Pass FULL LIST so the chat widget knows about resolved items ---
          allAlerts={allAlerts} 
          activeEmergencies={[]}
        />
      )}
    </div>
  );
};

const styles = {
  filterBar: {
    display: 'flex', 
    gap: '10px', 
    marginBottom: '20px', 
    flexWrap: 'wrap', 
    background: '#f8f9fa', 
    padding: '15px', 
    borderRadius: '8px', 
    border: '1px solid #eee'
  },
  paginationBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: '15px',
    paddingTop: '15px',
    borderTop: '1px solid #eee'
  },
  th: { padding: '15px 12px', color: '#495057', fontSize: '14px', fontWeight: 'bold' },
  thClickable: { 
    padding: '15px 12px', 
    color: '#495057', 
    fontSize: '14px', 
    fontWeight: 'bold', 
    cursor: 'pointer', 
    userSelect: 'none',
    transition: 'background 0.2s'
  },
  td: { padding: '12px', fontSize: '14px', verticalAlign: 'middle' }
};

export default HistoryPage;