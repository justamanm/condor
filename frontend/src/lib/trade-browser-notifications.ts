import type { ControllerInfo } from "@/lib/api";

export interface BrowserTradeNotification {
  key: string;
  title: string;
  body: string;
}

function displayNumber(value: unknown, digits = 6): string {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "未知";
}

/** 从控制器的已确认交易历史生成浏览器通知内容。 */
export function browserTradeNotifications(controllers: ControllerInfo[]): BrowserTradeNotification[] {
  return controllers.flatMap((controller) => {
    const custom = controller.custom_info || {};
    const history = Array.isArray(custom.trade_history) ? custom.trade_history : [];
    const botName = controller.bot_display_name?.trim() || controller.bot_name;
    return history.flatMap((rawTrade, index) => {
      if (!rawTrade || typeof rawTrade !== "object") return [];
      const trade = rawTrade as Record<string, unknown>;
      const side = String(trade.side || "").toUpperCase();
      if (side !== "BUY" && side !== "SELL") return [];
      const transactionHash = String(trade.transaction_hash || "").trim();
      const timestamp = String(trade.timestamp || "").trim();
      const key = transactionHash
        ? `${controller.bot_name}:${transactionHash.toLowerCase()}`
        : `${controller.bot_name}:${side}:${timestamp || index}`;
      return [{
        key,
        title: `${botName} ${side === "BUY" ? "买入成功" : "卖出成功"}`,
        body: `${displayNumber(trade.amount_base)} MICRODUCK，成交价 $${displayNumber(trade.price_usd)}，总额 ${displayNumber(trade.total_usd)} USDG`,
      }];
    });
  });
}
