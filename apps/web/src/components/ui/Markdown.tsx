import { Fragment } from "react";
import { parseMarkdown, type Inline } from "@henine/shared";

/** Renders admin-written markdown as React elements (no HTML injection possible). */
function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) =>
        n.t === "b" ? (
          <strong key={i} className="font-semibold text-ink">{n.v}</strong>
        ) : n.t === "i" ? (
          <em key={i}>{n.v}</em>
        ) : n.t === "a" ? (
          <a key={i} href={n.href} className="font-medium text-plum-600 underline underline-offset-2" rel={n.href.startsWith("http") ? "noopener noreferrer" : undefined}>
            {n.v}
          </a>
        ) : (
          <Fragment key={i}>{n.v}</Fragment>
        ),
      )}
    </>
  );
}

export function Markdown({ source, className = "" }: { source: string; className?: string }) {
  return (
    <div className={`space-y-3 text-sm leading-relaxed text-ink-soft ${className}`}>
      {parseMarkdown(source).map((b, i) =>
        b.t === "h" ? (
          b.level === 1 ? (
            <h2 key={i} className="heading-display pt-2 text-2xl text-ink"><Inlines nodes={b.content} /></h2>
          ) : (
            <h3 key={i} className="pt-2 text-base font-semibold text-ink"><Inlines nodes={b.content} /></h3>
          )
        ) : b.t === "ul" ? (
          <ul key={i} className="list-disc space-y-1 ps-5">
            {b.items.map((item, j) => (
              <li key={j}><Inlines nodes={item} /></li>
            ))}
          </ul>
        ) : (
          <p key={i}><Inlines nodes={b.content} /></p>
        ),
      )}
    </div>
  );
}
