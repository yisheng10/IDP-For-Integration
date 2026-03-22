import { Asset } from 'expo-asset';
// CHANGE: Import from the legacy namespace to use copyAsync in SDK 54+
import * as FileSystem from 'expo-file-system/legacy';
import { Stack } from 'expo-router';
import * as Sharing from 'expo-sharing';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Button, StyleSheet, Text, View } from 'react-native';

export default function CTCAEScreen() {
  const [loading, setLoading] = useState(false);

  const openPdf = async () => {
    try {
      setLoading(true);

      // Point to the correct file location
      const asset = Asset.fromModule(require('../assets/images/CTCAE.pdf'));
      
      // Ensure the asset is loaded/downloaded to the cache
      await asset.downloadAsync();

      // Debugging: Log where the file is
      console.log("Asset downloaded to:", asset.localUri || asset.uri);

      // Define the destination in the app's document directory
      const localUri = `${FileSystem.documentDirectory}CTCAE_Guidelines.pdf`;

      // Copy the file from the asset cache to the document directory
      // This method is now safe to use with the legacy import
      await FileSystem.copyAsync({
        from: asset.localUri || asset.uri,
        to: localUri,
      });

      // Verify file existence (optional but good for debugging)
      const info = await FileSystem.getInfoAsync(localUri);
      if (!info.exists) {
        throw new Error("File copy failed - file not found at destination");
      }

      // Open the file with the system viewer
      await Sharing.shareAsync(localUri, {
        mimeType: 'application/pdf',
        dialogTitle: 'View CTCAE Guidelines',
        UTI: 'com.adobe.pdf'
      });

    } catch (error) {
      console.error("PDF Error:", error);
      Alert.alert("Error Opening PDF", error.message || "Unknown error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Guidelines' }} />
      
      <Text style={styles.title}>CTCAE Guidelines</Text>
      <Text style={styles.subtitle}>
        Click below to open the official guidelines PDF.
      </Text>

      {loading ? (
        <ActivityIndicator size="large" color="#007bff" />
      ) : (
        <Button title="Open PDF Document" onPress={openPdf} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
  },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 10 },
  subtitle: { fontSize: 16, color: '#666', textAlign: 'center', marginBottom: 30 },
});