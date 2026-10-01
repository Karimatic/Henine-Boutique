import type { Metadata } from "next";
import { ContactView } from "@/components/views/InfoViews";

export const metadata: Metadata = { title: "Contact" };

export default function Page() {
  return <ContactView />;
}
