import { Bell, Monitor } from "lucide-react";
import { useState } from "react";

import {
  readTradeNotificationSettings,
  saveTradeNotificationSettings,
  syncSystemNotificationSettings,
  type TradeNotificationSettings,
} from "@/lib/trade-notification-settings";

export function NotificationSettings() {
  const [settings, setSettings] = useState(readTradeNotificationSettings);
  const [message, setMessage] = useState<string | null>(null);

  const update = async (key: keyof TradeNotificationSettings, enabled: boolean) => {
    const next = { ...settings, [key]: enabled };
    setSettings(next);
    saveTradeNotificationSettings(next);
    setMessage(key === "browserEnabled" ? "网页通知设置已保存。" : "正在保存系统通知设置…");
    if (key === "systemEnabled") {
      try {
        await syncSystemNotificationSettings(next);
        setMessage("系统通知设置已保存。");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "系统通知设置保存失败。");
      }
    }
  };

  const rows = [
    {
      key: "browserEnabled" as const,
      title: "网页通知",
      description: "Condor 页面打开时，在买入或卖出成功后发送浏览器通知。",
      icon: Bell,
    },
    {
      key: "systemEnabled" as const,
      title: "Mac 系统通知",
      description: "即使关闭 Condor 页面，也由本机后台程序发送买入和卖出通知。",
      icon: Monitor,
    },
  ];

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-[var(--color-text)]">成交通知</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">分别控制网页通知和关闭页面后仍可接收的 Mac 系统通知。</p>
      </div>
      <div className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        {rows.map(({ key, title, description, icon: Icon }) => (
          <label key={key} className="flex cursor-pointer items-center gap-3 px-4 py-4">
            <Icon className="h-5 w-5 shrink-0 text-[var(--color-primary)]" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-[var(--color-text)]">{title}</span>
              <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">{description}</span>
            </span>
            <input
              type="checkbox"
              checked={settings[key]}
              onChange={(event) => void update(key, event.target.checked)}
              className="h-4 w-4 accent-[var(--color-primary)]"
            />
          </label>
        ))}
      </div>
      {message && <p className="text-sm text-[var(--color-text-muted)]">{message}</p>}
    </section>
  );
}
