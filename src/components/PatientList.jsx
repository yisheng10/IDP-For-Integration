import React, { useState } from 'react';

const PatientList = ({ patients, selectedPatientId, onSelect }) => {
  const [searchQuery, setSearchQuery] = useState('');

  // Filter Logic isolated here
  const filteredPatients = patients.filter(p => {
    const query = searchQuery.toLowerCase();
    const name = (p.nickname || "").toLowerCase();
    const id = (p.hospitalPatientId || "").toLowerCase();
    return name.includes(query) || id.includes(query);
  });

  return (
    <div className="card patient-list-container">
      <h3 className="mt-0">Patients</h3>
      
      {/* Search Bar (Stays Fixed at Top) */}
      <input 
        type="text" 
        placeholder="🔍 Search name or ID..." 
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        style={{
          marginBottom: '15px', 
          padding: '10px', 
          borderRadius: '5px', 
          border: '1px solid #ccc',
          width: '100%'
        }}
      />

      {/* --- SCROLLABLE LIST CONTAINER --- */}
      <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
        
        {filteredPatients.length === 0 ? (
          <p style={{color: '#999', textAlign: 'center'}}>No patients found.</p>
        ) : (
          filteredPatients.map(p => {
            const isSelected = selectedPatientId === p.id;
            return (
              <div 
                key={p.id} 
                onClick={() => onSelect(isSelected ? null : p)} 
                style={{
                  padding: '10px', 
                  borderBottom: '1px solid #eee', 
                  cursor: 'pointer', 
                  background: isSelected ? '#e7f1ff' : 'transparent'
                }}
              >
                <strong>{p.nickname || "No Name"}</strong>
                {p.hospitalPatientId && (
                  <span style={{fontSize:'12px', color:'#007bff', marginLeft:'5px'}}>
                    (ID: {p.hospitalPatientId})
                  </span>
                )}
                <div style={{fontSize:'12px', color:'#666'}}>{p.email}</div>
              </div>
            );
          })
        )}
        
      </div>
      {/* ---------------------------------- */}

    </div>
  );
};

export default PatientList;