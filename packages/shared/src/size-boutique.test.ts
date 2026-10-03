import { describe, expect, it } from "vitest";
import { boutiqueStatus, recommendSize, type DayHours } from "./index";

const guide = {
  headers: ["Taille", "Tour de poitrine (cm)", "Tour de taille (cm)", "Tour de hanches (cm)"],
  rows: [
    ["S", "84-88", "64-68", "90-94"],
    ["M", "88-92", "68-72", "94-98"],
    ["L", "92-98", "72-78", "98-104"],
    ["XL", "98-104", "78-84", "104-110"],
  ],
};

describe("size advice", () => {
  it("reads measurements against the chart and keeps the largest", () => {
    const a = recommendSize({ sizes: ["S", "M", "L", "XL"], guide, bust: 90, waist: 75 })!;
    expect(a.size).toBe("L");
    expect(a.method).toBe("measurements");
    expect(a.reasons[0]!.fr).toContain("M (88-92 cm)");
  });

  it("goes one size up at the top of a range for a loose fit, and offers the neighbour otherwise", () => {
    expect(recommendSize({ sizes: ["S", "M", "L"], guide, bust: 91.5, fit: "loose" })!.size).toBe("L");
    const regular = recommendSize({ sizes: ["S", "M", "L"], guide, bust: 91.5 })!;
    expect(regular.size).toBe("M");
    expect(regular.alternative).toBe("L");
  });

  it("only suggests sizes the product has", () => {
    expect(recommendSize({ sizes: ["M", "L"], guide, bust: 85 })!.size).toBe("M");
  });

  it("estimates from height and weight without a chart", () => {
    expect(recommendSize({ sizes: ["S", "M", "L", "XL"], height: 165, weight: 60 })!.size).toBe("M");
    expect(recommendSize({ sizes: ["36", "38", "40", "42"], height: 160, weight: 72 })!.size).toBe("42");
    expect(recommendSize({ sizes: ["S", "M"], height: 165 })).toBeNull();
  });
});

describe("boutique status (Algiers time)", () => {
  const h: (DayHours | null)[] = Array.from({ length: 7 }, (_, d) => (d === 5 ? null : { open: "09:00", close: "20:00" }));
  // 2026-10-03 is a Saturday; 10:00 Algiers = 09:00 UTC
  const sat = (hhmm: string) => Date.parse(`2026-10-03T${hhmm}:00+01:00`);
  it("is open during the hours", () => {
    expect(boutiqueStatus(h, sat("10:00"))).toMatchObject({ open: true, closesAt: "20:00" });
  });
  it("gives the next opening when closed", () => {
    expect(boutiqueStatus(h, sat("21:00")).next).toMatchObject({ day: 0, time: "09:00", tomorrow: true });
    expect(boutiqueStatus(h, sat("08:00")).next).toMatchObject({ day: 6, today: true });
  });
  it("skips closed days (Friday)", () => {
    const thu = Date.parse("2026-10-01T21:00:00+01:00");
    expect(boutiqueStatus(h, thu).next).toMatchObject({ day: 6 });
  });
});
