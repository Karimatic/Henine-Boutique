import type { Metadata } from "next";
import { NewArrivalsView } from "@/components/views/DropViews";

export const metadata: Metadata = { title: "Nouveautés" };

export default function Page() {
  return <NewArrivalsView />;
}
