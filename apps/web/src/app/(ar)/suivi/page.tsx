import type { Metadata } from "next";
import { pageMeta } from "@/lib/metadata";
import { TrackView } from "@/components/views/OrderViews";

export const metadata: Metadata = pageMeta("ar", "/suivi", { title: "تتبع الطلب" });

export default function Page() {
  return <TrackView />;
}
