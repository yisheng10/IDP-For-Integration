import * as DocumentPicker from 'expo-document-picker';
// Legacy import for Expo SDK 52+
import * as FileSystem from 'expo-file-system/legacy';
import {
  addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, updateDoc, where
} from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Linking, StyleSheet, Text, TouchableOpacity, View
} from 'react-native';
import { SUPABASE_KEY, SUPABASE_URL } from '../config';
import { db } from '../firebase';
import { supabase } from '../supabaseClient';

const ProtocolManager = ({ selectedPatient }) => {
  const [library, setLibrary] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { fetchGlobalLibrary(); }, []);

  const fetchGlobalLibrary = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, "protocols"), orderBy("uploadedAt", "desc"));
      const snapshot = await getDocs(q);
      setLibrary(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (_error) { console.error("Fetch Library Error:", _error); } 
    finally { setLoading(false); }
  };

  const handleUpload = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
      if (result.canceled) return;
      const file = result.assets[0];
      const fileName = file.name;
      const safeFileName = encodeURIComponent(fileName);
      setUploading(true);

      const targetUrl = `${SUPABASE_URL}/storage/v1/object/protocol/${safeFileName}`;
      const uploadResult = await FileSystem.uploadAsync(targetUrl, file.uri, {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: { Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/pdf', 'x-upsert': 'true' },
      });
      if (uploadResult.status >= 300) throw new Error("Storage Upload Failed");

      await addDoc(collection(db, "protocols"), { name: fileName, storagePath: safeFileName, uploadedAt: new Date().toISOString() });
      Alert.alert("Success", "Added to Global Library");
      fetchGlobalLibrary(); 
    } catch (err) { Alert.alert("Error", err.message); } 
    finally { setUploading(false); }
  };

  const handleToggleAssignment = async (protocol) => {
    if (!selectedPatient) return;
    const isCurrentlyAssigned = selectedPatient.protocolName === protocol.name;
    try {
      const patientRef = doc(db, "users", selectedPatient.id);
      if (isCurrentlyAssigned) {
        await updateDoc(patientRef, { protocolName: null, protocolUrl: null, protocolStatus: null, protocolAssignedAt: null });
      } else {
        await updateDoc(patientRef, { protocolName: protocol.name, protocolUrl: protocol.storagePath, protocolStatus: 'active', protocolAssignedAt: new Date().toISOString() });
        Alert.alert("Assigned", `"${protocol.name}" is now active.`);
      }
    } catch (_error) { Alert.alert("Error", _error.message); }
  };

  const handlePreview = async (storagePath) => {
    try {
      const { data, error } = await supabase.storage.from('protocol').createSignedUrl(decodeURIComponent(storagePath), 60);
      if (error) throw error;
      if (data?.signedUrl) Linking.openURL(data.signedUrl);
    } catch (_error) { Alert.alert("Error", "Could not open file link"); }
  };

  const handleDeleteGlobal = async (protocol) => {
    Alert.alert("Delete Permanently?", `This will remove "${protocol.name}" from everyone.`, [
      { text: "Cancel" },
      { text: "Delete", style: 'destructive', onPress: async () => {
          try {
            setLoading(true);
            const q = query(collection(db, "users"), where("protocolName", "==", protocol.name));
            const snapshot = await getDocs(q);
            await Promise.all(snapshot.docs.map(u => updateDoc(doc(db, "users", u.id), { protocolName: null, protocolUrl: null, protocolStatus: null })));
            await deleteDoc(doc(db, "protocols", protocol.id));
            fetchGlobalLibrary();
          } catch(_error) { Alert.alert("Error", _error.message); } finally { setLoading(false); }
      }}
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>📚 Global Protocol Library</Text>
        <TouchableOpacity style={styles.uploadBtn} onPress={handleUpload} disabled={uploading}>
          {uploading ? <ActivityIndicator color="white" size="small"/> : <Text style={styles.uploadText}>+ Upload New PDF</Text>}
        </TouchableOpacity>
      </View>

      {selectedPatient && (
        <View style={styles.patientContext}>
          <Text style={styles.contextText}>Managing for: <Text style={{fontWeight:'bold'}}>{selectedPatient.nickname}</Text></Text>
          <Text style={styles.contextText}>Active: {selectedPatient.protocolName ? <Text style={{color: '#2e7d32', fontWeight:'bold'}}>{selectedPatient.protocolName}</Text> : <Text style={{color: '#d32f2f'}}>None</Text>}</Text>
        </View>
      )}

      {loading ? ( <ActivityIndicator style={{marginTop: 20}} /> ) : (
        // REPLACED FlatList WITH MAP
        <View>
          {library.length === 0 ? (
            <Text style={styles.emptyText}>Library is empty. Upload a PDF.</Text>
          ) : (
            library.map(item => {
              const isAssigned = selectedPatient?.protocolName === item.name;
              return (
                <View key={item.id} style={[styles.fileRow, isAssigned && {borderColor: '#2e7d32', borderWidth: 2}]}>
                  <View style={styles.fileInfo}>
                    <Text style={styles.fileName}>{item.name}</Text>
                    <Text style={styles.fileDate}>Uploaded: {new Date(item.uploadedAt).toLocaleDateString()}</Text>
                  </View>
                  <View style={styles.actions}>
                    <TouchableOpacity onPress={() => handlePreview(item.storagePath)} style={styles.iconBtn}><Text style={{fontSize:16}}>👁️</Text></TouchableOpacity>
                    {selectedPatient && (
                      <TouchableOpacity style={[styles.assignBtn, isAssigned ? styles.activeBtn : styles.inactiveBtn]} onPress={() => handleToggleAssignment(item)}>
                        <Text style={styles.assignText}>{isAssigned ? "Deactivate" : "Assign"}</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={() => handleDeleteGlobal(item)} style={styles.iconBtn}><Text style={{fontSize:16}}>🗑️</Text></TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { marginTop: 10, marginBottom: 50 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  heading: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  uploadBtn: { backgroundColor: '#0056b3', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20 },
  uploadText: { color: 'white', fontWeight: 'bold', fontSize: 12 },
  patientContext: { backgroundColor: '#e3f2fd', padding: 10, borderRadius: 8, marginBottom: 15, borderWidth: 1, borderColor: '#90caf9' },
  contextText: { fontSize: 13, color: '#0d47a1', marginBottom: 2 },
  fileRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'white', padding: 12, borderRadius: 8, marginBottom: 8, elevation: 1, borderWidth: 1, borderColor: '#eee' },
  fileInfo: { flex: 1 },
  fileName: { fontWeight: 'bold', fontSize: 14, color: '#333' },
  fileDate: { fontSize: 10, color: '#888' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 15 },
  iconBtn: { padding: 5 },
  assignBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 15 },
  inactiveBtn: { backgroundColor: '#2e7d32' },
  activeBtn: { backgroundColor: '#d32f2f' },
  assignText: { color: 'white', fontWeight: 'bold', fontSize: 10 },
  emptyText: { textAlign: 'center', color: '#999', marginTop: 20, fontStyle: 'italic' }
});

export default ProtocolManager;
