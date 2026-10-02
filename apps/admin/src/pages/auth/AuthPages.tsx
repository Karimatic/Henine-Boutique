/**
 * Login (email + password → emailed 6-digit code), invitation acceptance, password reset.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { auth, errorMessage } from "../../api";
import { Wordmark } from "../../brand";
import { derivePasswordKey, passwordProblems } from "../../lib/password";
import { Button, inputCls, TextField } from "../../ui";

function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-10">
      {/* soft brand shapes behind the card */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -start-24 -top-24 size-80 rounded-full bg-rose-300/40 blur-3xl" />
        <div className="absolute -bottom-32 -end-20 size-96 rounded-full bg-gold/25 blur-3xl" />
        <div className="absolute end-[12%] top-[14%] size-56 rounded-full bg-lavender/30 blur-3xl" />
        <div className="absolute start-1/2 top-1/2 size-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-plum-600/10" />
        <div className="absolute start-1/2 top-1/2 size-[46rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-plum-600/5" />
      </div>
      <div className="relative w-full max-w-md">
        <div className="rounded-xl border border-line/70 bg-white/90 p-6 shadow-[0_10px_40px_-12px_rgb(157_23_77/0.25)] backdrop-blur sm:p-8">
          <Wordmark size="lg" subtitle="Administration" className="mb-7" />
          <h1 className="font-display text-2xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-ink-soft">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        <p className="mt-6 text-center text-xs text-ink-soft">Administration privée · connexion sécurisée</p>
      </div>
    </div>
  );
}

function DevCode({ code }: { code?: string }) {
  if (!code) return null;
  return (
    <p className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      🧪 Mode développement (aucun email réel) : votre code est <b className="font-mono tracking-widest">{code}</b>
    </p>
  );
}

/** 6 boxes, paste-friendly, numeric keyboard, auto-submit when complete. */
function CodeInput({ onComplete, disabled }: { onComplete: (code: string) => void; disabled?: boolean }) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <input
      ref={ref}
      className={`${inputCls} h-14 text-center font-mono text-2xl tracking-[0.6em]`}
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      placeholder="••••••"
      disabled={disabled}
      value={value}
      aria-label="Code reçu par email"
      onChange={(e) => {
        const v = e.target.value.replace(/\D/g, "").slice(0, 6);
        setValue(v);
        if (v.length === 6) onComplete(v);
      }}
    />
  );
}

function nextUrl(): string {
  const next = new URLSearchParams(location.search).get("next") ?? "/";
  return `/admin${next.startsWith("/") && !next.startsWith("//") ? next : "/"}`;
}

/* ───────── Login ───────── */

export function LoginPage() {
  const [step, setStep] = useState<"password" | "code">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [challenge, setChallenge] = useState<{ id: string; hint: string; dev?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const key = await derivePasswordKey(email, password);
      const res = await auth<{ challenge: string; emailHint: string; devCode?: string }>("/login", { email: email.trim(), key, remember });
      setChallenge({ id: res.challenge, hint: res.emailHint, dev: res.devCode });
      setStep("code");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(code: string) {
    setError(null);
    setBusy(true);
    try {
      await auth("/verify", { challenge: challenge!.id, code });
      location.href = nextUrl();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (step === "code" && challenge) {
    return (
      <AuthLayout title="Vérification par email" subtitle={<>Nous avons envoyé un code à 6 chiffres à <b>{challenge.hint}</b>.</>}>
        <DevCode code={challenge.dev} />
        <CodeInput onComplete={submitCode} disabled={busy} />
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        <div className="mt-4 flex justify-between text-sm">
          <button type="button" className="font-semibold text-plum-600" onClick={() => { setStep("password"); setError(null); }}>
            ← Retour
          </button>
          <span className="text-ink-soft">Valable 10 minutes</span>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Connexion" subtitle="Espace réservé à l'équipe Henine.">
      <form onSubmit={submitPassword} className="space-y-4">
        <TextField label="Email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField label="Mot de passe" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-plum-600" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Rester connectée 30 jours sur cet appareil
        </label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          {busy ? "Vérification…" : "Continuer"}
        </Button>
        <a href="/admin/mot-de-passe-oublie" className="block text-center text-sm font-semibold text-plum-600">
          Mot de passe oublié ?
        </a>
      </form>
    </AuthLayout>
  );
}

/* ───────── Choose a password (invitation or reset) ───────── */

function NewPasswordForm({ email, submitLabel, onKey }: { email: string; submitLabel: string; onKey: (key: string) => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = password ? passwordProblems(password, email) : null;
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (problem) return setError(problem);
        if (password !== confirm) return setError("Les deux mots de passe ne correspondent pas.");
        setBusy(true);
        try {
          await onKey(await derivePasswordKey(email, password));
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <TextField label="Nouveau mot de passe" hint="10 caractères min." type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={problem} />
      <TextField label="Confirmer" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <Button type="submit" variant="primary" loading={busy} className="w-full">
        {submitLabel}
      </Button>
    </form>
  );
}

export function InvitationPage() {
  const token = new URLSearchParams(location.search).get("token") ?? "";
  const [info, setInfo] = useState<{ email: string; name: string; role: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<{ id: string; dev?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    auth<{ email: string; name: string; role: string }>(`/invite/${encodeURIComponent(token)}`).then(setInfo, (err) => setError(errorMessage(err)));
  }, [token]);

  if (error && !info) return <AuthLayout title="Invitation">{<p className="text-sm text-red-700">{error}</p>}</AuthLayout>;
  if (!info) return <AuthLayout title="Invitation"><div className="skeleton h-24" /></AuthLayout>;
  if (challenge) {
    return (
      <AuthLayout title="Confirmez votre email" subtitle={<>Code envoyé à <b>{info.email}</b>.</>}>
        <DevCode code={challenge.dev} />
        <CodeInput
          disabled={busy}
          onComplete={async (code) => {
            setBusy(true);
            setError(null);
            try {
              await auth("/invite/verify", { token, challenge: challenge.id, code });
              location.href = "/admin/";
            } catch (err) {
              setError(errorMessage(err));
              setBusy(false);
            }
          }}
        />
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title={`Bienvenue ${info.name} 🌸`} subtitle={<>Vous rejoignez l'équipe en tant que <b>{info.role}</b>. Choisissez votre mot de passe pour <b>{info.email}</b>.</>}>
      <NewPasswordForm
        email={info.email}
        submitLabel="Activer mon compte"
        onKey={async (key) => {
          const res = await auth<{ challenge: string; devCode?: string }>("/invite/accept", { token, key });
          setChallenge({ id: res.challenge, dev: res.devCode });
        }}
      />
    </AuthLayout>
  );
}

export function ForgotPage() {
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "password" | "code">("email");
  const [challenge, setChallenge] = useState<{ id: string; dev?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (step === "email") {
    return (
      <AuthLayout title="Mot de passe oublié" subtitle="Indiquez votre email d'équipe.">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (email.includes("@")) setStep("password"); }}>
          <TextField label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Button type="submit" variant="primary" className="w-full">Continuer</Button>
          <a href="/admin/connexion" className="block text-center text-sm font-semibold text-plum-600">← Connexion</a>
        </form>
      </AuthLayout>
    );
  }
  if (step === "password") {
    return (
      <AuthLayout title="Nouveau mot de passe" subtitle="Un code de confirmation sera envoyé à votre email.">
        <NewPasswordForm
          email={email}
          submitLabel="Recevoir le code"
          onKey={async (key) => {
            const res = await auth<{ challenge: string; devCode?: string }>("/forgot", { email: email.trim(), key });
            setChallenge({ id: res.challenge, dev: res.devCode });
            setStep("code");
          }}
        />
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Code de confirmation" subtitle="Si ce compte existe, un code vient d'être envoyé.">
      <DevCode code={challenge?.dev} />
      <CodeInput
        disabled={busy}
        onComplete={async (code) => {
          setBusy(true);
          setError(null);
          try {
            await auth("/reset", { challenge: challenge!.id, code });
            location.href = "/admin/";
          } catch (err) {
            setError(errorMessage(err));
            setBusy(false);
          }
        }}
      />
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
    </AuthLayout>
  );
}
