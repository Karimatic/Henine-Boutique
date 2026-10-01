import type { Metadata } from "next";
import { CategoryView } from "@/components/views/ShopViews";

export const metadata: Metadata = { title: "قسم" };

// One static shell ("_"); the Worker serves it for every slug and the page loads its data from /api.
export const dynamicParams = false;
export function generateStaticParams() {
  return [{ slug: "_" }];
}

export default function Page() {
  return <CategoryView />;
}
