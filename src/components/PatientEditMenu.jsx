import React from 'react';

const PatientEditMenu = ({ 
  patient, 
  hospitalId, 
  setHospitalId, 
  email, 
  setEmail, 
  primaryCrcId,
  setPrimaryCrcId,
  crcUsers,
  vitalsConfig, 
  setVitalsConfig, 
  vitalOptions, 
  onSave, 
  onDelete, 
  isSaving, 
  successMsg 
}) => {
  
  const handleVitalToggle = (key) => {
    setVitalsConfig(prev => ({ ...prev, [key]: !prev[key] }));
  };

  if (!patient) return null;

  return (
    <div style={{background:'#f8f9fa', padding:'15px', borderRadius:'8px', marginBottom:'20px'}}>
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px'}}>
        <h4 className="mt-0">Edit Info & Configuration</h4>
        
        <button 
          onClick={onDelete} 
          className="btn btn-danger btn-small"
          style={{backgroundColor: '#dc3545', fontSize: '12px'}}
        >
          🗑️ Delete Patient
        </button>
      </div>
      
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px', marginBottom:'15px'}}>
        <input 
          value={hospitalId} 
          onChange={e => setHospitalId(e.target.value)} 
          placeholder="Hospital ID" 
        />
        <input 
          value={email} 
          onChange={e => setEmail(e.target.value)} 
          placeholder="Email" 
        />
      </div>

      <div style={{marginBottom:'15px'}}>
        <label style={{fontWeight:'bold', display:'block', marginBottom:'5px'}}>Primary CRC:</label>
        <select value={primaryCrcId || ''} onChange={e => setPrimaryCrcId(e.target.value)} style={{width:'100%'}}>
          <option value="">Unassigned</option>
          {(crcUsers || []).map((crc) => (
            <option key={crc.id} value={crc.id}>
              {crc.nickname || crc.email || crc.id}
            </option>
          ))}
        </select>
      </div>

      <div style={{borderTop:'1px solid #ddd', paddingTop:'10px'}}>
        <label style={{fontWeight:'bold', display:'block', marginBottom:'5px'}}>Monitored Vitals:</label>
        <div style={{display:'flex', flexWrap:'wrap', gap:'15px'}}>
          {vitalOptions.map(opt => (
            <label key={opt.key} style={{display:'flex', alignItems:'center', cursor:'pointer', minWidth: '120px'}}>
              <input 
                type="checkbox" 
                checked={!!vitalsConfig[opt.key]} 
                onChange={() => handleVitalToggle(opt.key)} 
              /> 
              <span style={{marginLeft:'5px'}}>{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div style={{marginTop: '15px', display: 'flex', alignItems: 'center', gap: '15px'}}>
        <button 
          onClick={onSave} 
          className="btn btn-success btn-small"
          disabled={isSaving} 
          style={{ opacity: isSaving ? 0.7 : 1 }}
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
        {successMsg && <span style={{color: 'green', fontWeight: 'bold', fontSize: '14px'}}>✓ {successMsg}</span>}
      </div>
    </div>
  );
};

export default PatientEditMenu;
