import { formatTrafficPercent } from "../HealthStatusTab";

describe("formatTrafficPercent", () => {
  it("renders dashboard percent values without double scaling", () => {
    expect(formatTrafficPercent(96.6)).toBe("96.60%");
  });

  it("normalizes legacy ratio and double-scaled percent inputs", () => {
    expect(formatTrafficPercent(0.966)).toBe("96.60%");
    expect(formatTrafficPercent(9660)).toBe("96.60%");
  });

  it("keeps invalid or out-of-range values safe for a KPI card", () => {
    expect(formatTrafficPercent(null)).toBe("—");
    expect(formatTrafficPercent(125)).toBe("100.00%");
  });
});
