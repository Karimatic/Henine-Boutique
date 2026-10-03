import type { Metadata } from "next";
import { OutfitView } from "@/components/views/OutfitView";

export const metadata: Metadata = { title: "Composez votre tenue" };

export default function Page() {
  return <OutfitView />;
}
