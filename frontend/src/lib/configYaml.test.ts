import { describe, expect, it } from "vitest";

import { configToYaml } from "./configYaml";

describe("configToYaml 分组显示", () => {
  it("为策略配置加入注释和空行", () => {
    const output = configToYaml(
      {
        id: "microduck",
        buy_budget_usd: "1",
        sell_profit_multiple: "1.5",
        chain: "ethereum",
        normal_check_interval: 5,
        nvda_price_url: "https://example.test/NVDA",
        live_trading: true,
      },
      { groupSections: true },
    );

    expect(output).toContain("# 买入规则\nbuy_budget_usd: '1'");
    expect(output).toContain("\n\n# 卖出规则\n");
    expect(output).toContain("\n\n# 交易对象\n");
    expect(output).toContain("\n\n# 检查频率\n");
    expect(output).toContain("\n\n# 行情接口与失败重试\n");
    expect(output).toContain("\n\n# 安全与运行模式\n");
    expect(output).not.toContain("id:");
  });
});
