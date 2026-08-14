import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { ConnectionProvider } from '@/state/connection-store';
import { SessionProvider } from '@/state/session-store';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <StatusBar style="dark" />
        <ConnectionProvider>
          <SessionProvider>
            <Stack screenOptions={{ headerShown: false }} />
          </SessionProvider>
        </ConnectionProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
