import { expect, it } from "vitest";
import { runtimeConfigMatches } from "./runtime-config-match";
it("只确认实际回报的所有参数", () => {
  expect(runtimeConfigMatches({ amount: "10.0", mode: "quantity" }, { amount: 10, mode: "quantity" })).toBe(true);
  expect(runtimeConfigMatches({ amount: 10 }, {})).toBe(false);
  expect(runtimeConfigMatches({ amount: 10 }, { amount: 9 })).toBe(false);
  expect(runtimeConfigMatches({ live_trading: false }, { live_trading: true })).toBe(false);
});
