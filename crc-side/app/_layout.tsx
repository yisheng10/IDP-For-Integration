import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import CallOverlay from '../src/components/CallOverlay';
import { CallProvider } from '../src/context/CallContext';

export const unstable_settings = {
  initialRouteName: 'index',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <CallProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="ctcae" options={{ title: 'CTCAE' }} />
          <Stack.Screen name="questionnaire" options={{ title: 'ePRO Questionnaire' }} />
          <Stack.Screen name="side-effect" options={{ title: 'Symptom Intake' }} />
        </Stack>
        <CallOverlay />
        <StatusBar style="auto" />
      </ThemeProvider>
    </CallProvider>
  );
}
