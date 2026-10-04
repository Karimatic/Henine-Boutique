import type { Metadata } from "next";
import { pageMeta } from "@/lib/metadata";
import { FavoritesView } from "@/components/views/ShopViews";

export const metadata: Metadata = pageMeta("ar", "/favoris", { title: "مفضلتي", robots: { index: false } });

export default function Page() {
  return <FavoritesView />;
}
