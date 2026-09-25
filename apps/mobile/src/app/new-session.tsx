import { Redirect } from 'expo-router';

import { NewSessionScreen } from '@/screens/NewSessionScreen';
import { useConnection } from '@/state/connection-store';

export default function NewSessionRoute() {
  const connection = useConnection();
  if (!connection.deviceToken) return <Redirect href="/" />;
  return <NewSessionScreen />;
}
