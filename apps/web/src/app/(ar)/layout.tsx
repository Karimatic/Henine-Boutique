import type { Metadata, Viewport } from "next";
import { RootDocument } from "@/components/layout/RootDocument";
import { ArabicProvider } from "@/lib/locale-ar";
import { buildMetadata, viewport as sharedViewport } from "@/lib/metadata";

export const metadata: Metadata = buildMetadata("ar");
export const viewport: Viewport = sharedViewport;

export default function ArabicRootLayout({ children }: { children: React.ReactNode }) {
  return <RootDocument locale="ar" Provider={ArabicProvider}>{children}</RootDocument>;
}
