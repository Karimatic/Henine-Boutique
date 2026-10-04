import type { Metadata } from "next";
import { pageMeta } from "@/lib/metadata";
import { ThankYouView } from "@/components/views/OrderViews";

export const metadata: Metadata = pageMeta("fr", "/merci", { title: "Merci !", robots: { index: false } });

export default function Page() {
  return <ThankYouView />;
}
