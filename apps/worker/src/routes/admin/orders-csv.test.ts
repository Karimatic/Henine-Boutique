import { describe, expect, it } from "vitest";
import { addOrder, seedShop, testApp, testDb } from "../../test/db";
import { orderRoutes } from "./orders";

describe("orders export (CSV)", () => {
  it("titles in the admin's language, readable cells, a totals line, the filters on screen", async () => {
    const db = testDb();
    seedShop(db);
    addOrder(db, { status: "livree", phone: "0554650718", source: "instagram", items: [{ variantId: 1, qty: 2, price: 3_000 }], shipping: 500 });
    addOrder(db, { status: "nouvelle", phone: "0661223344", source: "facebook", items: [{ variantId: 1, qty: 1, price: 3_000 }], shipping: 500 });
    const app = testApp(orderRoutes, db);

    const arRes = await app.raw("GET", "/orders.csv?lang=ar");
    const bytes = new Uint8Array(await arRes.arrayBuffer());
    const ar = { status: arRes.status, bytes, text: new TextDecoder().decode(bytes.slice(3)) };
    expect(ar.status).toBe(200);
    expect([...ar.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // the BOM: Excel reads the Arabic
    const lines = ar.text.split("\r\n");
    expect(lines[0]).toContain('"رقم الطلب";"التاريخ";"الساعة";"الحالة"');
    expect(lines).toHaveLength(4); // titles, 2 orders, totals
    expect(ar.text).toContain('"0554 65 07 18"');
    expect(ar.text).toContain("إنستغرام");
    expect(lines[3]).toContain("المجموع: 2 طلب");

    const fr = { text: (await (await app.raw("GET", "/orders.csv?lang=fr&source=facebook")).text()) };
    const frLines = fr.text.split("\r\n");
    expect(frLines[0]).toContain('"N° commande";"Date";"Heure";"Statut"');
    expect(frLines).toHaveLength(3); // titles, the Facebook order, totals
    expect(frLines[1]).toContain('"Facebook"');
  });
});
