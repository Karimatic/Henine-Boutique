import type { Metadata } from "next";
import { pageMeta } from "@/lib/metadata";
import { SearchView } from "@/components/views/ShopViews";

export const metadata: Metadata = pageMeta("ar", "/recherche", { title: "بحث" });

export default function Page() {
  return <SearchView />;
}
