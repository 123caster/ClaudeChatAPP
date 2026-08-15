import { Redirect, useLocalSearchParams } from 'expo-router';

import { BasicChatScreen } from '@/screens/BasicChatScreen';
import { useConnection } from '@/state/connection-store';

export default function SessionRoute() {
  const connection = useConnection();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  if (!connection.apiKey) return <Redirect href="/" />;
  return <BasicChatScreen sessionId={sessionId} />;
}
