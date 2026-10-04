import type { Metadata } from "next";
import { pageMeta } from "@/lib/metadata";
import { BoutiqueView } from "@/components/views/BoutiqueView";

export const metadata: Metadata = pageMeta("ar", "/boutique", { title: "محلنا في دلس", description: "العنوان، أوقات العمل، الخريطة والاتجاهات إلى محل Henine Boutique في دلس، لقهاوي، بجانب المحكمة." });

export default function Page() {
  return <BoutiqueView />;
}
