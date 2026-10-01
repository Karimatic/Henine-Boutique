import type { Metadata } from "next";
import { CollectionView } from "@/components/views/DropViews";

export const metadata: Metadata = { title: "تشكيلة" };

// One static shell ("_"); the Worker serves it for every slug (with preview tags) and the page loads its data from /api.
export const dynamicParams = false;
export function generateStaticParams() {
  return [{ slug: "_" }];
}

export default function Page() {
  return <CollectionView />;
}
