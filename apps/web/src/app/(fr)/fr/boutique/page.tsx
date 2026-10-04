import type { Metadata } from "next";
import { pageMeta } from "@/lib/metadata";
import { BoutiqueView } from "@/components/views/BoutiqueView";

export const metadata: Metadata = pageMeta("fr", "/boutique", { title: "Notre boutique à Dellys", description: "Adresse, horaires, plan et itinéraire de la boutique Henine à Dellys (Laqhaoui, à côté du tribunal)." });

export default function Page() {
  return <BoutiqueView />;
}
