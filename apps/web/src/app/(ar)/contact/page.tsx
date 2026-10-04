import type { Metadata } from "next";
import { pageMeta } from "@/lib/metadata";
import { ContactView } from "@/components/views/InfoViews";

export const metadata: Metadata = pageMeta("ar", "/contact", { title: "تواصلي معنا" });

export default function Page() {
  return <ContactView />;
}
