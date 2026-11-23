"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ValburyMark } from "@/components/valbury-mark";
import { postJson } from "@/lib/use-api";

export default function LoginPage() {
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/auth", { password });
      // Hard navigation so the Shell re-mounts with fresh auth state.
      // router.push + router.refresh leaves stale useApi cache.
      const redirect = searchParams.get("redirect") || "/";
      window.location.href = redirect;
    } catch {
      setError("Wrong password");
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-80">
        <CardContent className="pt-6">
          <form onSubmit={submit} className="space-y-3">
            <div className="text-center">
              <ValburyMark className="mx-auto mb-2 h-6 w-7" />
              <h1 className="text-sm font-semibold">Trade Journal</h1>
            </div>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              autoFocus
              disabled={busy}
            />
            {error && <p className="text-center text-xs text-loss">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Signing in…" : "Unlock"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
