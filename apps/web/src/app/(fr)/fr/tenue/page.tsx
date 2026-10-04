import type { Metadata } from "next";
import { pageMeta } from "@/lib/metadata";
import { OutfitView } from "@/components/views/OutfitView";

export const metadata: Metadata = pageMeta("fr", "/tenue", { title: "Composez votre tenue" });

export default function Page() {
  return <OutfitView />;
}
