export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: unknown,
  ) {
    super(code);
  }
}

function onUnauthenticated() {
  const here = location.pathname.replace(/^\/admin/, "") + location.search;
  if (!location.pathname.startsWith("/admin/connexion")) {
    location.href = `/admin/connexion?next=${encodeURIComponent(here || "/")}`;
  }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      credentials: "same-origin",
      headers: init.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init.headers },
    });
  } catch {
    throw new ApiError(0, "network");
  }
  const body = (await res.json().catch(() => null)) as { error?: string; details?: unknown } | null;
  if (!res.ok) {
    if (res.status === 401 && url.startsWith("/api/admin")) onUnauthenticated();
    throw new ApiError(res.status, body?.error ?? "request_failed", body?.details);
  }
  return body as T;
}

/** Admin API (session cookie). */
export function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  return request<T>(`/api/admin${path}`, init);
}
export const post = <T,>(path: string, data?: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(data ?? {}) });
export const put = <T,>(path: string, data: unknown) => api<T>(path, { method: "PUT", body: JSON.stringify(data) });
export const patch = <T,>(path: string, data: unknown) => api<T>(path, { method: "PATCH", body: JSON.stringify(data) });
export const del = <T,>(path: string) => api<T>(path, { method: "DELETE" });
export const upload = <T,>(path: string, form: FormData) => api<T>(path, { method: "POST", body: form });

/** Public auth endpoints (login, invitations, reset). */
export function auth<T>(path: string, data?: unknown): Promise<T> {
  return request<T>(`/api/auth${path}`, data === undefined ? {} : { method: "POST", body: JSON.stringify(data) });
}

export interface Me {
  id: number;
  email: string;
  name: string;
  role: string;
  roleName: string;
  permissions: string[];
  dev: boolean;
  telegramConfigured: boolean;
}

const MESSAGES: Record<string, string> = {
  network: "Connexion impossible. Vérifiez votre internet.",
  forbidden: "Votre rôle ne permet pas cette action.",
  validation_failed: "Certains champs sont invalides.",
  invalid_credentials: "Email ou mot de passe incorrect.",
  account_locked: "Trop d'essais : compte bloqué 15 minutes.",
  code_invalid: "Code incorrect.",
  code_expired: "Code expiré. Recommencez.",
  too_many_attempts: "Trop d'essais. Recommencez la connexion.",
  rate_limited: "Trop de tentatives, patientez une minute.",
  invite_invalid: "Lien d'invitation invalide ou expiré.",
  mail_unavailable: "L'envoi d'emails n'est pas configuré (Système → Comptes).",
  slug_taken: "Cette adresse (slug) est déjà utilisée.",
  sku_taken: "Ce SKU est déjà utilisé.",
  stock_below_reserved: "Impossible : du stock est déjà réservé par des commandes.",
  stock_problem: "Stock insuffisant pour un article.",
  stock_insufficient: "Stock insuffisant pour rouvrir la commande.",
  invalid_transition: "Ce changement de statut n'est pas possible.",
  status_changed_meanwhile: "La commande a changé entre-temps. Rechargez.",
  code_taken: "Ce code existe déjà.",
  category_not_empty: "Cette catégorie contient des produits.",
  email_taken: "Cet email est déjà dans l'équipe.",
  last_owner: "Il faut garder au moins une propriétaire active.",
  cannot_demote_self: "Vous ne pouvez pas modifier votre propre rôle.",
  wrong_password: "Mot de passe actuel incorrect.",
  telegram_token_rejected: "Telegram a refusé ce token.",
  telegram_token_missing: "Enregistrez d'abord le token du bot.",
  telegram_test_failed: "Échec de l'envoi : vérifiez le groupe choisi et que le bot y est membre.",
  https_required: "Nécessite l'adresse https publique du site (après déploiement).",
  delivery_unavailable: "Livraison indisponible pour cette wilaya / ce mode.",
  coupon_invalid: "Code promo invalide.",
  limit_below_used: "La limite est inférieure au nombre d'utilisations.",
  points_negative: "Le solde de points deviendrait négatif.",
  file_too_large: "Photo trop lourde.",
  unsupported_image: "Format de photo non supporté.",
  percent_over_100: "Un pourcentage ne peut pas dépasser 100.",
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "validation_failed" && err.details && typeof err.details === "object") {
      const first = Object.entries(err.details as Record<string, string>)[0];
      if (first) return `${MESSAGES.validation_failed} (${first[0]})`;
    }
    return MESSAGES[err.code] ?? `Erreur (${err.code})`;
  }
  return "Une erreur est survenue.";
}
