import type { Metadata } from "next";
import { PageView } from "@/components/views/InfoViews";

export const metadata: Metadata = { title: "Informations" };

// One static shell ("_"); the Worker serves it for every slug and the page loads its data from /api.
export const dynamicParams = false;
export function generateStaticParams() {
  return [{ slug: "_" }];
}

export default function Page() {
  return <PageView />;
}
