import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { ConnectionProvider } from '@/state/connection-store';
import { ModelProvider } from '@/state/model-store';
import { SessionProvider } from '@/state/session-store';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <StatusBar style="dark" />
        <ConnectionProvider>
          <SessionProvider>
            <ModelProvider>
              <Stack screenOptions={{ headerShown: false }} />
            </ModelProvider>
          </SessionProvider>
        </ConnectionProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
