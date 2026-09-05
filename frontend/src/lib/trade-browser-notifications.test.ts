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
      wallet_address: "0x1234567890abcde",
      fee_native: "0.000026",
    }] };

    expect(browserTradeNotifications([item], {
      walletAliases: { "0x1234567890abcde": "钱包-a" },
      ethUsdPrice: 2500,
    })).toEqual([{
      key: "bot-original:0xabc",
      title: "循环 Bot · 买入成功",
      body: [
        "500 MICRODUCK × $0.026000",
        "实际支出：13.000000 USDG",
        "",
        "钱包：钱包-a（…abcde）",
        "买入后持仓：500 MICRODUCK",
        "Gas：0.00002600 ETH（约 $0.065000）",
      ].join("\n"),
    }]);
  });

  it("puts realized profit before wallet and gas in sell notifications", () => {
    const item = controller();
    item.custom_info = { trade_history: [
      { side: "BUY", timestamp: "2026-09-05T10:00:00Z", transaction_hash: "0x1", amount_base: 500, price_usd: 0.024, total_usd: 12 },
      { side: "SELL", timestamp: "2026-09-05T11:00:00Z", transaction_hash: "0x2", amount_base: 500, price_usd: 0.038, total_usd: 19 },
    ] };

    expect(browserTradeNotifications([item])[1].body.split("\n").slice(0, 4)).toEqual([
      "500 MICRODUCK × $0.038000",
      "实际收到：19.000000 USDG",
      "本次利润：+7.000000 USDG（+58.33%）",
      "",
    ]);
  });

  it("ignores records that are not buys or sells", () => {
    const item = controller();
    item.custom_info = { trade_history: [{ side: "APPROVE", transaction_hash: "0x1" }] };
    expect(browserTradeNotifications([item])).toEqual([]);
  });
});
