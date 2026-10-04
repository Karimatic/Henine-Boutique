import type { Metadata } from "next";
import { pageMeta } from "@/lib/metadata";
import { CartView } from "@/components/views/ShopViews";

export const metadata: Metadata = pageMeta("ar", "/panier", { title: "سلتي", robots: { index: false } });

export default function Page() {
  return <CartView />;
}
