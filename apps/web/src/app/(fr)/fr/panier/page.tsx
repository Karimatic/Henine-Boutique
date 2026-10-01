import type { Metadata } from "next";
import { CartView } from "@/components/views/ShopViews";

export const metadata: Metadata = { title: "Mon panier", robots: { index: false } };

export default function Page() {
  return <CartView />;
}
