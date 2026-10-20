export const NOTIFICATION_PERMISSION_ACTIVE_TIME_MS = 24 * 60 * 60 * 1000;

export type QSessionEngagementState = {
  activeUsageMs: number;
  notificationPrompted: boolean;
};

export function normalizeEngagementState(
  value?: Partial<QSessionEngagementState> | null,
): QSessionEngagementState {
  const activeUsageMs = Number(value?.activeUsageMs);
  return {
    activeUsageMs:
      Number.isFinite(activeUsageMs) && activeUsageMs > 0
        ? Math.floor(activeUsageMs)
        : 0,
    notificationPrompted: value?.notificationPrompted === true,
  };
}

export function shouldRequestDeferredNotificationPermission(
  state: QSessionEngagementState,
): boolean {
  return (
    !state.notificationPrompted &&
    state.activeUsageMs >= NOTIFICATION_PERMISSION_ACTIVE_TIME_MS
  );
}
