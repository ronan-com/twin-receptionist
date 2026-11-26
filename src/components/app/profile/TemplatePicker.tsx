import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { TEMPLATES, TEMPLATE_GROUPS, templateById } from "@/lib/templates";
import type { NicheTemplate } from "@/lib/profile";

/**
 * "Start from a template": a searchable list of niche templates grouped by type.
 * Picking one prefills the whole setup; "Start blank" clears it. Once one is chosen
 * the list folds away behind a one-line summary.
 */
export function TemplatePicker({ templateId, onPick, onBlank }: { templateId: string | undefined; onPick: (t: NicheTemplate) => void; onBlank: () => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<string | null>(null);
  const chosen = templateById(templateId);
  const q = query.trim().toLowerCase();
  const groups = useMemo(
    () =>
      TEMPLATE_GROUPS.filter((g) => !group || g === group).map((g) => ({
        group: g,
        items: TEMPLATES.filter((t) => t.group === g && (!q || [t.label, t.group, t.about, ...t.services].some((x) => x.toLowerCase().includes(q)))),
      })).filter((g) => g.items.length),
    [q, group],
  );

  if (TEMPLATES.length === 0) return null;

  if (chosen && !open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-indigo bg-[#f7f6ff] px-3 py-2.5" data-template-chosen={chosen.id}>
        <div className="min-w-0">
          <p className="text-[12px] text-ink-muted">Started from a template</p>
          <p className="text-[13.5px] font-semibold text-ink">{chosen.label}</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)} data-action="change-template">Change</Button>
          <Button type="button" size="sm" variant="ghost" onClick={onBlank} data-action="start-blank">Start blank</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-2" data-template-picker>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Start from a template</h2>
          <p className="text-[12.5px] text-ink-muted">Fills in the services, hours, greeting and call handling for your type of business. You can change everything.</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => { onBlank(); setOpen(false); }} data-action="start-blank">Start blank</Button>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
        <Input className="pl-8" placeholder={`Search ${TEMPLATES.length} templates, e.g. dentist, plumber, café`} value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search templates" />
      </div>
      <div className="flex flex-wrap gap-1.5" data-list="template-groups">
        {[null, ...TEMPLATE_GROUPS].map((g) => (
          <button
            key={g ?? "all"}
            type="button"
            aria-pressed={group === g}
            data-group={g ?? "all"}
            onClick={() => setGroup(g)}
            className={cn("rounded-full border px-2.5 py-1 text-[11.5px] transition-colors", group === g ? "border-indigo bg-[#efeeff] font-medium text-indigo" : "border-hairline bg-white text-ink-muted hover:bg-canvas-2")}
          >
            {g ?? "All"}
          </button>
        ))}
      </div>
      <div className="max-h-[340px] space-y-3 overflow-y-auto rounded-[6px] border border-hairline p-2.5" data-list="templates">
        {groups.length === 0 ? <p className="px-1 py-2 text-[12.5px] text-ink-muted">No template matches "{query}". Pick a business type below, or start blank.</p> : null}
        {groups.map(({ group, items }) => (
          <section key={group}>
            <h3 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">{group}</h3>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {items.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  data-template={t.id}
                  title={t.about}
                  onClick={() => { onPick(t); setOpen(false); setQuery(""); }}
                  className={cn("flex items-center justify-between gap-1 rounded-[6px] border px-2.5 py-2 text-left text-[12.5px] transition-colors", templateId === t.id ? "border-indigo bg-[#efeeff] font-medium text-indigo" : "border-hairline bg-white text-ink hover:bg-canvas-2")}
                >
                  <span className="min-w-0 truncate">{t.label}</span>
                  {templateId === t.id ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
