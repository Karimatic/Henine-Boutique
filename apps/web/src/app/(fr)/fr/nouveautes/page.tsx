import type { Metadata } from "next";
import { pageMeta } from "@/lib/metadata";
import { NewArrivalsView } from "@/components/views/DropViews";

export const metadata: Metadata = pageMeta("fr", "/nouveautes", { title: "Nouveautés" });

export default function Page() {
  return <NewArrivalsView />;
}
