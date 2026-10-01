import type { Metadata } from "next";
import { CheckoutView } from "@/components/views/ShopViews";

export const metadata: Metadata = { title: "إتمام الطلب", robots: { index: false } };

export default function Page() {
  return <CheckoutView />;
}
