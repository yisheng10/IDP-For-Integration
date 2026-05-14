import { useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const SideEffectReportScreen = () => {
  const router = useRouter();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Symptom Intake Moved To AI Assistant</Text>
        <Text style={styles.body}>
          TrialLight no longer uses a separate patient side effect submission form as the primary workflow.
        </Text>
        <Text style={styles.body}>
          Please go back to the patient home screen and use the AI Assistant to describe symptoms. The assistant now:
        </Text>
        <Text style={styles.listItem}>Automatically extracts structured side effect details from chat</Text>
        <Text style={styles.listItem}>Uses the active protocol when available for direct guidance</Text>
        <Text style={styles.listItem}>Alerts CRC automatically when protocol coverage is unclear or urgent escalation is needed</Text>
        <Text style={styles.listItem}>Keeps the full AI conversation for audit</Text>

        <TouchableOpacity onPress={() => router.back()} style={styles.button}>
          <Text style={styles.buttonText}>Back To Patient Home</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 16,
    backgroundColor: '#eef3f8',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 18,
    padding: 18,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#14324a',
    marginBottom: 12,
  },
  body: {
    color: '#486581',
    lineHeight: 21,
    marginBottom: 10,
  },
  listItem: {
    color: '#243b53',
    lineHeight: 21,
    marginBottom: 8,
  },
  button: {
    marginTop: 16,
    backgroundColor: '#0f609b',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontWeight: '700',
  },
});

export default SideEffectReportScreen;
