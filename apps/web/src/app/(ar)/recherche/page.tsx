import type { Metadata } from "next";
import { SearchView } from "@/components/views/ShopViews";

export const metadata: Metadata = { title: "بحث" };

export default function Page() {
  return <SearchView />;
}
