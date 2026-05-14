import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

const PatientList = ({ patients, selectedPatientId, onSelect }) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredPatients = patients.filter(p => {
    const query = searchQuery.toLowerCase();
    const name = (p.nickname || "").toLowerCase();
    const id = (p.hospitalPatientId || "").toLowerCase();
    return name.includes(query) || id.includes(query);
  });

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Patients</Text>
      
      <TextInput 
        style={styles.input}
        placeholder="🔍 Search name or ID..."
        value={searchQuery}
        onChangeText={setSearchQuery}
      />

      {/* REPLACED FlatList WITH MAP TO FIX SCROLL ERROR */}
      <View>
        {filteredPatients.length === 0 ? (
          <Text style={styles.empty}>No patients found.</Text>
        ) : (
          filteredPatients.map(item => (
            <TouchableOpacity 
              key={item.id}
              style={[
                styles.item, 
                selectedPatientId === item.id && styles.selectedItem
              ]}
              onPress={() => onSelect(item)}
            >
              <View>
                <Text style={styles.name}>{item.nickname || "No Name"}</Text>
                <Text style={styles.email}>{item.email}</Text>
              </View>
              {item.hospitalPatientId && (
                <Text style={styles.idBadge}>ID: {item.hospitalPatientId}</Text>
              )}
            </TouchableOpacity>
          ))
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { backgroundColor: 'white', padding: 15, borderRadius: 8, marginBottom: 20, elevation: 2 },
  header: { fontSize: 18, fontWeight: 'bold', marginBottom: 10 },
  input: { borderWidth: 1, borderColor: '#ddd', padding: 10, borderRadius: 5, marginBottom: 10 },
  item: { flexDirection: 'row', justifyContent: 'space-between', padding: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  selectedItem: { backgroundColor: '#e7f1ff', borderColor: '#007bff', borderWidth: 1, borderRadius: 5 },
  name: { fontWeight: 'bold', fontSize: 16 },
  email: { fontSize: 12, color: '#666' },
  idBadge: { color: '#007bff', fontSize: 12, fontWeight: 'bold' },
  empty: { textAlign: 'center', color: '#999', padding: 20 }
});

export default PatientList;