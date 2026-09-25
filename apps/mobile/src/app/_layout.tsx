import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform, Text, TextInput } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { ConnectionProvider } from '@/state/connection-store';
import { ModelProvider } from '@/state/model-store';
import { ModeProvider } from '@/state/mode-store';
import { SessionProvider } from '@/state/session-store';
import { ScheduledTaskProvider } from '@/state/scheduled-task-store';
import { NotificationBridge } from '@/notifications/notification-bridge';

type DefaultStyledComponent = {
  defaultProps?: { style?: unknown };
};

const systemFont = Platform.select({ android: 'sans-serif', default: undefined });
(Text as unknown as DefaultStyledComponent).defaultProps = { style: { fontFamily: systemFont } };
(TextInput as unknown as DefaultStyledComponent).defaultProps = {
  style: { fontFamily: systemFont },
};

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <StatusBar style="dark" />
        <ConnectionProvider>
          <SessionProvider>
            <ScheduledTaskProvider>
              <NotificationBridge />
              <ModelProvider>
                <ModeProvider>
                  <Stack screenOptions={{ headerShown: false }} />
                </ModeProvider>
              </ModelProvider>
            </ScheduledTaskProvider>
          </SessionProvider>
        </ConnectionProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
