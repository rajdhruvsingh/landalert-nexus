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
        // If credentials fail in demo mode, provide clear message
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

  const role = user?.user_metadata?.["role"] ?? (user ? "ddma_operator" : "public_observer");

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
      <DialogContent className="sm:max-w-[420px] bg-surface text-foreground border-border">
        <DialogHeader>
          <DialogTitle className="text-xl font-display uppercase tracking-wide">
            {user ? "Disaster Console Operator Profile" : "Console Authentication"}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {user
              ? "Your session grants authenticated access for emergency alert dispatch and field verification."
              : "Sign in with district disaster management credentials or access as an authorized observer."}
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
            <div className="rounded border border-border bg-secondary/30 p-3 font-mono text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Operator:</span>
                <span className="font-semibold text-foreground">{user.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Assigned Role:</span>
                <span className="uppercase text-primary font-bold">{role}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Session ID:</span>
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
          <form onSubmit={handleLogin} className="space-y-4 pt-2">
            <div className="grid gap-2">
              <Label
                htmlFor="emailInput"
                className="text-xs font-mono uppercase text-muted-foreground"
              >
                Email / Operator ID
              </Label>
              <Input
                id="emailInput"
                type="email"
                placeholder="ddma.operator@ner.gov.in"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="bg-secondary/40 border-border font-mono text-xs"
              />
            </div>

            <div className="grid gap-2">
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

            <DialogFooter className="mt-4 flex flex-col gap-2 sm:flex-col">
              <Button
                type="submit"
                size="sm"
                disabled={loading}
                className="w-full font-mono text-xs uppercase"
              >
                {loading ? "Authenticating…" : "Sign In to Console"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
