export const TRADE_NOTIFICATION_SETTINGS_KEY = "microduck.tradeNotificationSettings";

export interface TradeNotificationSettings {
  browserEnabled: boolean;
  systemEnabled: boolean;
  showBotCharts: boolean;
}

export const DEFAULT_TRADE_NOTIFICATION_SETTINGS: TradeNotificationSettings = {
  browserEnabled: true,
  systemEnabled: true,
  showBotCharts: true,
};

export function readTradeNotificationSettings(): TradeNotificationSettings {
  if (typeof window === "undefined") return DEFAULT_TRADE_NOTIFICATION_SETTINGS;
  try {
    const stored = JSON.parse(window.localStorage.getItem(TRADE_NOTIFICATION_SETTINGS_KEY) || "{}");
    return {
      browserEnabled: stored.browserEnabled !== false,
      systemEnabled: stored.systemEnabled !== false,
      showBotCharts: stored.showBotCharts !== false,
    };
  } catch {
    return DEFAULT_TRADE_NOTIFICATION_SETTINGS;
  }
}

export function saveTradeNotificationSettings(settings: TradeNotificationSettings): void {
  window.localStorage.setItem(TRADE_NOTIFICATION_SETTINGS_KEY, JSON.stringify(settings));
}

export async function syncSystemNotificationSettings(settings: TradeNotificationSettings): Promise<void> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch("http://127.0.0.1:24873/notification-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system_notifications_enabled: settings.systemEnabled }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`后台通知设置保存失败（HTTP ${response.status}）`);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("后台通知程序连接超时，设置已保存在当前页面。");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
