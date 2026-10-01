import type { Metadata } from "next";
import { LinksView } from "@/components/views/InfoViews";

export const metadata: Metadata = { title: "Nos liens" };

export default function Page() {
  return <LinksView />;
}
