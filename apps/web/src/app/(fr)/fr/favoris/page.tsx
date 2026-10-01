import type { Metadata } from "next";
import { FavoritesView } from "@/components/views/ShopViews";

export const metadata: Metadata = { title: "Mes favoris", robots: { index: false } };

export default function Page() {
  return <FavoritesView />;
}
