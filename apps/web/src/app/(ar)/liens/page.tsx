import type { Metadata } from "next";
import { LinksView } from "@/components/views/InfoViews";

export const metadata: Metadata = { title: "روابطنا" };

export default function Page() {
  return <LinksView />;
}
