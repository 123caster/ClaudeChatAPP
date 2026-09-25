import { Redirect } from 'expo-router';

import { ModelScreen } from '@/screens/ModelScreen';
import { useConnection } from '@/state/connection-store';

export default function ModelsRoute() {
  const connection = useConnection();
  if (!connection.deviceToken) return <Redirect href="/" />;
  return <ModelScreen />;
}
