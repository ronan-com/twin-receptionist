import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Globe, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { request } from "@/lib/api/base";
import { useWorkspace } from "@/lib/app/workspace";

// Settings, "Web address" (owner of a single-agency copy only): the address the dashboard answers on, and
// "Change domain", which opens the domain form on the owner's private setup link (server/domainLink.ts).

/** The owner of this agency's own copy, signed in as themselves. */
export function useOwnsAddress(): boolean {
  const ws = useWorkspace();
  return Boolean(ws.session?.singleAgency) && ws.session?.role === "owner" && !ws.viewing;
}

export function WebAddressCard() {
  const address = useQuery({ queryKey: ["console", "public-url"], retry: false, staleTime: 60_000, queryFn: () => request<{ url?: string }>("GET", "/api/public-url") });
  const open = useMutation({
    mutationFn: () => request<{ url: string }>("GET", "/api/domain-link"),
    onSuccess: (r) => window.location.assign(r.url),
    onError: (e: Error) => toast.error(e.message),
  });
  const shown = (address.data?.url || (typeof window !== "undefined" ? window.location.origin : "")).replace(/^https?:\/\//, "").replace(/\/$/, "");
  return (
    <section className="panel flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5" data-card="web-address">
      <span data-hue="indigo" className="hue-icon grid h-12 w-12 shrink-0 place-items-center rounded-[12px]" aria-hidden>
        <Globe className="h-6 w-6" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-semibold text-ink">Web address</h2>
        <p className="mt-0.5 text-[14px] font-medium text-ink [overflow-wrap:anywhere]" data-web-address>{address.isPending ? "Loading…" : shown}</p>
        <p className="mt-0.5 text-[12.5px] text-ink-muted">Changing it opens your setup page. You'll need your Railway token.</p>
        {open.error ? <p role="alert" className="mt-1 text-[12.5px] text-[#a41d1d]">{(open.error as Error).message}</p> : null}
      </div>
      <Button className="h-11 gap-2 px-6" disabled={open.isPending} onClick={() => open.mutate()} data-action="change-domain">
        {open.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />} Change domain
      </Button>
    </section>
  );
}
