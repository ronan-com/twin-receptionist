import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { BrandMark } from "@/components/app/BrandMark";
import { authApi, homeOf } from "@/lib/api/auth";
import { sessionQuery } from "@/lib/app/workspace";
import { PRODUCT } from "@/lib/app/product";

// The one-time link from the setup wizard's done screen: /welcome?t=<token>. It signs the owner in
// (server/accounts.ts firstLogin) and goes straight to the dashboard. Used or expired: sign in as usual.
export const Route = createFileRoute("/welcome")({
  validateSearch: (search: Record<string, unknown>): { t?: string } => ({ t: typeof search.t === "string" ? search.t : undefined }),
  head: () => ({ meta: [{ title: `Welcome — ${PRODUCT}` }, { name: "robots", content: "noindex" }] }),
  component: WelcomePage,
});

function WelcomePage() {
  const { t } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        // Already signed in (a second click on the link, or the same browser): no need to burn the link.
        const now = await queryClient.fetchQuery({ ...sessionQuery(), staleTime: 0 });
        if (now.signedIn) return void navigate({ to: homeOf(now), replace: true });
        if (!t) throw new Error("This sign-in link isn't complete. Sign in with your email instead.");
        await authApi.welcome(t);
        queryClient.clear();
        const s = await queryClient.fetchQuery(sessionQuery());
        navigate({ to: homeOf(s), replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    })();
  }, [t, navigate, queryClient]);

  return (
    <div className="flex min-h-screen flex-col bg-canvas-2 px-4 py-8 sm:px-5">
      <BrandMark to="/login" />
      <main className="mx-auto mt-16 w-full max-w-[380px]" data-page="welcome">
        <div className="panel p-6">
          {error ? (
            <>
              <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">Sign in</h1>
              <p className="mt-3 text-[13px] leading-5 text-ink-muted" role="alert">{error}</p>
              <Link to="/login" className="mt-4 inline-block text-[13px] font-medium text-indigo hover:underline">
                Go to sign in
              </Link>
            </>
          ) : (
            <p className="flex items-center gap-2 text-[14px] text-ink-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Signing you in…
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
