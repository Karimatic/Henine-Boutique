import type { Metadata, Viewport } from "next";
import { RootDocument } from "@/components/layout/RootDocument";
import { buildMetadata, viewport as sharedViewport } from "@/lib/metadata";

export const metadata: Metadata = buildMetadata("fr");
export const viewport: Viewport = sharedViewport;

export default function FrenchRootLayout({ children }: { children: React.ReactNode }) {
  return <RootDocument locale="fr">{children}</RootDocument>;
}
