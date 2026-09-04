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
    priceQueryGroup: string | null;
    cacheHit: boolean;
    cacheAgeSeconds: number | null;
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
    const cachedSourceBotName = typeof custom.price_quote_source_bot_name === "string"
      ? custom.price_quote_source_bot_name.trim()
      : "";
    const sourceBotName = cachedSourceBotName || controller.bot_name;
    const sourceController = controllers.find((item) => item.bot_name === sourceBotName);
    const hasCacheAge = custom.price_quote_cache_age_seconds !== null
      && custom.price_quote_cache_age_seconds !== undefined
      && custom.price_quote_cache_age_seconds !== "";
    const rawCacheAge = hasCacheAge ? Number(custom.price_quote_cache_age_seconds) : Number.NaN;
    return [{
      asset: controller.trading_pair?.split("-")[0] || "—",
      price,
      updatedAt: typeof custom.price_quote_completed_at === "string" ? custom.price_quote_completed_at : null,
      reportedAt: typeof custom.reported_at === "string" ? custom.reported_at : null,
      sourceBotName,
      sourceBotDisplayName: sourceController?.bot_display_name?.trim() || null,
      priceQueryGroup: typeof custom.price_query_group === "string" && custom.price_query_group.trim()
        ? custom.price_query_group.trim()
        : null,
      cacheHit: custom.price_quote_cache_hit === true,
      cacheAgeSeconds: Number.isFinite(rawCacheAge) ? rawCacheAge : null,
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
