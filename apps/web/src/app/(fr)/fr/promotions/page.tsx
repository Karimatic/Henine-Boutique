import type { Metadata } from "next";
import { pageMeta } from "@/lib/metadata";
import { PromotionsView } from "@/components/views/ShopViews";

export const metadata: Metadata = pageMeta("fr", "/promotions", { title: "Promotions", description: "Des pièces à prix cassés tant qu'il en reste : robes, pyjamas, lingerie… Paiement à la livraison, 69 wilayas." });

export default function Page() {
  return <PromotionsView />;
}
