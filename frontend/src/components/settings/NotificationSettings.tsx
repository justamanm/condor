import { BarChart3, Bell, BellRing, Monitor } from "lucide-react";
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
  const [systemTestPending, setSystemTestPending] = useState(false);

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

  const testBrowserNotification = async () => {
    if (!("Notification" in window)) {
      setMessage("当前浏览器不支持网页通知。");
      return;
    }
    let permission = Notification.permission;
    if (permission === "default") permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setMessage("网页通知未获允许，请在网站权限中开启通知。");
      return;
    }
    new Notification("测试 Bot · 买入成功", {
      body: "500 MICRODUCK × $0.023919\n实际支出：11.959500 USDG\n\n钱包：钱包-a（…a5336）\n买入后持仓：500 MICRODUCK\nGas：0.00002600 ETH（约 $0.060000）",
      tag: `microduck-browser-test-${Date.now()}`,
    });
    setMessage("网页测试通知已发送。");
  };

  const testSystemNotification = async () => {
    setSystemTestPending(true);
    setMessage(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch("http://127.0.0.1:24873/test", { method: "POST", signal: controller.signal });
      if (!response.ok) throw new Error(`后台程序返回 ${response.status}`);
      setMessage("Mac 系统测试通知已发送。");
    } catch (error) {
      const detail = error instanceof DOMException && error.name === "AbortError"
        ? "连接超时"
        : error instanceof Error ? error.message : "无法连接";
      setMessage(`系统通知失败：${detail}。请检查 Mac 后台通知程序。`);
    } finally {
      window.clearTimeout(timeout);
      setSystemTestPending(false);
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
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!settings.browserEnabled} onClick={() => void testBrowserNotification()} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-50">
          <BellRing className="h-4 w-4" />测试网页通知
        </button>
        <button type="button" disabled={!settings.systemEnabled || systemTestPending} onClick={() => void testSystemNotification()} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-50">
          <BellRing className="h-4 w-4" />{systemTestPending ? "正在测试…" : "测试系统通知"}
        </button>
      </div>
      {message && <p className="text-sm text-[var(--color-text-muted)]">{message}</p>}

      <div className="border-t border-[var(--color-border)] pt-5">
        <h2 className="text-base font-semibold text-[var(--color-text)]">Bot 页面显示</h2>
        <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-4">
          <BarChart3 className="h-5 w-5 shrink-0 text-[var(--color-primary)]" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-[var(--color-text)]">显示各 Bot 的买入追踪图表</span>
            <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">关闭后，Bot 页面不再渲染每个 Bot 的买入追踪图表。</span>
          </span>
          <input type="checkbox" checked={settings.showBotCharts} onChange={(event) => void update("showBotCharts", event.target.checked)} className="h-4 w-4 accent-[var(--color-primary)]" />
        </label>
      </div>
    </section>
  );
}
