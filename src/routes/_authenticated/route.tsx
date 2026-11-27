import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { WorkspaceProvider, sessionQuery } from "@/lib/app/workspace";
import type { SignedIn } from "@/lib/api/auth";
import { PasswordNudge } from "@/components/app/PasswordNudge";

// Everything under here needs a signed-in person. Signed out -> /login (and back here after).
export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ context, location }): Promise<{ session: SignedIn }> => {
    const session = await context.queryClient.ensureQueryData(sessionQuery());
    if (!session.signedIn) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
    return { session };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return (
    <WorkspaceProvider>
      <Outlet />
      <PasswordNudge />
    </WorkspaceProvider>
  );
}
