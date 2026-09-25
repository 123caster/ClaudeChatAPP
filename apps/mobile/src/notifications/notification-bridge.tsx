import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { createRequestId, GatewayClient } from '@/api/gateway-client';
import { expoPushProjectId } from '@/notifications/notification-config';
import { taskIdFromNotificationData } from '@/notifications/notification-routing';
import { useConnection } from '@/state/connection-store';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function openNotification(response: Notifications.NotificationResponse): void {
  const taskId = taskIdFromNotificationData(response.notification.request.content.data);
  if (taskId) {
    router.push({ pathname: '/scheduled/[taskId]', params: { taskId } });
  }
}

export function NotificationBridge() {
  const connection = useConnection();
  const handledResponseId = useRef<string | null>(null);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const id = response.notification.request.identifier;
      if (handledResponseId.current === id) return;
      handledResponseId.current = id;
      openNotification(response);
    });
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const id = response.notification.request.identifier;
      if (handledResponseId.current === id) return;
      handledResponseId.current = id;
      openNotification(response);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const gatewayUrl = connection.gatewayUrl;
    const deviceToken = connection.deviceToken;
    if (!gatewayUrl || !deviceToken || !Device.isDevice) return;
    let cancelled = false;
    const register = async () => {
      const client = new GatewayClient(gatewayUrl);
      const health = await client.health(deviceToken);
      if (health.push?.status !== 'ready') return;
      if (Platform.OS === 'android') {
        await Promise.all([
          Notifications.setNotificationChannelAsync('scheduled-results', {
            name: '任务结果',
            importance: Notifications.AndroidImportance.DEFAULT,
          }),
          Notifications.setNotificationChannelAsync('scheduled-attention', {
            name: '需要确认',
            importance: Notifications.AndroidImportance.HIGH,
          }),
          Notifications.setNotificationChannelAsync('scheduled-failures', {
            name: '任务失败',
            importance: Notifications.AndroidImportance.HIGH,
          }),
        ]);
      }
      const current = await Notifications.getPermissionsAsync();
      const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
      if (!permission.granted || cancelled) return;
      const projectId = expoPushProjectId();
      if (!projectId) return;
      const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      if (!cancelled) {
        await client.registerPushSubscription(deviceToken, token, createRequestId());
      }
    };
    void register().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [connection.deviceToken, connection.gatewayUrl]);

  return null;
}
