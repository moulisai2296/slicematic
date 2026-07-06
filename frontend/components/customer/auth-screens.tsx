"use client";

import { Loader2, Pizza } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { login, signup } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";

/**
 * Customer sign-in / sign-up, shown by the customer AuthGate inside the phone
 * frame. Phone + 6-digit PIN (see CLAUDE.md auth model). All rules are
 * re-checked server-side — the inline checks only give faster feedback.
 */

type Mode = "signin" | "signup";

export function CustomerAuthScreens() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phoneOk = /^[6-9]\d{9}$/.test(phone.trim());
  const pinOk = /^\d{6}$/.test(pin);
  const nameOk = /^[A-Za-z ]{2,40}$/.test(name.trim());
  const canSubmit =
    !busy &&
    phoneOk &&
    pinOk &&
    (mode === "signin" || (nameOk && confirmPin === pin));

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setPin("");
    setConfirmPin("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === "signin"
          ? await login("user", phone.trim(), pin)
          : await signup({
              name: name.trim(),
              phone: phone.trim(),
              pin,
              confirm_pin: confirmPin,
            });
      if (res.ok && res.token && res.user) {
        setAuth(res.token, res.user);
      } else {
        const first = res.errors ? Object.values(res.errors)[0] : null;
        setError(first ?? "Something went wrong. Please try again.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="slick-scroll flex h-full flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-10">
        {/* Brand */}
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <Pizza className="size-7" />
          </span>
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-tight">
              SliceMatic
            </h1>
            <p className="text-sm text-muted-foreground">
              {mode === "signin"
                ? "Sign in to order your pizza"
                : "Create your account in seconds"}
            </p>
          </div>
        </div>

        {/* Mode toggle */}
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface-2 p-1">
          {(["signin", "signup"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              aria-pressed={mode === m}
              className={
                mode === m
                  ? "rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
                  : "cursor-pointer rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
              }
            >
              {m === "signin" ? "Sign in" : "Sign up"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-4">
          {mode === "signup" && (
            <Field label="Your name" htmlFor="auth-name">
              <Input
                id="auth-name"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Aarav Sharma"
                aria-invalid={name.length > 0 && !nameOk}
              />
              {name.length > 0 && !nameOk && (
                <Hint>Letters and spaces only, 2–40 characters.</Hint>
              )}
            </Field>
          )}

          <Field label="Phone number" htmlFor="auth-phone">
            <Input
              id="auth-phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              maxLength={10}
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              placeholder="10-digit mobile number"
              aria-invalid={phone.length > 0 && !phoneOk}
            />
            {phone.length > 0 && !phoneOk && (
              <Hint>Enter a 10-digit number starting 6–9.</Hint>
            )}
          </Field>

          <Field
            label={mode === "signin" ? "Password" : "Choose a Password"}
            htmlFor="auth-pin"
          >
            <Input
              id="auth-pin"
              type="password"
              inputMode="numeric"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="••••••"
              aria-invalid={pin.length > 0 && !pinOk}
            />
          </Field>

          {mode === "signup" && (
            <Field label="Confirm Password" htmlFor="auth-pin2">
              <Input
                id="auth-pin2"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={6}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
                placeholder="••••••"
                aria-invalid={confirmPin.length > 0 && confirmPin !== pin}
              />
              {confirmPin.length > 0 && confirmPin !== pin && (
                <Hint>Passwords don&apos;t match.</Hint>
              )}
            </Field>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          <Button type="submit" size="lg" className="w-full" disabled={!canSubmit}>
            {busy && <Loader2 className="animate-spin" />}
            {mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Forgot your PIN? Contact the store — self-service reset is coming later.
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-xs font-medium text-muted-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-xs text-destructive">{children}</p>;
}
