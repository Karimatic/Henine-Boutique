import type { Metadata } from "next";
import { pageMeta } from "@/lib/metadata";
import { ContactView } from "@/components/views/InfoViews";

export const metadata: Metadata = pageMeta("fr", "/contact", { title: "Contact" });

export default function Page() {
  return <ContactView />;
}
