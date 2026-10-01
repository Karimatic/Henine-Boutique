import type { Metadata } from "next";
import { ProductView } from "@/components/product/ProductView";

export const metadata: Metadata = { title: "Produit" };

// One static shell ("_"); the Worker serves it for every slug and the page loads its data from /api.
export const dynamicParams = false;
export function generateStaticParams() {
  return [{ slug: "_" }];
}

export default function Page() {
  return <ProductView />;
}
