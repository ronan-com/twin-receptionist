import { useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BookOpen, HelpCircle, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { PageHeader, Panel, ErrorState, Notice, MetricCard, MetricGrid } from "@/components/app/primitives";
import { DataTable, TableToolbar, type Column } from "@/components/app/DataTable";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Field } from "@/components/app/forms";
import { KnowledgeImportButton } from "@/components/app/KnowledgeImport";
import { fmtNumber, fmtRelative, fmtSmartDate } from "@/lib/app/format";
import { Marked } from "@/components/app/EditMark";
import { knowledgeQuery, unansweredQuery } from "@/lib/app/queries";
import { createKnowledge, deleteKnowledge, updateKnowledge, type KnowledgeSaved } from "@/lib/api/manage";
import type { KnowledgeItem, KnowledgeStatus, KnowledgeType } from "@/lib/app/types";
import { useWorkspace } from "@/lib/app/workspace";
import { PRODUCT } from "@/lib/app/product";


// The types our receptionist reads. Links and documents aren't read yet.
const TYPES: KnowledgeType[] = ["faq", "service", "pricing", "policy", "location", "fact", "custom_qa"];
const TYPE_LABELS: Record<string, string> = {
  faq: "FAQ",
  service: "Service",
  pricing: "Pricing",
  policy: "Policy",
  location: "Location",
  fact: "Business fact",
  custom_qa: "Custom Q&A",
};

interface ItemForm {
  id?: string;
  title: string;
  type: KnowledgeType;
  question: string;
  answer: string;
  content: string;
  status: KnowledgeStatus;
}

const emptyForm = (): ItemForm => ({ title: "", type: "faq", question: "", answer: "", content: "", status: "published" });

function isQa(type: KnowledgeType) {
  return type === "faq" || type === "custom_qa";
}

export function KnowledgePage() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const itemsQ = useQuery(knowledgeQuery(ws.businessId));
  const unansweredQ = useQuery(unansweredQuery(ws.businessId));
  const canEdit = ws.access.canEdit;

  const [search, setSearch] = useState("");
  const [type, setType] = useState<KnowledgeType | "all">("all");
  const [status, setStatus] = useState<KnowledgeStatus | "all">("all");
  const [editing, setEditing] = useState<ItemForm | null>(null);
  const [deleting, setDeleting] = useState<KnowledgeItem | null>(null);
  const [tab, setTab] = useState<"items" | "questions">("items");

  const items = itemsQ.data ?? [];
  const unanswered = unansweredQ.data ?? [];
  const openQuestions = unanswered.filter((u) => u.status === "open");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (type !== "all" && i.type !== type) return false;
      if (status !== "all" && i.status !== status) return false;
      if (q) {
        const hay = [i.title, i.question, i.answer, i.content].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, search, type, status]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["knowledge", ws.businessId] });
    void qc.invalidateQueries({ queryKey: ["agents", ws.businessId] });
  };
  const afterSync = (res: KnowledgeSaved, done: string) => {
    if (res.synced) toast.success(done, { description: "Your receptionist uses it from the next call." });
    else toast.warning(done, { description: res.warning });
  };

  const saveItem = useMutation({
    mutationFn: async (f: ItemForm) => {
      if (!ws.businessId) throw new Error("No business selected.");
      const qa = isQa(f.type);
      const payload = {
        title: f.title.trim() || (qa ? f.question.trim().slice(0, 120) : ""),
        type: f.type,
        question: qa ? f.question.trim() || null : null,
        answer: qa ? f.answer.trim() || null : null,
        content: !qa ? f.content.trim() || null : null,
        status: f.status,
      };
      return f.id ? updateKnowledge(ws.businessId, f.id, payload) : createKnowledge(ws.businessId, payload);
    },
    onSuccess: (res, f) => {
      afterSync(res, f.id ? "Knowledge updated" : "Knowledge added");
      setEditing(null);
      invalidate();
    },
    onError: (e) => toast.error("Couldn't save", { description: e.message }),
  });

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      if (!ws.businessId) throw new Error("No business selected.");
      return deleteKnowledge(ws.businessId, id);
    },
    onSuccess: (res) => {
      afterSync(res, "Removed");
      setDeleting(null);
      setEditing(null);
      invalidate();
    },
    onError: (e) => toast.error("Couldn't remove", { description: e.message }),
  });

  const openEdit = (i: KnowledgeItem) =>
    setEditing({ id: i.id, title: i.title, type: i.type, question: i.question ?? "", answer: i.answer ?? "", content: i.content ?? "", status: i.status });

  const columns: Column<KnowledgeItem>[] = [
    {
      key: "title",
      header: "Item",
      cell: (i) => (
        <div className="min-w-0 max-w-[52vw] sm:max-w-none">
          <div className="truncate font-medium">{i.title}</div>
          <div className="truncate text-[12px] text-ink-muted"><Marked text={i.answer ?? i.content ?? ""} /></div>
        </div>
      ),
    },
    { key: "type", header: "Type", cell: (i) => <StatusBadge tone="muted">{TYPE_LABELS[i.type] ?? i.type}</StatusBadge>, hideBelow: "sm" },
    { key: "status", header: "Status", cell: (i) => <StatusBadge tone={i.status === "published" ? "success" : i.status === "draft" ? "warning" : "muted"}>{i.status}</StatusBadge> },
    { key: "updated", header: "Updated", align: "right", cell: (i) => <span className="whitespace-nowrap text-ink-muted">{fmtRelative(i.updated_at)}</span>, hideBelow: "md" },
  ];

  const published = items.filter((i) => i.status === "published").length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={ws.business?.name}
        title="Knowledge base"
        description="Everything your receptionist knows about your business: services, pricing, policies and the questions callers ask."
        actions={
          canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              {ws.businessId ? <KnowledgeImportButton businessId={ws.businessId} /> : null}
              <Button size="sm" onClick={() => setEditing(emptyForm())}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Add knowledge
              </Button>
            </div>
          ) : null
        }
      />

      {itemsQ.error ? <ErrorState message={itemsQ.error.message} onRetry={() => void itemsQ.refetch()} /> : null}
      {!canEdit ? <Notice tone="neutral">{ws.access.readOnlyReason ?? "Your access to this business is view only."}</Notice> : null}

      <MetricGrid cols={3}>
        <MetricCard label="Published items" value={fmtNumber(published)} icon={BookOpen} loading={itemsQ.isPending} hint={`${fmtNumber(items.length - published)} draft or archived`} />
        <MetricCard label="Open questions" value={fmtNumber(openQuestions.length)} icon={HelpCircle} loading={unansweredQ.isPending} hint="Things callers asked that weren't covered" />
        <MetricCard label="Last updated" value={items[0] ? fmtSmartDate(items[0].updated_at) : "—"} loading={itemsQ.isPending} hint={items[0]?.title} />
      </MetricGrid>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "items" | "questions")}>
        <TabsList className="h-9 rounded-[6px] bg-canvas-2 p-1">
          <TabsTrigger value="items" className="text-[12.5px]">Knowledge ({fmtNumber(items.length)})</TabsTrigger>
          <TabsTrigger value="questions" className="text-[12.5px]">Unanswered</TabsTrigger>
        </TabsList>

        <TabsContent value="items" className="mt-3">
          <Panel padded={false}>
            <TableToolbar>
              <div className="relative min-w-0 flex-1 basis-full sm:min-w-[200px] sm:max-w-xs sm:basis-auto">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search knowledge…" className="h-8 pl-8 text-[13px]" aria-label="Search knowledge" />
              </div>
              <Select value={type} onValueChange={(v) => setType(v as KnowledgeType | "all")}>
                <SelectTrigger className="h-8 w-[140px] text-[12.5px]" aria-label="Type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {TYPES.map((t) => <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={status} onValueChange={(v) => setStatus(v as KnowledgeStatus | "all")}>
                <SelectTrigger className="h-8 w-[130px] text-[12.5px]" aria-label="Status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </TableToolbar>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(i) => i.id}
              loading={itemsQ.isPending}
              onRowClick={openEdit}
              empty={{
                icon: BookOpen,
                title: items.length === 0 ? "Teach your receptionist about your business" : "Nothing matches",
                description: items.length === 0 ? "Start with your services, prices and the five questions you get asked most." : "Try a different search or filter.",
                action: canEdit && items.length === 0 ? <Button size="sm" onClick={() => setEditing(emptyForm())}>Add your first item</Button> : undefined,
              }}
            />
          </Panel>
          <p className="mt-2 text-[12px] text-ink-muted">Only published items are used on calls. Drafts and archived items stay here for your team.</p>
        </TabsContent>

        <TabsContent value="questions" className="mt-3">
          <Panel title="Questions your receptionist couldn't answer" padded={false}>
            {unansweredQ.isPending ? (
              <div className="p-4 text-[13px] text-ink-muted">Loading…</div>
            ) : unanswered.length === 0 ? (
              <div className="px-6 py-12 text-center text-[13px] text-ink-muted">We don't detect unanswered questions yet. Add answers you know callers ask about.</div>
            ) : (
              <ul className="divide-y divide-hairline">
                {unanswered.map((u) => (
                  <li key={u.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <span className="text-[13.5px] font-medium text-ink">“{u.question}”</span>
                      <div className="mt-0.5 text-[12px] text-ink-muted">Asked {u.occurrences} time{u.occurrences === 1 ? "" : "s"} · last {fmtRelative(u.updated_at)}</div>
                    </div>
                    {u.status === "open" && canEdit ? (
                      <Button size="sm" className="h-8 shrink-0" onClick={() => setEditing({ ...emptyForm(), question: u.question, title: u.question.slice(0, 120) })}>
                        Add answer
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </TabsContent>
      </Tabs>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          {editing ? (
            <>
              <DialogHeader>
                <DialogTitle>{editing.id ? (canEdit ? "Edit knowledge" : "Knowledge") : "Add knowledge"}</DialogTitle>
                <DialogDescription>Write it the way you'd say it to a caller. Your receptionist rephrases naturally.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Type" htmlFor="k-type">
                    <Select value={editing.type} onValueChange={(v) => setEditing({ ...editing, type: v as KnowledgeType })} disabled={!canEdit}>
                      <SelectTrigger id="k-type"><SelectValue /></SelectTrigger>
                      <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                  <Field label="Status" htmlFor="k-status">
                    <Select value={editing.status} onValueChange={(v) => setEditing({ ...editing, status: v as KnowledgeStatus })} disabled={!canEdit}>
                      <SelectTrigger id="k-status"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="published">Published</SelectItem>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="archived">Archived</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                {isQa(editing.type) ? (
                  <>
                    <Field label="Question" htmlFor="k-q" required>
                      <Input id="k-q" value={editing.question} onChange={(e) => setEditing({ ...editing, question: e.target.value })} disabled={!canEdit} maxLength={300} placeholder="Do you offer payment plans?" />
                    </Field>
                    <Field label="Answer" htmlFor="k-a" required>
                      <Textarea id="k-a" rows={4} value={editing.answer} onChange={(e) => setEditing({ ...editing, answer: e.target.value })} disabled={!canEdit} maxLength={2000} placeholder="Yes, we offer interest-free plans over 6 or 12 months for treatments over $500." />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label="Title" htmlFor="k-title" required hint="What this is about, e.g. Parking & access.">
                      <Input id="k-title" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} disabled={!canEdit} maxLength={300} placeholder="e.g. Parking & access" />
                    </Field>
                    <Field label="Details" htmlFor="k-c" required>
                      <Textarea id="k-c" rows={6} value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} disabled={!canEdit} maxLength={2000} placeholder="Check-up & clean: 45 minutes, $189 (or no gap with most health funds). Includes X-rays if due." />
                    </Field>
                  </>
                )}
              </div>
              <DialogFooter className="mt-2 flex-row items-center justify-between sm:justify-between">
                {editing.id && canEdit ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-[#a41d1d] hover:bg-[#fff7f7] hover:text-[#a41d1d]"
                    onClick={() => {
                      const it = items.find((x) => x.id === editing.id);
                      if (it) setDeleting(it);
                    }}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove
                  </Button>
                ) : (
                  <span />
                )}
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
                    {canEdit ? "Cancel" : "Close"}
                  </Button>
                  {canEdit ? (
                    <Button
                      size="sm"
                      onClick={() => saveItem.mutate(editing)}
                      disabled={saveItem.isPending || (isQa(editing.type) ? !editing.question.trim() || !editing.answer.trim() : !editing.title.trim() || !editing.content.trim())}
                    >
                      {saveItem.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                      {editing.id ? "Save changes" : "Add"}
                    </Button>
                  ) : null}
                </div>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{deleting?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>Your receptionist will stop using this from the next call. This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction className="bg-[#a41d1d] hover:bg-[#8a1717]" onClick={() => deleting && deleteItem.mutate(deleting.id)}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
