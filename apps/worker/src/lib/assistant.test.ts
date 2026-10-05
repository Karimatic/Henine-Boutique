import { describe, expect, it } from "vitest";
import { understand } from "./assistant";

describe("assistant: understanding a wish", () => {
  it("reads an Arabic request: colour, occasion, budget", () => {
    const w = understand("أريد لباسًا أسود لحفل زفاف بأقل من 8000 دج");
    expect(w.colors.map((c) => c.key)).toEqual(["noir"]);
    expect(w.occasion?.fr).toBe("mariage / soirée");
    expect(w.maxPrice).toBe(8000);
  });

  it("reads a French request with a size and a spaced amount", () => {
    const w = understand("Robe rouge taille M, moins de 6 500 DA");
    expect(w.categories).toEqual(["gandouras"]);
    expect(w.colors.map((c) => c.key)).toEqual(["rouge"]);
    expect(w.sizes).toEqual(["m"]);
    expect(w.maxPrice).toBe(6500);
  });

  it("knows the new categories (lingerie, gaines, trousseau, sport, seasons)", () => {
    expect(understand("قميص نوم أسود").categories).toEqual(["nuisettes"]);
    expect(understand("je cherche une gaine").categories).toEqual(["gaines"]);
    expect(understand("جهاز العروس").categories).toContain("trousseau");
    expect(understand("survetement taille L").categories).toEqual(["sport"]);
    expect(understand("بيجامة شتوية").categories).toEqual(["pyjamas", "pyjamas-hiver"]);
  });

  it("understands ranges, thousands and Arabic digits", () => {
    expect(understand("pyjama entre 2000 et 4000")).toMatchObject({ minPrice: 2000, maxPrice: 4000, categories: ["pyjamas"] });
    expect(understand("بيجامة حتى 5 آلاف").maxPrice).toBe(5000);
    expect(understand("فستان ب ٧٠٠٠ دج").maxPrice).toBe(7000);
  });

  it("does not take a quantity or a size for a budget", () => {
    expect(understand("2 robes noires").maxPrice).toBeNull();
    expect(understand("nuisette L").sizes).toEqual([]);
    expect(understand("nuisette taille L").sizes).toEqual(["l"]);
  });

  it("reads Arabic words with a prefix (لعرس, بالأحمر)", () => {
    const w = understand("فستان أسود لعرس");
    expect(w.occasion?.fr).toBe("mariage / soirée");
    expect(w.words).toEqual([]);
    expect(understand("بيجامة بالأحمر").colors.map((c) => c.key)).toEqual(["rouge"]);
  });

  it("keeps the remaining words for matching", () => {
    expect(understand("robe en satin").words).toContain("satin");
  });
});
