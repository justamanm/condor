import { describe, expect, it } from "vitest";

import { formatValueAxis } from "@/lib/pnl-chart";

describe("formatValueAxis", () => {
  it("keeps cents visible for small position values", () => {
    expect(formatValueAxis(1.13)).toBe("$1.13");
    expect(formatValueAxis(1.19)).toBe("$1.19");
    expect(formatValueAxis(0)).toBe("$0.00");
  });

  it("keeps compact formatting for large values", () => {
    expect(formatValueAxis(1250)).toBe("$1.3K");
  });
});
