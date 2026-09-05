export const TRADE_NOTIFICATION_SETTINGS_KEY = "microduck.tradeNotificationSettings";

export interface TradeNotificationSettings {
  browserEnabled: boolean;
  systemEnabled: boolean;
}

export const DEFAULT_TRADE_NOTIFICATION_SETTINGS: TradeNotificationSettings = {
  browserEnabled: true,
  systemEnabled: true,
};

export function readTradeNotificationSettings(): TradeNotificationSettings {
  if (typeof window === "undefined") return DEFAULT_TRADE_NOTIFICATION_SETTINGS;
  try {
    const stored = JSON.parse(window.localStorage.getItem(TRADE_NOTIFICATION_SETTINGS_KEY) || "{}");
    return {
      browserEnabled: stored.browserEnabled !== false,
      systemEnabled: stored.systemEnabled !== false,
    };
  } catch {
    return DEFAULT_TRADE_NOTIFICATION_SETTINGS;
  }
}

export function saveTradeNotificationSettings(settings: TradeNotificationSettings): void {
  window.localStorage.setItem(TRADE_NOTIFICATION_SETTINGS_KEY, JSON.stringify(settings));
}

export async function syncSystemNotificationSettings(settings: TradeNotificationSettings): Promise<void> {
  const response = await fetch("http://127.0.0.1:24873/notification-context", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system_notifications_enabled: settings.systemEnabled }),
  });
  if (!response.ok) throw new Error(`后台通知设置保存失败（HTTP ${response.status}）`);
}
