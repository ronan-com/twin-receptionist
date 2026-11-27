import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Globe, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Notice } from "@/components/app/primitives";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Field } from "@/components/app/forms";
import { acceptImportedKnowledge, draftKnowledgeFromWebsite, type ImportDraft } from "@/lib/api/manage";

// "Import from website" on the Knowledge page: the owner gives their web address, the
// server reads the site and drafts items, and nothing is saved until they tick the ones
// they want (edited if they like). Items already in the knowledge base start unticked
// and are never replaced.

const TYPE_LABELS: Record<ImportDraft["type"], string> = { faq: "FAQ", service: "Service", pricing: "Pricing", policy: "Policy", location: "Location", fact: "Business fact" };

type Row = ImportDraft & { keep: boolean };

export function KnowledgeImportButton({ businessId }: { businessId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [pages, setPages] = useState<string[]>([]);

  const close = (o: boolean) => {
    setOpen(o);
    if (!o) {
      setRows(null);
      setPages([]);
    }
  };

  const read = useMutation({
    mutationFn: () => draftKnowledgeFromWebsite(businessId, url),
    onSuccess: (res) => {
      setPages(res.pages);
      setRows(res.drafts.map((d) => ({ ...d, keep: !d.exists })));
    },
    onError: (e: Error) => toast.error("Couldn't import from that website", { description: e.message }),
  });

  const chosen = (rows ?? []).filter((r) => r.keep && r.question.trim() && r.answer.trim());
  const accept = useMutation({
    mutationFn: () => acceptImportedKnowledge(businessId, chosen),
    onSuccess: (res) => {
      const done = `${res.added} item${res.added === 1 ? "" : "s"} added${res.skipped ? `, ${res.skipped} already there` : ""}`;
      if (res.synced) toast.success(done, { description: "Your receptionist uses them from the next call." });
      else toast.warning(done, { description: res.warning });
      void qc.invalidateQueries({ queryKey: ["knowledge", businessId] });
      void qc.invalidateQueries({ queryKey: ["agents", businessId] });
      close(false);
    },
    onError: (e: Error) => toast.error("Couldn't save", { description: e.message }),
  });

  const put = (i: number, p: Partial<Row>) => setRows((rs) => (rs ? rs.map((r, j) => (j === i ? { ...r, ...p } : r)) : rs));

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-action="import-website">
        <Globe className="mr-1.5 h-3.5 w-3.5" /> Import from website
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import from your website</DialogTitle>
            <DialogDescription>
              We read your homepage and a few pages like contact, about, services and FAQ, and draft answers for you to review. Nothing is saved until you add it.
            </DialogDescription>
          </DialogHeader>

          {rows === null ? (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (url.trim()) read.mutate();
              }}
            >
              <Field label="Website address" htmlFor="import-url" hint="Public pages only. This can take up to a minute.">
                <Input id="import-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.yourbusiness.com.au" inputMode="url" maxLength={300} disabled={read.isPending} autoFocus />
              </Field>
              <DialogFooter>
                <Button type="button" variant="outline" size="sm" onClick={() => close(false)}>Cancel</Button>
                <Button type="submit" size="sm" disabled={!url.trim() || read.isPending}>
                  {read.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  {read.isPending ? "Reading your website…" : "Read my website"}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="grid gap-3">
              <Notice tone="neutral">
                Drafted from {pages.length} page{pages.length === 1 ? "" : "s"}. Check each one is right, edit anything that isn't, and untick what you don't want. Items you already have are left alone.
              </Notice>
              <ul className="grid gap-3" data-list="import-drafts">
                {rows.map((r, i) => (
                  <li key={i} className="rounded-[6px] border border-hairline p-3" data-import-row>
                    <div className="flex items-center gap-2">
                      <Checkbox checked={r.keep} onCheckedChange={(v) => put(i, { keep: v === true })} aria-label={`Add ${r.question}`} />
                      <Input value={r.question} maxLength={300} aria-label="Question or title" onChange={(e) => put(i, { question: e.target.value })} className="h-8 text-[13px]" />
                      <StatusBadge tone="muted">{TYPE_LABELS[r.type]}</StatusBadge>
                    </div>
                    {r.exists ? <p className="mt-1 text-[12px] text-ink-muted">You already have an item with this question.</p> : null}
                    <Textarea value={r.answer} rows={2} maxLength={800} aria-label="Answer" className="mt-2 text-[13px]" onChange={(e) => put(i, { answer: e.target.value })} />
                  </li>
                ))}
              </ul>
              <DialogFooter className="flex-row items-center justify-between sm:justify-between">
                <Button type="button" variant="ghost" size="sm" onClick={() => setRows(null)} disabled={accept.isPending}>Back</Button>
                <Button type="button" size="sm" disabled={!chosen.length || accept.isPending} onClick={() => accept.mutate()}>
                  {accept.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  Add {chosen.length} item{chosen.length === 1 ? "" : "s"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
