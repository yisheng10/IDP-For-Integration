import { onAuthStateChanged, signOut } from 'firebase/auth';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Linking,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';

import { APP_NAME } from '../src/config';
import { auth } from '../src/firebase';
// CHANGE 1: Import the storage service
import { getSignedUrl } from '../src/services/storageService';

import Login from '../src/components/Login';
import CRCHome from '../src/pages/CRCHome';
import PatientHome from '../src/pages/PatientHome';

export default function App() {
  const [userType, setUserType] = useState<'patient' | 'crc'>('patient');
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        if (currentUser.email && currentUser.email.endsWith('@hospital.com')) {
          setUserType('crc');
        } else {
          setUserType('patient');
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // CHANGE 2: Helper to handle the PDF link
  const handleOpenPdf = async () => {
    const url = await getSignedUrl('CTCAE.pdf');
    if (url) {
      Linking.openURL(url).catch(err => console.error("Couldn't load page", err));
    } else {
      alert("Could not generate secure link for CTCAE.pdf");
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007bff" />
        <Text style={{ marginTop: 10 }}>Loading {APP_NAME}...</Text>
      </View>
    );
  }

  // --- LOGGED IN ---
  if (user) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" backgroundColor="#333" />
        {userType === 'patient' 
          ? <PatientHome user={user} onLogout={() => signOut(auth)} /> 
          : <CRCHome user={user} onLogout={() => signOut(auth)} />
        }
      </SafeAreaView>
    );
  }

  // --- LOGGED OUT (Login Screen) ---
  return (
    <ImageBackground 
      source={require('../assets/images/background.jpg')} 
      style={styles.background}
      resizeMode="cover"
    >
      <StatusBar barStyle="light-content" />
      <View style={styles.overlay}>
        
        <Image 
          source={require('../assets/images/icon.png')} 
          style={styles.logo}
          resizeMode="contain"
        />
        
        <View style={styles.toggleContainer}>
          <Text style={{color:'white', fontWeight:'bold', marginRight:10}}>Login As:</Text>
          <View style={{flexDirection:'row', backgroundColor:'white', borderRadius:5}}>
            <Text 
              onPress={() => setUserType('patient')} 
              style={[styles.toggleBtn, userType==='patient' && styles.activeBtn]}
            >Patient</Text>
            <Text 
              onPress={() => setUserType('crc')} 
              style={[styles.toggleBtn, userType==='crc' && styles.activeBtn]}
            >Staff</Text>
          </View>
        </View>

        <View style={styles.loginBox}>
          <Login type={userType} onLogin={(u: any) => setUser(u)} />
        </View>

        {/* CHANGE 3: Use the secure handler */}
        <TouchableOpacity style={styles.pdfLink} onPress={handleOpenPdf}>
          <Text style={{color: 'white', textDecorationLine: 'underline'}}>
            View CTCAE Guidelines (PDF)
          </Text>
        </TouchableOpacity>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  safeArea: { flex: 1, backgroundColor: '#333' }, 
  background: { flex: 1, width: '100%', height: '100%' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  logo: { width: 150, height: 150, alignSelf: 'center', marginBottom: 20 },
  toggleContainer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  toggleBtn: { padding: 10, color: '#333' },
  activeBtn: { backgroundColor: '#007bff', color: 'white', borderRadius: 5 },
  loginBox: { flex: 1, maxHeight: 500 },
  pdfLink: { marginTop: 20, alignSelf: 'center', padding: 10 }
});