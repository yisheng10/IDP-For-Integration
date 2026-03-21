export const styles = {
  navbar: { position: 'fixed', top: 0, left: 0, width: '100%', height: '60px', backgroundColor: '#333', color: 'white', display: 'flex', alignItems: 'center', padding: '0 20px', zIndex: 1000, boxSizing: 'border-box' },
  navProfile: { cursor: 'pointer', padding: '8px 12px', background: '#444', borderRadius: '5px' },
  dropdownMenu: { position: 'absolute', top: '110%', left: 0, background: 'white', color: 'black', border: '1px solid #ccc', borderRadius: '5px', width: '150px' },
  dropdownItem: { padding: '10px', borderBottom: '1px solid #eee', cursor: 'pointer' },
  modalOverlay: { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 },
  modalContent: { background: 'white', padding: '30px', borderRadius: '10px', width: '400px', maxWidth: '90%' },
  // ... (Add other common styles like .card or .mainContainer if you convert them back from CSS)
};

export const chatStyles = {
  floatingButton: { position: 'fixed', bottom: '20px', right: '20px', backgroundColor: '#0056b3', color: 'white', padding: '15px 20px', borderRadius: '30px', cursor: 'pointer', boxShadow: '0 4px 10px rgba(0,0,0,0.2)', fontWeight: 'bold', zIndex: 9999 },
  chatWindow: { position: 'fixed', bottom: '80px', right: '20px', width: '320px', height: '450px', backgroundColor: 'white', borderRadius: '10px', boxShadow: '0 5px 20px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', zIndex: 9999, overflow: 'hidden', border: '1px solid #ccc' },
  header: { background: '#0056b3', color: 'white', padding: '10px', display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' },
  closeBtn: { background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontWeight: 'bold' },
  messagesArea: { flex: 1, padding: '10px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' },
  userMsg: { alignSelf: 'flex-end', background: '#007bff', color: 'white', padding: '8px 12px', borderRadius: '15px 15px 0 15px', maxWidth: '80%', fontSize: '14px' },
  modelMsg: { alignSelf: 'flex-start', background: '#f1f1f1', color: 'black', padding: '8px 12px', borderRadius: '15px 15px 15px 0', maxWidth: '80%', fontSize: '14px' },
  inputArea: { borderTop: '1px solid #eee', padding: '10px', display: 'flex', gap: '5px' },
  input: { flex: 1, padding: '8px', borderRadius: '20px', border: '1px solid #ccc', outline: 'none' },
  sendBtn: { background: '#0056b3', color: 'white', border: 'none', borderRadius: '50%', width: '35px', height: '35px', cursor: 'pointer' }
};