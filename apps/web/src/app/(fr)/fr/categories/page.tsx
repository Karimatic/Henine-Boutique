import type { Metadata } from "next";
import { CategoriesView } from "@/components/views/ShopViews";

export const metadata: Metadata = { title: "Catégories" };

export default function Page() {
  return <CategoriesView />;
}
