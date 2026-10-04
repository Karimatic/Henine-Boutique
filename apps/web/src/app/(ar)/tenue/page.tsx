import type { Metadata } from "next";
import { pageMeta } from "@/lib/metadata";
import { OutfitView } from "@/components/views/OutfitView";

export const metadata: Metadata = pageMeta("ar", "/tenue", { title: "نسّقي إطلالتك" });

export default function Page() {
  return <OutfitView />;
}
