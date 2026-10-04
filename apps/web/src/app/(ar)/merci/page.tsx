import type { Metadata } from "next";
import { pageMeta } from "@/lib/metadata";
import { ThankYouView } from "@/components/views/OrderViews";

export const metadata: Metadata = pageMeta("ar", "/merci", { title: "شكرا!", robots: { index: false } });

export default function Page() {
  return <ThankYouView />;
}
