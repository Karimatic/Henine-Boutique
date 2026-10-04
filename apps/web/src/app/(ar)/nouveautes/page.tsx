import type { Metadata } from "next";
import { pageMeta } from "@/lib/metadata";
import { NewArrivalsView } from "@/components/views/DropViews";

export const metadata: Metadata = pageMeta("ar", "/nouveautes", { title: "وصل حديثا" });

export default function Page() {
  return <NewArrivalsView />;
}
