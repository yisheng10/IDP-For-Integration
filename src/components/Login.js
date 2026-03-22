import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { auth, db } from '../firebase';
import { enforceRoleSecurity } from '../utils';

function getSurfaceLabel(type) {
  return type === 'crc' ? 'CRC' : 'patient';
}

function getAuthErrorMessage({ error, type, isReg }) {
  const surfaceLabel = getSurfaceLabel(type);
  const code = error?.code;
  const rawMessage = String(error?.message || '').replace('Firebase: ', '');

  if (code === 'auth/invalid-email') {
    return `Please enter a valid ${surfaceLabel.toLowerCase()} email address.`;
  }
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return `${surfaceLabel} login failed. Check your ${surfaceLabel.toLowerCase()} email and password and try again.`;
  }
  if (code === 'auth/email-already-in-use') {
    return `${surfaceLabel} account already exists. Please log in instead.`;
  }
  if (code === 'auth/too-many-requests') {
    return `${surfaceLabel} sign-in is temporarily locked. Please wait a moment and try again.`;
  }
  if (code === 'auth/network-request-failed') {
    return 'Network error. Please confirm your connection and try again.';
  }
  if (!isReg && rawMessage === 'Only @hospital.com allowed') {
    return 'CRC sign-in requires an @hospital.com email address.';
  }
  if (!isReg && rawMessage === 'Staff use CRC portal') {
    return 'CRC staff must use the CRC website. Patient login does not accept @hospital.com email addresses.';
  }
  return rawMessage;
}

export default function Login({ type, onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [gender, setGender] = useState('');
  const [dob, setDob] = useState('');
  const [isReg, setIsReg] = useState(false);

  const handleAuth = async () => {
    try {
      if (type === 'crc' && !email.endsWith('@hospital.com')) throw new Error('Only @hospital.com allowed');
      if (type === 'patient' && email.endsWith('@hospital.com')) throw new Error('Staff use CRC portal');

      let user;
      if (isReg) {
        if (type === 'patient' && (!firstName || !lastName || !gender || !dob)) {
          throw new Error('All fields are required.');
        }

        const response = await createUserWithEmailAndPassword(auth, email, password);
        user = response.user;

        await setDoc(
          doc(db, 'users', user.uid),
          {
            firstName,
            lastName,
            nickname: `${firstName} ${lastName}`,
            gender,
            dob,
            role: type,
            email: user.email,
          },
          { merge: true }
        );
      } else {
        const response = await signInWithEmailAndPassword(auth, email, password);
        user = response.user;
      }

      await enforceRoleSecurity(user, type);
      if (onLogin) onLogin(user);
    } catch (error) {
      Alert.alert(`${getSurfaceLabel(type)} Authentication`, getAuthErrorMessage({ error, type, isReg }));
      if (auth.currentUser) signOut(auth);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.eyebrow}>{type === 'crc' ? 'CRC access' : 'Patient access'}</Text>
          <Text style={styles.title}>{type === 'crc' ? 'CRC Portal' : isReg ? 'Patient Sign Up' : 'Patient Login'}</Text>
          <Text style={styles.subtitle}>
            {type === 'crc'
              ? 'Secure operational access for the CRC website.'
              : 'Use this app for patient actions such as vitals, appointments, side effects, and questionnaires.'}
          </Text>

          {isReg && type === 'patient' ? (
            <>
              <View style={styles.row}>
                <View style={styles.field}>
                  <Text style={styles.label}>First name</Text>
                  <TextInput style={styles.input} placeholder="Aisyah" value={firstName} onChangeText={setFirstName} />
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>Last name</Text>
                  <TextInput style={styles.input} placeholder="Rahman" value={lastName} onChangeText={setLastName} />
                </View>
              </View>

              <Text style={styles.label}>Gender</Text>
              <View style={styles.row}>
                {['Male', 'Female'].map((option) => (
                  <TouchableOpacity
                    key={option}
                    style={[styles.genderButton, gender === option && styles.genderButtonActive]}
                    onPress={() => setGender(option)}
                  >
                    <Text style={[styles.genderText, gender === option && styles.genderTextActive]}>{option}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Date of birth</Text>
              <TextInput style={styles.input} placeholder="YYYY-MM-DD" value={dob} onChangeText={setDob} />
            </>
          ) : null}

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder={type === 'crc' ? 'name@hospital.com' : 'patient@example.com'}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <Text style={styles.label}>Password</Text>
          <TextInput style={styles.input} placeholder="Enter password" value={password} onChangeText={setPassword} secureTextEntry />

          <TouchableOpacity style={[styles.button, { backgroundColor: type === 'crc' ? '#0f609b' : '#00796b' }]} onPress={handleAuth}>
            <Text style={styles.buttonText}>{isReg ? 'Create account' : 'Continue'}</Text>
          </TouchableOpacity>

          {type === 'patient' ? (
            <TouchableOpacity onPress={() => setIsReg((current) => !current)}>
              <Text style={styles.linkText}>{isReg ? 'Already registered? Log in' : 'New here? Create an account'}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 24,
    padding: 22,
    shadowColor: '#0f172a',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: '#0f609b',
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#14324a',
    marginBottom: 8,
  },
  subtitle: {
    color: '#52606d',
    lineHeight: 20,
    marginBottom: 20,
  },
  field: {
    flex: 1,
  },
  label: {
    color: '#243b53',
    fontWeight: '700',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#c7d4e2',
    backgroundColor: '#f8fbff',
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 14,
    marginBottom: 16,
    color: '#14324a',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  genderButton: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#c7d4e2',
    alignItems: 'center',
    backgroundColor: '#f8fbff',
    marginBottom: 16,
  },
  genderButtonActive: {
    backgroundColor: '#0f609b',
    borderColor: '#0f609b',
  },
  genderText: {
    color: '#33516e',
    fontWeight: '700',
  },
  genderTextActive: {
    color: '#ffffff',
  },
  button: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonText: {
    color: 'white',
    fontWeight: '800',
    fontSize: 16,
  },
  linkText: {
    marginTop: 16,
    color: '#0f609b',
    textAlign: 'center',
    fontWeight: '700',
  },
});
