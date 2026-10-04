import type { Metadata } from "next";
import { pageMeta } from "@/lib/metadata";
import { CartView } from "@/components/views/ShopViews";

export const metadata: Metadata = pageMeta("fr", "/panier", { title: "Mon panier", robots: { index: false } });

export default function Page() {
  return <CartView />;
}
