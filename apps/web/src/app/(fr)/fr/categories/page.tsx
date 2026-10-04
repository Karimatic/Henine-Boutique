import type { Metadata } from "next";
import { pageMeta } from "@/lib/metadata";
import { CategoriesView } from "@/components/views/ShopViews";

export const metadata: Metadata = pageMeta("fr", "/categories", { title: "Catégories" });

export default function Page() {
  return <CategoriesView />;
}
