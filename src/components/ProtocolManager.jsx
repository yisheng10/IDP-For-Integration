import React, { useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  coerceNotificationPolicy,
  getDefaultNotificationPolicy,
} from '../services/incidentService';
import { supabase } from '../supabaseClient';

const POLICY_FIELDS = ['mild', 'moderate', 'serious'];

const ProtocolManager = ({ selectedPatient }) => {
  const [file, setFile] = useState(null);
  const [protocols, setProtocols] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [policyDrafts, setPolicyDrafts] = useState({});

  useEffect(() => {
    const protocolsQuery = query(collection(db, 'protocols'), orderBy('uploadedAt', 'desc'));

    const unsubscribe = onSnapshot(protocolsQuery, (snapshot) => {
      const docs = snapshot.docs.map((entry) => ({
        id: entry.id,
        ...entry.data(),
      }));
      setProtocols(docs);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const nextDrafts = {};
    protocols.forEach((protocol) => {
      nextDrafts[protocol.id] = coerceNotificationPolicy(protocol.notification_policy);
    });
    setPolicyDrafts(nextDrafts);
  }, [protocols]);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);

    try {
      const fileName = file.name;
      const storagePath = fileName;

      const { error: uploadError } = await supabase.storage
        .from('protocol')
        .upload(storagePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      await addDoc(collection(db, 'protocols'), {
        name: fileName,
        storagePath,
        uploadedAt: new Date().toISOString(),
        notification_policy: getDefaultNotificationPolicy(),
      });

      setFile(null);
      alert('Success: Added to Global Library');
    } catch (error) {
      console.error(error);
      alert('Upload failed: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (protocol) => {
    if (!window.confirm(`Delete "${protocol.name}" permanently? This will remove it for all users.`)) {
      return;
    }

    try {
      const usersQuery = query(collection(db, 'users'), where('protocolName', '==', protocol.name));
      const usersSnapshot = await getDocs(usersQuery);

      await Promise.all(
        usersSnapshot.docs.map((userDoc) =>
          updateDoc(doc(db, 'users', userDoc.id), {
            protocolName: null,
            protocolId: null,
            protocolUrl: null,
            protocolStatus: null,
          })
        )
      );

      await deleteDoc(doc(db, 'protocols', protocol.id));

      const { error: storageError } = await supabase.storage
        .from('protocol')
        .remove([protocol.storagePath]);

      if (storageError) {
        console.error('Supabase Storage Error:', storageError);
        alert('Removed from list, but failed to delete the PDF from storage.');
      }
    } catch (error) {
      alert('Delete failed: ' + error.message);
    }
  };

  const handleActivate = async (protocol) => {
    if (!selectedPatient) {
      alert('Please select a patient first.');
      return;
    }

    const isCurrentlyActive = selectedPatient.protocolName === protocol.name;

    try {
      if (isCurrentlyActive) {
        await updateDoc(doc(db, 'users', selectedPatient.id), {
          protocolName: null,
          protocolId: null,
          protocolUrl: null,
          protocolStatus: null,
          protocolAssignedAt: null,
        });
      } else {
        await updateDoc(doc(db, 'users', selectedPatient.id), {
          protocolName: protocol.name,
          protocolId: protocol.id,
          protocolUrl: protocol.storagePath,
          protocolStatus: 'active',
          protocolAssignedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      alert('Error updating protocol: ' + error.message);
    }
  };

  const handlePreview = async (protocol) => {
    if (!protocol.storagePath) {
      alert('Error: Protocol path missing.');
      return;
    }

    const newTab = window.open('', '_blank');
    if (!newTab) {
      alert('Please allow popups for this site to view the PDF.');
      return;
    }

    newTab.document.write(`
      <html>
        <head><title>Opening PDF...</title></head>
        <body style="font-family:sans-serif; display:flex; justify-content:center; align-items:center; height:100vh; background:#f0f2f5;">
          <div style="text-align:center;">
            <h3>Loading document...</h3>
          </div>
        </body>
      </html>
    `);

    try {
      const { data, error } = await supabase.storage.from('protocol').createSignedUrl(protocol.storagePath, 60);

      if (error) throw error;

      if (data?.signedUrl) {
        newTab.location.href = data.signedUrl;
      } else {
        newTab.close();
        alert('Unable to generate link.');
      }
    } catch (error) {
      console.error('Preview Error:', error);
      newTab.close();
      alert('Could not open file: ' + error.message);
    }
  };

  const handlePolicyFieldChange = (protocolId, severity, field, value) => {
    setPolicyDrafts((prev) => {
      const basePolicy = coerceNotificationPolicy(prev[protocolId]);
      return {
        ...prev,
        [protocolId]: {
          ...basePolicy,
          [severity]: {
            ...basePolicy[severity],
            [field]: field === 'due_in_hours' ? value.replace(/[^0-9]/g, '') : value,
          },
        },
      };
    });
  };

  const handleSavePolicy = async (protocolId) => {
    try {
      await updateDoc(doc(db, 'protocols', protocolId), {
        notification_policy: coerceNotificationPolicy(policyDrafts[protocolId]),
        updatedAt: new Date().toISOString(),
      });
      alert('Notification policy saved.');
    } catch (error) {
      alert('Failed to save protocol notification policy: ' + error.message);
    }
  };

  return (
    <div className="card" style={{ borderTop: '4px solid #28a745' }}>
      <h3 className="mt-0">Protocol Library</h3>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
        <input type="file" accept="application/pdf" onChange={(event) => setFile(event.target.files[0])} />
        <button onClick={handleUpload} disabled={!file || uploading} className="btn btn-primary btn-small">
          {uploading ? 'Uploading...' : 'Upload PDF'}
        </button>
      </div>

      <div
        style={{
          background: '#e9ecef',
          padding: '10px',
          borderRadius: '5px',
          marginBottom: '10px',
          fontSize: '13px',
        }}
      >
        {selectedPatient ? (
          <>
            <strong>Managing Protocol For:</strong> {selectedPatient.nickname}
            <br />
            <span style={{ color: selectedPatient.protocolName ? '#28a745' : '#666' }}>
              Active Context: {selectedPatient.protocolName || 'None'}
            </span>
          </>
        ) : (
          <em style={{ color: '#d32f2f' }}>Select a patient from the list to assign a protocol.</em>
        )}
      </div>

      <div style={{ maxHeight: '420px', overflowY: 'auto' }}>
        {protocols.map((protocol) => {
          const isActive = selectedPatient?.protocolName === protocol.name;
          const draftPolicy = coerceNotificationPolicy(policyDrafts[protocol.id]);

          return (
            <div
              key={protocol.id}
              style={{
                padding: '10px',
                borderBottom: '1px solid #eee',
                background: isActive ? '#e8f5e9' : 'transparent',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <button
                    onClick={() => handlePreview(protocol)}
                    style={{
                      color: '#007bff',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '14px',
                      textDecoration: 'underline',
                      textAlign: 'left',
                      padding: 0,
                    }}
                    title="Click to view PDF"
                  >
                    {protocol.name}
                  </button>

                  <div
                    style={{
                      marginTop: '10px',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                      gap: '8px',
                    }}
                  >
                    {POLICY_FIELDS.map((severity) => (
                      <div
                        key={severity}
                        style={{
                          border: '1px solid #d9e2ec',
                          borderRadius: '8px',
                          padding: '8px',
                          background: '#fafcff',
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 'bold',
                            marginBottom: '6px',
                            textTransform: 'capitalize',
                            color: severity === 'serious' ? '#b42318' : '#334e68',
                          }}
                        >
                          {severity}
                        </div>
                        <label style={{ display: 'block', fontSize: '11px', color: '#52606d', marginBottom: '4px' }}>
                          Due (hours)
                        </label>
                        <input
                          value={draftPolicy[severity].due_in_hours}
                          onChange={(event) =>
                            handlePolicyFieldChange(protocol.id, severity, 'due_in_hours', event.target.value)
                          }
                          style={{ width: '100%', marginBottom: '6px' }}
                        />
                        <label style={{ display: 'block', fontSize: '11px', color: '#52606d', marginBottom: '4px' }}>
                          Instruction
                        </label>
                        <input
                          value={draftPolicy[severity].instruction}
                          onChange={(event) =>
                            handlePolicyFieldChange(protocol.id, severity, 'instruction', event.target.value)
                          }
                          style={{ width: '100%', marginBottom: '6px' }}
                        />
                        <label style={{ display: 'block', fontSize: '11px', color: '#52606d', marginBottom: '4px' }}>
                          Action Code
                        </label>
                        <input
                          value={draftPolicy[severity].action_code}
                          onChange={(event) =>
                            handlePolicyFieldChange(protocol.id, severity, 'action_code', event.target.value)
                          }
                          style={{ width: '100%' }}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0 }}>
                  <button
                    onClick={() => handleSavePolicy(protocol.id)}
                    className="btn btn-primary btn-small"
                    style={{ fontSize: '10px', minWidth: '82px' }}
                    title="Save protocol notification rules"
                  >
                    Save Rules
                  </button>
                  <button
                    onClick={() => handleActivate(protocol)}
                    disabled={!selectedPatient}
                    className={`btn btn-small ${isActive ? 'btn-success' : 'btn-secondary'}`}
                    style={{ fontSize: '10px', minWidth: '82px' }}
                    title={isActive ? 'Click to unassign' : 'Click to assign'}
                  >
                    {isActive ? 'Active' : 'Assign'}
                  </button>
                  <button
                    onClick={() => handleDelete(protocol)}
                    style={{ background: 'none', border: '1px solid #f1c0c0', borderRadius: '6px', cursor: 'pointer', padding: '6px' }}
                    title="Delete protocol globally"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {protocols.length === 0 && (
          <p style={{ fontSize: '12px', color: '#999', textAlign: 'center' }}>
            No protocols found. Upload one to get started.
          </p>
        )}
      </div>
    </div>
  );
};

export default ProtocolManager;
