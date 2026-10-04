import type { Metadata } from "next";
import { pageMeta } from "@/lib/metadata";
import { CheckoutView } from "@/components/views/ShopViews";

export const metadata: Metadata = pageMeta("fr", "/commande", { title: "Commande", robots: { index: false } });

export default function Page() {
  return <CheckoutView />;
}
