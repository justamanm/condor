import type { ControllerInfo } from "@/lib/api";

export type LatestPositionPrice =
  | {
    kind: "price";
    asset: string;
    price: number;
    updatedAt: string | null;
    reportedAt: string | null;
    sourceBotName: string;
    sourceBotDisplayName: string | null;
  }
  | { kind: "multiple" };

/**
 * 顶部卡片只显示 Bot 最近一次成功取得的单币报价，绝不使用持仓估值。
 * 持仓估值可能是旧快照，不能冒充“最新价格”。同一币种取报价完成时间最新的 Bot。
 */
export function latestPositionPrice(
  controllers: ControllerInfo[],
): LatestPositionPrice | null {
  const prices = controllers.flatMap((controller) => {
    const custom = controller.custom_info || {};
    const state = String(custom.state || "");
    const rawPrice = ["holding", "trailing", "selling"].includes(state)
      ? custom.unit_sell_price_usd
      : custom.buy_price_usd;
    const price = Number(rawPrice);
    if (!Number.isFinite(price) || price <= 0) return [];
    return [{
      asset: controller.trading_pair?.split("-")[0] || "—",
      price,
      updatedAt: typeof custom.price_quote_completed_at === "string" ? custom.price_quote_completed_at : null,
      reportedAt: typeof custom.reported_at === "string" ? custom.reported_at : null,
      sourceBotName: controller.bot_name,
      sourceBotDisplayName: controller.bot_display_name?.trim() || null,
    }];
  });
  if (prices.length === 0) return null;
  if (new Set(prices.map((item) => item.asset)).size > 1) return { kind: "multiple" };

  const latest = prices.reduce((latest, item) => {
    const latestAt = latest.updatedAt ? Date.parse(latest.updatedAt) : -Infinity;
    const itemAt = item.updatedAt ? Date.parse(item.updatedAt) : -Infinity;
    return itemAt > latestAt ? item : latest;
  });
  return { kind: "price", ...latest };
}
