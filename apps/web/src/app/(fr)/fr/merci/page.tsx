import type { Metadata } from "next";
import { ThankYouView } from "@/components/views/OrderViews";

export const metadata: Metadata = { title: "Merci !", robots: { index: false } };

export default function Page() {
  return <ThankYouView />;
}
