import { onAuthStateChanged, signOut } from 'firebase/auth';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import Login from '../src/components/Login';
import { APP_NAME } from '../src/config';
import { auth } from '../src/firebase';
import PatientHome from '../src/pages/PatientHome';

function UnsupportedMobileAccess({ user }) {
  return (
    <View style={styles.unsupportedContainer}>
      <Text style={styles.unsupportedTitle}>Patient App Only</Text>
      <Text style={styles.unsupportedBody}>
        Signed in as {user?.email}. TrialLight v1 keeps the mobile app reserved for patient workflows.
      </Text>
      <Text style={styles.unsupportedBody}>
        CRC access now belongs on the CRC website so study operations stay separate from patient actions.
      </Text>
      <TouchableOpacity style={styles.unsupportedButton} onPress={() => signOut(auth)}>
        <Text style={styles.unsupportedButtonText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser || null);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007bff" />
        <Text style={{ marginTop: 10 }}>Loading {APP_NAME}...</Text>
      </View>
    );
  }

  if (user) {
    const isCrcUser = Boolean(user.email && user.email.endsWith('@hospital.com'));

    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" backgroundColor="#333" />
        {isCrcUser ? (
          <UnsupportedMobileAccess user={user} />
        ) : (
          <PatientHome user={user} onLogout={() => signOut(auth)} />
        )}
      </SafeAreaView>
    );
  }

  return (
    <ImageBackground
      source={require('../assets/images/background.jpg')}
      style={styles.background}
      resizeMode="cover"
    >
      <StatusBar barStyle="light-content" />
      <View style={styles.overlay}>
        <Image source={require('../assets/images/icon.png')} style={styles.logo} resizeMode="contain" />

        <View style={styles.noticeCard}>
          <Text style={styles.noticeEyebrow}>Patient workspace</Text>
          <Text style={styles.noticeTitle}>Patient Mobile App</Text>
          <Text style={styles.noticeText}>
            The CRC portal is now web-only. Use this app for patient workflows, including vitals,
            appointments, chat, and ePRO questionnaires.
          </Text>
        </View>

        <View style={styles.loginBox}>
          <Login type="patient" onLogin={(signedInUser: any) => setUser(signedInUser)} />
        </View>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  safeArea: { flex: 1, backgroundColor: '#333' },
  background: { flex: 1, width: '100%', height: '100%' },
  overlay: { flex: 1, backgroundColor: 'rgba(12,31,48,0.56)', justifyContent: 'center', padding: 20 },
  logo: { width: 132, height: 132, alignSelf: 'center', marginBottom: 18 },
  noticeCard: {
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 24,
    padding: 20,
    marginBottom: 20,
  },
  noticeEyebrow: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: '#0f609b',
    marginBottom: 8,
  },
  noticeTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#14324a',
    marginBottom: 8,
  },
  noticeText: {
    color: '#355070',
    lineHeight: 22,
  },
  loginBox: { flex: 1, maxHeight: 560 },
  unsupportedContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f4f7fb',
  },
  unsupportedTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#14324a',
    marginBottom: 12,
  },
  unsupportedBody: {
    fontSize: 15,
    color: '#355070',
    lineHeight: 22,
    marginBottom: 12,
  },
  unsupportedButton: {
    marginTop: 12,
    backgroundColor: '#0056b3',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  unsupportedButtonText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 16,
  },
});
