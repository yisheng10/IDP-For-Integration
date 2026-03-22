import { Ionicons } from '@expo/vector-icons'; // <--- NEW: Using proper icons
import { doc, onSnapshot } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { Alert, Linking, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { APP_NAME } from '../config';
import { db } from '../firebase';
import { getSignedUrl } from '../services/storageService';
import ProfileModal from './ProfileModal';

const TopNavbar = ({ user, defaultRole, onLogout, alerts = [], onAlertClick }) => {
  const [displayName, setDisplayName] = useState(user.email);
  
  // Toggles
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showResourceMenu, setShowResourceMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);

  const pdfResources = [
    { 
      id: 'ctcae', 
      title: 'CTCAE Guidelines (PDF)', 
      filePath: 'CTCAE.pdf' 
    }
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
    try {
      const secureUrl = await getSignedUrl(resource.filePath);
      if (secureUrl) {
        Linking.openURL(secureUrl).catch(() => Alert.alert("Error", "Could not open PDF viewer"));
      } else {
        Alert.alert("Error", "Could not generate secure link.");
      }
      setShowResourceMenu(false);
    } catch (e) {
      console.error(e);
      Alert.alert("Error", "Error opening resource");
    }
  };

  const closeAllMenus = () => {
    setShowProfileMenu(false);
    setShowResourceMenu(false);
    setShowNotifications(false);
  };

  return (
    <View style={styles.navbar}>
      <View style={styles.leftGroup}>
        
        {/* 1. Profile Icon */}
        <TouchableOpacity 
          onPress={() => { closeAllMenus(); setShowProfileMenu(!showProfileMenu); }} 
          style={styles.navItem}
        >
          <Ionicons name="person-circle-outline" size={28} color="white" />
          <Text style={styles.navText}>
             {displayName ? displayName.split(' ')[0] : 'User'}
          </Text>
        </TouchableOpacity>

        {/* 2. Resources Icon */}
        <TouchableOpacity 
          onPress={() => { closeAllMenus(); setShowResourceMenu(!showResourceMenu); }} 
          style={styles.navItem}
        >
          <Ionicons name="book-outline" size={24} color="white" />
          <Text style={styles.navText}>Resources</Text>
        </TouchableOpacity>

        {/* 3. Notification Bell (Visible for Everyone) */}
        <TouchableOpacity 
          onPress={() => { closeAllMenus(); setShowNotifications(!showNotifications); }} 
          style={styles.navItem}
        >
          <Ionicons name="notifications-outline" size={24} color="white" />
          {alerts && alerts.length > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{alerts.length}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <Text style={styles.appName}>{APP_NAME}</Text>

      {/* --- DROPDOWNS --- */}
      
      {/* A. Profile Menu */}
      {showProfileMenu && (
        <View style={styles.dropdown}>
          <TouchableOpacity 
            style={styles.dropdownItem} 
            onPress={() => { setShowEditProfile(true); setShowProfileMenu(false); }}
          >
            <Text>Edit Profile</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dropdownItem} onPress={onLogout}>
            <Text style={{color: 'red'}}>Logout</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* B. Resources Menu */}
      {showResourceMenu && (
        <View style={[styles.dropdown, { left: 90, width: 220 }]}>
          <Text style={styles.dropdownHeader}>Clinical Guidelines</Text>
          {pdfResources.map((item) => (
            <TouchableOpacity 
              key={item.id} 
              style={styles.dropdownItem} 
              onPress={() => handleOpenPdf(item)}
            >
              <Text style={{color: '#007bff'}}>📄 {item.title}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* C. Notifications Menu */}
      {showNotifications && (
        <View style={[styles.dropdown, { left: 160 }]}>
          <Text style={styles.dropdownHeader}>Active Alerts ({alerts.length})</Text>
          {alerts.length === 0 ? (
            <Text style={{padding:10, color:'#999'}}>No alerts.</Text>
          ) : (
            alerts.map(alert => (
              <TouchableOpacity 
                key={alert.id} 
                style={styles.dropdownItem}
                onPress={() => { if(onAlertClick) onAlertClick(alert); setShowNotifications(false); }}
              >
                <Text style={{color: '#d32f2f', fontWeight: 'bold'}}>{alert.reason}</Text>
                <Text style={{fontSize: 10, color: '#666'}}>
                   {alert.patientName ? `Patient: ${alert.patientName}` : 'System Alert'}
                </Text>
              </TouchableOpacity>
            ))
          )}
        </View>
      )}

      <Modal visible={showEditProfile} animationType="slide" transparent>
        <ProfileModal 
          user={user} 
          defaultRole={defaultRole} 
          onClose={() => setShowEditProfile(false)} 
        />
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  navbar: { 
    height: 88,
    paddingTop: 34,
    backgroundColor: '#0f609b', 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    paddingHorizontal: 16, 
    zIndex: 1000 
  },
  leftGroup: { flexDirection: 'row', alignItems: 'center', gap: 15 },
  navItem: { alignItems: 'center', justifyContent: 'center' },
  navText: { color: 'white', fontSize: 10, marginTop: 2, fontWeight: '700' },
  appName: { color: 'white', fontSize: 17, fontWeight: '800' },
  badge: { 
    position: 'absolute', top: -2, right: -2, 
    backgroundColor: 'red', borderRadius: 10, 
    width: 16, height: 16, 
    justifyContent: 'center', alignItems: 'center' 
  },
  badgeText: { color: 'white', fontSize: 10, fontWeight: 'bold' },
  dropdown: { 
    position: 'absolute', top: 75, left: 10, 
    width: 200, backgroundColor: 'white', 
    borderRadius: 14, elevation: 5, padding: 6,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3.84
  },
  dropdownHeader: { fontWeight: '800', padding: 10, borderBottomWidth: 1, borderBottomColor: '#eee', backgroundColor: '#f9fbff', color: '#355070' },
  dropdownItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#eef3f8' }
});

export default TopNavbar;
