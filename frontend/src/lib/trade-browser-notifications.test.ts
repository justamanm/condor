import { describe, expect, it } from "vitest";

import type { ControllerInfo } from "@/lib/api";
import { browserTradeNotifications } from "@/lib/trade-browser-notifications";

function controller(): ControllerInfo {
  return {
    controller_name: "microduck_profit_trailing",
    controller_id: "microduck",
    bot_name: "bot-original",
    bot_display_name: "循环 Bot",
    status: "running",
    connector: "uniswap",
    trading_pair: "MICRODUCK-USDG",
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

describe("browserTradeNotifications", () => {
  it("uses the bot alias and confirmed trade values", () => {
    const item = controller();
    item.custom_info = { trade_history: [{
      side: "BUY",
      timestamp: "2026-09-05T10:00:00Z",
      transaction_hash: "0xABC",
      amount_base: "500",
      price_usd: "0.026",
      total_usd: "13",
    }] };

    expect(browserTradeNotifications([item])).toEqual([{
      key: "bot-original:0xabc",
      title: "循环 Bot 买入成功",
      body: "500.000000 MICRODUCK，成交价 $0.026000，总额 13.000000 USDG",
    }]);
  });

  it("ignores records that are not buys or sells", () => {
    const item = controller();
    item.custom_info = { trade_history: [{ side: "APPROVE", transaction_hash: "0x1" }] };
    expect(browserTradeNotifications([item])).toEqual([]);
  });
});
