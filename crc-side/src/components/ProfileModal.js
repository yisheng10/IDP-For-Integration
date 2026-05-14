import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  StyleSheet,
  Text, TextInput, TouchableOpacity,
  View
} from 'react-native';
import CalendarDateField from './CalendarDateField';
import { db } from '../firebase';

const ProfileModal = ({ user, defaultRole, onClose }) => {
  const [tempBio, setTempBio] = useState("");
  const [tempFirst, setTempFirst] = useState("");
  const [tempLast, setTempLast] = useState("");
  const [tempGender, setTempGender] = useState("");
  const [tempDob, setTempDob] = useState("");
  const [tempCaregiverSupport, setTempCaregiverSupport] = useState("");
  const [tempDistanceToSiteKm, setTempDistanceToSiteKm] = useState("");
  const isValidIsoDob = !tempDob || /^\d{4}-\d{2}-\d{2}$/.test(String(tempDob || ''));
  const parsedDistanceToSiteKm = Number(tempDistanceToSiteKm);
  const hasValidDistanceToSiteKm =
    String(tempDistanceToSiteKm || '').trim() !== '' &&
    Number.isFinite(parsedDistanceToSiteKm) &&
    parsedDistanceToSiteKm >= 0;

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "users", user.uid), (d) => {
      if (d.exists()) { 
        const data = d.data();
        setTempBio(data.bio || `New ${defaultRole}`);
        setTempGender(data.gender || "");
        setTempDob(data.dob || "");
        setTempCaregiverSupport(
          typeof data.caregiver_support === 'boolean'
            ? (data.caregiver_support ? 'yes' : 'no')
            : ''
        );
        setTempDistanceToSiteKm(
          data.distance_to_site_km == null || data.distance_to_site_km === ''
            ? ''
            : String(data.distance_to_site_km)
        );
        
        if (data.firstName) {
          setTempFirst(data.firstName);
          setTempLast(data.lastName || "");
        } else {
          const names = (data.nickname || "").split(" ");
          setTempFirst(names[0] || "");
          setTempLast(names.slice(1).join(" ") || "");
        }
      }
    });
    return () => unsub();
  }, [user, defaultRole]);

  const handleSave = async () => {
    try { 
      if (!isValidIsoDob) {
        throw new Error('Please select a valid date of birth.');
      }
      if (!tempCaregiverSupport) {
        throw new Error('Please select whether caregiver support is available.');
      }
      if (!hasValidDistanceToSiteKm) {
        throw new Error('Please enter a valid distance to site in kilometres.');
      }
      await setDoc(doc(db, "users", user.uid), { 
        bio: tempBio, 
        firstName: tempFirst,
        lastName: tempLast,
        gender: tempGender,
        dob: tempDob,
        caregiver_support: tempCaregiverSupport === 'yes',
        distance_to_site_km: parsedDistanceToSiteKm,
        nickname: `${tempFirst} ${tempLast}`.trim() 
      }, { merge: true }); 
      Alert.alert("Success", "Profile updated!");
      onClose();
    } 
    catch (e) { Alert.alert("Error", e.message); }
  };

  return (
    <Modal animationType="slide" transparent={true} visible={true} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.content}>
          <Text style={styles.header}>Edit Profile</Text>
          
          <View style={styles.row}>
            <TextInput style={[styles.input, {flex:1}]} value={tempFirst} onChangeText={setTempFirst} placeholder="First Name" />
            <TextInput style={[styles.input, {flex:1}]} value={tempLast} onChangeText={setTempLast} placeholder="Last Name" />
          </View>

          <View style={styles.row}>
            {/* Simple Toggle for Gender instead of complex Picker */}
            <TouchableOpacity 
              style={[styles.toggleBtn, tempGender === 'Male' && styles.activeToggle]}
              onPress={() => setTempGender('Male')}
            >
              <Text style={{color: tempGender==='Male'?'white':'black'}}>Male</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.toggleBtn, tempGender === 'Female' && styles.activeToggle]}
              onPress={() => setTempGender('Female')}
            >
              <Text style={{color: tempGender==='Female'?'white':'black'}}>Female</Text>
            </TouchableOpacity>
          </View>

          <CalendarDateField
            label="Date of birth"
            value={tempDob}
            onChange={setTempDob}
            placeholder="Select date of birth"
          />

          <Text style={{fontWeight:'bold', marginTop:10}}>Caregiver support:</Text>
          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.toggleBtn, tempCaregiverSupport === 'yes' && styles.activeToggle]}
              onPress={() => setTempCaregiverSupport('yes')}
            >
              <Text style={{color: tempCaregiverSupport==='yes'?'white':'black'}}>Yes</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, tempCaregiverSupport === 'no' && styles.activeToggle]}
              onPress={() => setTempCaregiverSupport('no')}
            >
              <Text style={{color: tempCaregiverSupport==='no'?'white':'black'}}>No</Text>
            </TouchableOpacity>
          </View>

          <Text style={{fontWeight:'bold', marginTop:10}}>Distance to study site (km):</Text>
          <TextInput
            style={styles.input}
            value={tempDistanceToSiteKm}
            onChangeText={setTempDistanceToSiteKm}
            placeholder="e.g. 12.5"
            keyboardType="decimal-pad"
          />

          <Text style={{fontWeight:'bold', marginTop:10}}>Bio:</Text>
          <TextInput 
            style={[styles.input, {height: 80, textAlignVertical: 'top'}]} 
            multiline 
            value={tempBio} 
            onChangeText={setTempBio} 
          />
          
          <View style={styles.actions}>
            <TouchableOpacity onPress={onClose} style={[styles.btn, {backgroundColor:'#6c757d'}]}>
              <Text style={{color:'white'}}>Close</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSave} style={[styles.btn, {backgroundColor:'#28a745'}]}>
              <Text style={{color:'white'}}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  content: { width: '90%', backgroundColor: 'white', borderRadius: 10, padding: 20 },
  header: { fontSize: 20, fontWeight: 'bold', marginBottom: 15, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 5, padding: 10, marginBottom: 10, backgroundColor: 'white' },
  toggleBtn: { flex: 1, padding: 10, borderWidth: 1, borderColor: '#ccc', borderRadius: 5, alignItems: 'center' },
  activeToggle: { backgroundColor: '#007bff', borderColor: '#007bff' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 10 },
  btn: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 5 }
});

export default ProfileModal;
