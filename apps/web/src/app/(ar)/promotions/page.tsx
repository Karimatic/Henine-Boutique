import type { Metadata } from "next";
import { pageMeta } from "@/lib/metadata";
import { PromotionsView } from "@/components/views/ShopViews";

export const metadata: Metadata = pageMeta("ar", "/promotions", { title: "التخفيضات", description: "قطع بأسعار مخفضة ما دامت متوفرة: فساتين، بيجامات، لانجري… الدفع عند الاستلام والتوصيل إلى 69 ولاية." });

export default function Page() {
  return <PromotionsView />;
}
