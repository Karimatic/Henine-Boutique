/**
 * Transactional email (admin login codes, password resets, invitations).
 * Providers are plain HTTPS APIs, so no SDK is bundled:
 *  - "resend": resend.com (free 3,000/month; sending to anyone needs a verified domain)
 *  - "console" (default in development): nothing is sent; the code is logged and,
 *    on localhost only, shown on screen.
 */
import type { Env } from "../env";
import { isDev } from "../env";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailResult {
  delivered: boolean;
  provider: string;
  error?: string;
}

export function mailProvider(env: Env): "resend" | "console" {
  const p = (env.MAIL_PROVIDER ?? "").toLowerCase();
  if (p === "resend" && env.MAIL_API_KEY && env.MAIL_FROM) return p;
  return "console";
}

export async function sendMail(env: Env, msg: MailMessage): Promise<MailResult> {
  const provider = mailProvider(env);
  try {
    if (provider === "resend") {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.MAIL_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: env.MAIL_FROM, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
      });
      if (!res.ok) return { delivered: false, provider, error: `resend ${res.status}` };
      return { delivered: true, provider };
    }
    // console
    console.log(`[mail:console] to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
    return { delivered: isDev(env), provider, error: isDev(env) ? undefined : "no_mail_provider" };
  } catch (err) {
    return { delivered: false, provider, error: (err as Error).message };
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Simple branded layout that renders well in Gmail/Outlook on phones. */
export function mailLayout(title: string, paragraphs: string[], highlight?: string, cta?: { label: string; url: string }): string {
  const ps = paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.55">${esc(p)}</p>`).join("");
  const code = highlight
    ? `<p style="margin:18px 0;font-size:32px;letter-spacing:8px;font-weight:700;color:#57223f;text-align:center">${esc(highlight)}</p>`
    : "";
  const button = cta
    ? `<p style="text-align:center;margin:22px 0"><a href="${esc(cta.url)}" style="background:#6b2d52;color:#fbf7f3;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;display:inline-block">${esc(cta.label)}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#fbf7f3;font-family:Segoe UI,Roboto,Arial,sans-serif;color:#2a1a24">
<div style="max-width:480px;margin:0 auto;padding:28px 20px">
<p style="font-size:22px;color:#57223f;margin:0 0 18px">🌸 Henine Boutique</p>
<div style="background:#fff;border:1px solid #e8dcd3;border-radius:16px;padding:22px">
<h1 style="font-size:18px;margin:0 0 14px">${esc(title)}</h1>${ps}${code}${button}</div>
<p style="font-size:12px;color:#5b4652;margin-top:16px">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
</div></body></html>`;
}
