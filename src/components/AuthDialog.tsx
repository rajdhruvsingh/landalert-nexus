import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

import { getUserAuthorizationState } from "@/lib/auth-domains";

export function AuthDialog({ trigger }: { trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    // Check active session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        setError(authError.message);
      } else {
        setUser(data.user);
        setInfo("Signed in successfully.");
        setTimeout(() => setOpen(false), 1200);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setLoading(true);
    setError(null);
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        ...(typeof window !== "undefined" ? { options: { redirectTo: window.location.origin } } : {}),
      });
      if (oauthError) {
        console.error("[AuthDialog] Supabase Google OAuth error:", oauthError);
        const msg = (oauthError.message || "").toLowerCase();
        if (
          msg.includes("provider") ||
          msg.includes("validation_failed") ||
          msg.includes("unsupported") ||
          msg.includes("not enabled")
        ) {
          setError(
            "Google sign-in is currently unavailable. Please use your official email/password sign-in or try again later.",
          );
        } else {
          setError(
            oauthError.message ||
              "Google sign-in is currently unavailable. Please use your official email/password sign-in or try again later.",
          );
        }
      }
    } catch (err) {
      console.error("[AuthDialog] Google OAuth exception:", err);
      setError(
        "Google sign-in is currently unavailable. Please use your official email/password sign-in or try again later.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOut() {
    setLoading(true);
    try {
      await supabase.auth.signOut();
      setUser(null);
      setInfo("Signed out successfully.");
      setTimeout(() => setOpen(false), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign out failed");
    } finally {
      setLoading(false);
    }
  }

  const authState = getUserAuthorizationState(user);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            className="flex items-center gap-1.5 rounded px-2.5 py-1 font-mono text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <span
              className={`h-2 w-2 rounded-full ${user ? "bg-primary" : "bg-muted-foreground/60"}`}
            />
            <span>{user ? user.email?.split("@")[0] : "Sign in"}</span>
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[440px] bg-surface text-foreground border-border">
        <DialogHeader>
          <DialogTitle className="text-xl font-display uppercase tracking-wide">
            {user ? "Disaster Console Operator Profile" : "Console Authentication"}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {user
              ? "Your session grants authenticated access according to your verified official role."
              : "Sign in with government institutional credentials or authenticate as an observer."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-xs font-mono text-destructive">
            {error}
          </div>
        )}

        {info && (
          <div className="rounded border border-emerald-500/50 bg-emerald-500/10 p-3 text-xs font-mono text-emerald-400">
            {info}
          </div>
        )}

        {user ? (
          <div className="space-y-4 pt-2">
            <div className="rounded border border-border bg-secondary/30 p-3 font-mono text-xs space-y-2">
              <div className="flex justify-between items-start gap-2">
                <span className="text-muted-foreground">Operator:</span>
                <span className="font-semibold text-foreground text-right break-all">{user.email}</span>
              </div>
              <div className="flex justify-between items-center gap-2">
                <span className="text-muted-foreground">Authorization State:</span>
                <span
                  className={`rounded px-2 py-0.5 text-[0.7rem] font-bold uppercase tracking-wider ${
                    authState.tone === "primary"
                      ? "bg-primary/20 text-primary border border-primary/40"
                      : authState.tone === "success"
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                        : authState.tone === "warning"
                          ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                          : "bg-secondary text-muted-foreground border border-border"
                  }`}
                >
                  {authState.badge}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Role:</span>
                <span className="uppercase font-semibold text-foreground">{authState.role}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Status:</span>
                <span className="text-[0.7rem] text-muted-foreground">{authState.status}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">User ID:</span>
                <span className="text-[0.68rem] text-muted-foreground truncate max-w-[180px]">
                  {user.id}
                </span>
              </div>
            </div>

            <DialogFooter className="mt-4">
              <Button
                variant="destructive"
                size="sm"
                onClick={handleSignOut}
                disabled={loading}
                className="w-full font-mono text-xs uppercase"
              >
                {loading ? "Signing out…" : "Sign Out"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            {/* Sign in with Google */}
            <div className="space-y-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={handleGoogleSignIn}
                className="w-full flex items-center justify-center gap-2 border-border bg-secondary/20 hover:bg-secondary/50 font-mono text-xs uppercase tracking-wider py-5 cursor-pointer"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.16 0 9.97 0 12s.45 3.84 1.25 5.42l4.03-3.15z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                  />
                </svg>
                <span>Sign in with Google</span>
              </Button>
              <p className="text-[0.68rem] text-muted-foreground text-center font-mono leading-tight">
                Google login authenticates standard observer accounts. Official disaster authorities must verify institutional credentials.
              </p>
            </div>

            <div className="relative flex items-center justify-center">
              <div className="w-full border-t border-border"></div>
              <span className="relative bg-surface px-2 text-[0.65rem] font-mono uppercase tracking-widest text-muted-foreground">
                Or Official Credentials
              </span>
            </div>

            <form onSubmit={handleLogin} className="space-y-3.5">
              <div className="grid gap-1.5">
                <Label
                  htmlFor="emailInput"
                  className="text-xs font-mono uppercase text-muted-foreground"
                >
                  Official Institutional Email
                </Label>
                <Input
                  id="emailInput"
                  type="email"
                  placeholder="officer@gsi.gov.in / ddma@assam.gov.in"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="bg-secondary/40 border-border font-mono text-xs"
                />
              </div>

              <div className="grid gap-1.5">
                <Label
                  htmlFor="passwordInput"
                  className="text-xs font-mono uppercase text-muted-foreground"
                >
                  Password
                </Label>
                <Input
                  id="passwordInput"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="bg-secondary/40 border-border font-mono text-xs"
                />
              </div>

              {/* Institutional Domain Guidance */}
              <div className="rounded border border-primary/20 bg-primary/5 p-2.5 text-[0.7rem] font-mono text-muted-foreground space-y-1">
                <div className="font-semibold text-primary uppercase tracking-wide">
                  Official Verification Notice
                </div>
                <p>
                  Institutional emails (@gsi.gov.in, @nesac.gov.in, @ndma.gov.in, @nic.in, @*.gov.in)
                  are eligible for official verification. Google and public logins default to PUBLIC_USER.
                  Emergency dispatch requires verified DISPATCHER authorization.
                </p>
              </div>

              <DialogFooter className="mt-4 flex flex-col gap-2 sm:flex-col">
                <Button
                  type="submit"
                  size="sm"
                  disabled={loading}
                  className="w-full font-mono text-xs uppercase tracking-wider"
                >
                  {loading ? "Authenticating…" : "Sign In with Credentials"}
                </Button>
              </DialogFooter>
            </form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
