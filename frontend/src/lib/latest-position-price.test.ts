import { describe, expect, it } from "vitest";

import type { ControllerInfo } from "@/lib/api";
import { latestPositionPrice } from "@/lib/latest-position-price";

function controller(tradingPair: string): ControllerInfo {
  return {
    controller_name: "test",
    controller_id: "test",
    bot_name: "bot",
    status: "running",
    connector: "uniswap",
    trading_pair: tradingPair,
    realized_pnl_quote: 0,
    unrealized_pnl_quote: 0,
    global_pnl_quote: 0,
    global_pnl_pct: 0,
    volume_traded: 0,
    close_type_counts: {},
    positions_summary: [],
    trades: [],
    deployed_at: null,
    config: {},
  };
}

describe("latestPositionPrice", () => {
  it("returns null rather than presenting a position valuation as the latest price", () => {
    expect(latestPositionPrice([controller("MICRODUCK-NVDA")])).toBeNull();
  });

  it("uses the latest strategy quote before a position exists", () => {
    const item = controller("MICRODUCK-NVDA");
    item.custom_info = { state: "waiting_to_buy", buy_price_usd: "0.012345", price_quote_completed_at: "2026-09-05T04:17:00Z" };

    expect(latestPositionPrice([item])).toEqual({
      kind: "price",
      asset: "MICRODUCK",
      price: 0.012345,
      updatedAt: "2026-09-05T04:17:00Z",
      reportedAt: null,
      sourceBotName: "bot",
      sourceBotDisplayName: null,
    });
  });

  it("uses the newest successful quote instead of an older bot position", () => {
    const older = controller("MICRODUCK-NVDA");
    older.bot_name = "old-bot";
    older.custom_info = { state: "holding", unit_sell_price_usd: "0.024210", price_quote_completed_at: "2026-09-05T03:00:00Z" };
    const newer = controller("MICRODUCK-NVDA");
    newer.bot_name = "live-bot";
    newer.bot_display_name = "实时 Bot";
    newer.custom_info = { state: "waiting_to_buy", buy_price_usd: "0.032100", price_quote_completed_at: "2026-09-05T04:17:00Z" };

    expect(latestPositionPrice([older, newer])).toMatchObject({
      kind: "price", price: 0.0321, sourceBotName: "live-bot", sourceBotDisplayName: "实时 Bot",
    });
  });
});
