import type { Metadata } from "next";
import { pageMeta } from "@/lib/metadata";
import { LinksView } from "@/components/views/InfoViews";

export const metadata: Metadata = pageMeta("ar", "/liens", { title: "روابطنا" });

export default function Page() {
  return <LinksView />;
}
