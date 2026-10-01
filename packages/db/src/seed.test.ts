import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROLE_PRESETS } from "@henine/shared";

const baseSql = readFileSync(join(__dirname, "../seed/base.sql"), "utf8");
const geoSql = readFileSync(join(__dirname, "../seed/geo.sql"), "utf8");

describe("base seed", () => {
  it("keeps role permissions in sync with ROLE_PRESETS", () => {
    for (const [key, preset] of Object.entries(ROLE_PRESETS)) {
      const m = baseSql.match(new RegExp(`\\('${key}', '([^']+)', '(\\[[^\\]]*\\])'\\)`));
      expect(m, `role ${key} missing from base.sql`).not.toBeNull();
      expect(JSON.parse(m![2]!)).toEqual([...preset.permissions]);
    }
  });
});

describe("geo seed", () => {
  it("has all 69 wilayas", () => {
    const codes = [...geoSql.matchAll(/INSERT INTO wilayas .*? VALUES \((\d+),/g)].map((m) => Number(m[1]));
    expect(codes).toEqual(Array.from({ length: 69 }, (_, i) => i + 1));
  });

  it("has every commune exactly once", () => {
    const ids = [...geoSql.matchAll(/^\((\d+), \d+, '/gm)].map((m) => Number(m[1]));
    expect(ids.length).toBe(1541);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
