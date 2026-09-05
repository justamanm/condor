import type { ControllerInfo } from "@/lib/api";

export interface BrowserTradeNotification {
  key: string;
  title: string;
  body: string;
}

export interface BrowserTradeNotificationOptions {
  walletAliases?: Record<string, string>;
  ethUsdPrice?: number | null;
}

function displayNumber(value: unknown, digits = 6): string {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "未知";
}

function numeric(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function compactNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

/** 从控制器的已确认交易历史生成浏览器通知内容。 */
export function browserTradeNotifications(
  controllers: ControllerInfo[],
  options: BrowserTradeNotificationOptions = {},
): BrowserTradeNotification[] {
  return controllers.flatMap((controller) => {
    const custom = controller.custom_info || {};
    const history = Array.isArray(custom.trade_history) ? custom.trade_history : [];
    const botName = controller.bot_display_name?.trim() || controller.bot_name;
    let position = 0;
    let cost = 0;
    return [...history].sort((left, right) =>
      String((left as Record<string, unknown>)?.timestamp || "").localeCompare(
        String((right as Record<string, unknown>)?.timestamp || ""),
      )).flatMap((rawTrade, index) => {
      if (!rawTrade || typeof rawTrade !== "object") return [];
      const trade = rawTrade as Record<string, unknown>;
      const side = String(trade.side || "").toUpperCase();
      if (side !== "BUY" && side !== "SELL") return [];
      const amount = Math.max(numeric(trade.amount_base), 0);
      const total = Math.max(numeric(trade.total_usd), 0);
      let profit: number | null = null;
      let profitPercent: number | null = null;
      if (side === "BUY") {
        position += amount;
        cost += total;
      } else {
        const soldCost = position > 0 ? Math.min(amount, position) * (cost / position) : 0;
        if (soldCost > 0) {
          profit = total - soldCost;
          profitPercent = profit / soldCost * 100;
        }
        position = Math.max(position - amount, 0);
        cost = Math.max(cost - soldCost, 0);
      }
      const transactionHash = String(trade.transaction_hash || "").trim();
      const timestamp = String(trade.timestamp || "").trim();
      const key = transactionHash
        ? `${controller.bot_name}:${transactionHash.toLowerCase()}`
        : `${controller.bot_name}:${side}:${timestamp || index}`;
      const walletAddress = String(trade.wallet_address || custom.wallet_address || controller.config?.wallet_address || "").trim().toLowerCase();
      const walletAlias = options.walletAliases?.[walletAddress]?.trim();
      const walletText = walletAddress
        ? walletAlias ? `${walletAlias}（…${walletAddress.slice(-5)}）` : `…${walletAddress.slice(-5)}`
        : "暂未获取";
      const gas = numeric(trade.fee_native ?? trade.gas_fee_native);
      const gasUsd = gas > 0 && numeric(options.ethUsdPrice) > 0 ? gas * numeric(options.ethUsdPrice) : null;
      const gasText = gas > 0
        ? `${gas.toFixed(8)} ETH${gasUsd === null ? "" : `（约 $${gasUsd.toFixed(6)}）`}`
        : "暂未获取";
      const detail = [
        `${compactNumber(amount)} MICRODUCK × $${displayNumber(trade.price_usd)}`,
        `实际${side === "BUY" ? "支出" : "收到"}：${displayNumber(trade.total_usd)} USDG`,
      ];
      if (side === "SELL" && profit !== null && profitPercent !== null) {
        detail.push(`本次利润：${profit >= 0 ? "+" : ""}${profit.toFixed(6)} USDG（${profitPercent >= 0 ? "+" : ""}${profitPercent.toFixed(2)}%）`);
      }
      detail.push("", `钱包：${walletText}`, `${side === "BUY" ? "买入" : "卖出"}后持仓：${compactNumber(position)} MICRODUCK`, `Gas：${gasText}`);
      return [{
        key,
        title: `${botName} · ${side === "BUY" ? "买入成功" : "卖出成功"}`,
        body: detail.join("\n"),
      }];
    });
  });
}
