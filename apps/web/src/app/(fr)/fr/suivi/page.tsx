import type { Metadata } from "next";
import { TrackView } from "@/components/views/OrderViews";

export const metadata: Metadata = { title: "Suivi de commande" };

export default function Page() {
  return <TrackView />;
}
