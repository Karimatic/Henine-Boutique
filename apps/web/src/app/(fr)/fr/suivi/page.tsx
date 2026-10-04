import type { Metadata } from "next";
import { pageMeta } from "@/lib/metadata";
import { TrackView } from "@/components/views/OrderViews";

export const metadata: Metadata = pageMeta("fr", "/suivi", { title: "Suivi de commande" });

export default function Page() {
  return <TrackView />;
}
