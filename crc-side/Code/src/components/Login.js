import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView, Platform,
  ScrollView,
  StyleSheet,
  Text, TextInput, TouchableOpacity,
  View
} from 'react-native';
import { auth, db } from '../firebase';
import { enforceRoleSecurity } from '../utils';

const Login = ({ type, onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  // Registration States
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [gender, setGender] = useState('');
  const [dob, setDob] = useState('');
  
  const [isReg, setIsReg] = useState(false);

  const handleAuth = async () => {
    try {
      if (type==='crc' && !email.endsWith('@hospital.com')) throw new Error("Only @hospital.com allowed");
      if (type==='patient' && email.endsWith('@hospital.com')) throw new Error("Staff use CRC portal");

      let user;
      if (isReg) {
        if (type === 'patient' && (!firstName || !lastName || !gender || !dob)) {
          throw new Error("All fields are required.");
        }
        const res = await createUserWithEmailAndPassword(auth, email, password);
        user = res.user;

        await setDoc(doc(db, "users", user.uid), {
          firstName, lastName, nickname: `${firstName} ${lastName}`,
          gender, dob, role: type, email: user.email
        }, { merge: true });

      } else {
        const res = await signInWithEmailAndPassword(auth, email, password);
        user = res.user;
      }

      await enforceRoleSecurity(user, type);
      // onLogin is optional since App.js listener handles state, but good for cleanup
      if(onLogin) onLogin(user);

    } catch (e) { 
      Alert.alert("Authentication Error", e.message); 
      if(auth.currentUser) signOut(auth); 
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.card}>
          <Text style={styles.title}>
            {type==='crc' ? 'CRC Portal' : (isReg?'Patient Sign Up':'Patient Login')}
          </Text>

          {isReg && type === 'patient' && (
            <>
              <View style={styles.row}>
                <TextInput style={[styles.input, {flex:1}]} placeholder="First Name" value={firstName} onChangeText={setFirstName} />
                <TextInput style={[styles.input, {flex:1}]} placeholder="Last Name" value={lastName} onChangeText={setLastName} />
              </View>
              
              <Text style={styles.label}>Gender:</Text>
              <View style={styles.row}>
                {['Male', 'Female'].map(g => (
                  <TouchableOpacity 
                    key={g} 
                    style={[styles.genderBtn, gender === g && styles.genderBtnSelected]} 
                    onPress={() => setGender(g)}
                  >
                    <Text style={{color: gender === g ? 'white' : '#333'}}>{g}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TextInput 
                style={styles.input} 
                placeholder="DOB (YYYY-MM-DD)" 
                value={dob} 
                onChangeText={setDob} 
              />
            </>
          )}

          <TextInput 
            style={styles.input} 
            placeholder="Email" 
            value={email} 
            onChangeText={setEmail} 
            autoCapitalize="none" 
            keyboardType="email-address"
          />
          <TextInput 
            style={styles.input} 
            placeholder="Password" 
            value={password} 
            onChangeText={setPassword} 
            secureTextEntry 
          />

          <TouchableOpacity 
            style={[styles.button, {backgroundColor: type==='crc'?'#007bff':'#28a745'}]} 
            onPress={handleAuth}
          >
            <Text style={styles.buttonText}>{isReg ? 'Sign Up' : 'Login'}</Text>
          </TouchableOpacity>

          {type === 'patient' && (
            <TouchableOpacity onPress={() => setIsReg(!isReg)}>
              <Text style={styles.linkText}>
                {isReg ? 'Already have an account? Login' : 'New here? Sign Up'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5' },
  scrollContainer: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  card: { backgroundColor: 'white', padding: 20, borderRadius: 10, elevation: 3 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },
  input: { borderWidth: 1, borderColor: '#ccc', padding: 12, borderRadius: 8, marginBottom: 15, fontSize: 16 },
  row: { flexDirection: 'row', gap: 10, marginBottom: 15 },
  label: { marginBottom: 5, fontWeight: 'bold' },
  genderBtn: { flex: 1, padding: 10, borderWidth: 1, borderColor: '#ccc', borderRadius: 5, alignItems: 'center' },
  genderBtnSelected: { backgroundColor: '#007bff', borderColor: '#007bff' },
  button: { padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  buttonText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  linkText: { marginTop: 15, color: '#007bff', textAlign: 'center', textDecorationLine: 'underline' }
});

export default Login;