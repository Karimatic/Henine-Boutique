import type { Metadata } from "next";
import { BoutiqueView } from "@/components/views/BoutiqueView";

export const metadata: Metadata = { title: "Notre boutique à Boumerdès", description: "Adresse, horaires, plan et itinéraire de la boutique Henine à Boumerdès." };

export default function Page() {
  return <BoutiqueView />;
}
