import {
  normalizeEngagementState,
  NOTIFICATION_PERMISSION_ACTIVE_TIME_MS,
  shouldRequestDeferredNotificationPermission,
} from '../src/QSessionEngagement';

test('espera 24 horas acumuladas de uso activo antes de pedir notificaciones', () => {
  expect(shouldRequestDeferredNotificationPermission({
    activeUsageMs: NOTIFICATION_PERMISSION_ACTIVE_TIME_MS - 1,
    notificationPrompted: false,
  })).toBe(false);
  expect(shouldRequestDeferredNotificationPermission({
    activeUsageMs: NOTIFICATION_PERMISSION_ACTIVE_TIME_MS,
    notificationPrompted: false,
  })).toBe(true);
});

test('no repite el permiso después de haberlo mostrado', () => {
  expect(shouldRequestDeferredNotificationPermission({
    activeUsageMs: NOTIFICATION_PERMISSION_ACTIVE_TIME_MS * 2,
    notificationPrompted: true,
  })).toBe(false);
});

test('normaliza con seguridad el estado persistido', () => {
  expect(normalizeEngagementState({
    activeUsageMs: Number.NaN,
    notificationPrompted: false,
  })).toEqual({activeUsageMs: 0, notificationPrompted: false});
  expect(normalizeEngagementState({
    activeUsageMs: 1234.9,
    notificationPrompted: true,
  })).toEqual({activeUsageMs: 1234, notificationPrompted: true});
});
