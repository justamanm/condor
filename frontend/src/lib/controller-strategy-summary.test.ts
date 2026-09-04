import { describe, expect, it } from "vitest";

import type { ControllerInfo } from "@/lib/api";
import { controllerStrategySummary } from "@/lib/controller-strategy-summary";

function controller(customInfo: Record<string, unknown>): ControllerInfo {
  return {
    controller_name: "microduck_profit_trailing",
    controller_id: "microduck",
    bot_name: "bot",
    status: "running",
    connector: "uniswap",
    trading_pair: "MICRODUCK-NVDA",
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
    custom_info: customInfo,
  };
}

describe("controllerStrategySummary", () => {
  it("shows configured prices before a position exists", () => {
    const summary = controllerStrategySummary([
      controller({
        state: "waiting_to_buy",
        buy_price_min_usd: "0.013",
        sell_price_max_usd: "0.021545",
      }),
    ]);

    expect(summary).toEqual({
      configuredBuyPrice: 0.013,
      estimatedSellPrice: 0.021545,
      profitPercent: null,
      availableBaseBalance: null,
      walletCount: 1,
      tradeState: "Buy · Waiting",
    });
  });

  it("hides profit and reports the remaining wallet balance after an external exit", () => {
    const summary = controllerStrategySummary([
      controller({
        state: "external_exit",
        position_base: "0",
        entry_unit_price_usd: "0.013",
        unit_sell_price_usd: "0.035",
        external_balance_change: {
          previous_state: "holding",
          wallet_balance_base: "0.25",
          reason: "wallet_balance_below_managed_position",
        },
      }),
    ]);

    expect(summary.tradeState).toBe("检测到钱包 MICRODUCK 持仓变化，已暂停");
    expect(summary.profitPercent).toBeNull();
    expect(summary.availableBaseBalance).toBe(0.25);
    expect(summary.walletCount).toBe(1);
  });

  it("identifies a buy-phase balance stop", () => {
    const summary = controllerStrategySummary([
      controller({
        state: "external_exit",
        external_balance_change: { previous_state: "buying" },
      }),
    ]);

    expect(summary.tradeState).toBe("检测到钱包余额变化，已暂停");
  });

  it("deduplicates a shared wallet and sums distinct wallets", () => {
    const first = controller({ available_base_balance: "10" });
    first.bot_name = "bot-1";
    first.config = { wallet_address: "0xABC" };
    const shared = controller({ available_base_balance: "10" });
    shared.bot_name = "bot-2";
    shared.config = { wallet_address: "0xabc" };
    const secondWallet = controller({ available_base_balance: "5" });
    secondWallet.bot_name = "bot-3";
    secondWallet.config = { wallet_address: "0xDEF" };

    const summary = controllerStrategySummary([first, shared, secondWallet]);

    expect(summary.availableBaseBalance).toBe(15);
    expect(summary.walletCount).toBe(2);
  });

  it("shows the effective sell price after buying", () => {
    const summary = controllerStrategySummary([
      controller({
        state: "holding",
        buy_price_min_usd: "0.013",
        sell_price_max_usd: "0.020000",
        sell_tracking_start_unit_price_usd: "0.018750",
        entry_unit_price_usd: "0.012500",
        unit_sell_price_usd: "0.015000",
      }),
    ]);

    expect(summary.estimatedSellPrice).toBe(0.01875);
    expect(summary.profitPercent).toBeCloseTo(20);
    expect(summary.tradeState).toBe("Sell · Waiting");
  });

  it("derives the sell phase and capped price from an old backend response", () => {
    const item = controller({});
    item.config = {
      buy_price_min_usd: "0.013",
      sell_price_max_usd: "0.021545",
      sell_profit_multiple: "1.5",
      sell_price_downward_tolerance_usd: "0",
    };
    item.positions_summary = [
      { amount: 78, entry_price: 0.01436291, current_price: 0.0158 },
    ];

    const summary = controllerStrategySummary([item]);

    expect(summary.configuredBuyPrice).toBe(0.013);
    expect(summary.estimatedSellPrice).toBeCloseTo(0.021544365);
    expect(summary.profitPercent).toBeCloseTo(10.007, 2);
    expect(summary.tradeState).toBe("Sell · Waiting");
  });
});
