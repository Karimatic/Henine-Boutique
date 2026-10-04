import type { Metadata } from "next";
import { pageMeta } from "@/lib/metadata";
import { HomePage } from "@/components/home/HomePage";

export const metadata: Metadata = pageMeta("fr", "/", {});

export default function Page() {
  return <HomePage />;
}
