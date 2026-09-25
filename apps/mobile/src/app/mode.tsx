import { Redirect } from 'expo-router';

import { ModeScreen } from '@/screens/ModeScreen';
import { useConnection } from '@/state/connection-store';

export default function ModeRoute() {
  const connection = useConnection();
  if (!connection.deviceToken) return <Redirect href="/" />;
  return <ModeScreen />;
}
