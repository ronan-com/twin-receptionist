import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Check, ChevronsUpDown, Plus } from "lucide-react";
import { toast } from "sonner";
import { createBusiness } from "@/lib/api/workspace";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWorkspace } from "@/lib/app/workspace";
import { INDUSTRIES, TIMEZONES } from "@/lib/app/constants";
import { cn } from "@/lib/utils";
import { DemoBadge } from "./StatusBadge";

export function CreateBusinessDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { setBusinessId, refresh, console: consoleKind } = useWorkspace();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [timezone, setTimezone] = useState("Australia/Sydney");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    let data: string | null = null;
    try {
      data = await createBusiness({ name: name.trim(), industry: industry || undefined, phone: phone.trim() || undefined, website: website.trim() || undefined, timezone });
    } catch (err) {
      setSaving(false);
      toast.error("Couldn't create the business", { description: (err as Error).message });
      return;
    }
    setSaving(false);
    await queryClient.invalidateQueries({ queryKey: ["businesses"] });
    await queryClient.invalidateQueries({ queryKey: ["memberships"] });
    await refresh();
    if (data) setBusinessId(data);
    toast.success(`${name.trim()} is ready`, { description: "Set up your receptionist next." });
    onOpenChange(false);
    setName("");
    setIndustry("");
    setPhone("");
    setWebsite("");
    // Agency staff stay in the console; the receptionist is listed there.
    if (!consoleKind) navigate({ to: "/app/receptionist" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Create your business</DialogTitle>
            <DialogDescription>You'll be the owner. You can invite your team afterwards.</DialogDescription>
          </DialogHeader>
          <div className="mt-4 grid gap-3.5">
            <div className="grid gap-1.5">
              <Label htmlFor="biz-name">Business name</Label>
              <Input id="biz-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Harbourside Dental" required autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Industry</Label>
                <Select value={industry} onValueChange={setIndustry}>
                  <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                  <SelectContent>
                    {INDUSTRIES.map((i) => (
                      <SelectItem key={i} value={i}>{i}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Timezone</Label>
                <Select value={timezone} onValueChange={setTimezone}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="biz-phone">Main phone</Label>
                <Input id="biz-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+61 2 …" inputMode="tel" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="biz-web">Website</Label>
                <Input id="biz-web" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" inputMode="url" />
              </div>
            </div>
          </div>
          <DialogFooter className="mt-5">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving || !name.trim()}>{saving ? "Creating…" : "Create business"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function WorkspaceSwitcher() {
  const { business, ownBusinesses, demoBusinesses, businesses, isInternalAdmin, setBusinessId, console: consoleKind, viewing } = useWorkspace();
  // Only agency staff create receptionists from here; a business user's own sign-up made theirs.
  const canCreate = consoleKind !== null && !viewing;
  const [creating, setCreating] = useState(false);
  const others = isInternalAdmin ? businesses.filter((b) => !b.is_demo && !ownBusinesses.some((o) => o.id === b.id)) : [];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-[5px] border border-hairline bg-white px-2 py-1.5 text-left outline-none hover:bg-canvas-2 focus-visible:ring-2 focus-visible:ring-indigo"
            aria-label="Switch workspace"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] bg-slate-deep text-[11px] font-semibold text-white">
              {business?.name?.[0]?.toUpperCase() ?? <Building2 className="h-3.5 w-3.5" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[13px] font-medium text-ink">{business?.name ?? "Choose workspace"}</span>
                {business?.is_demo ? <DemoBadge className="h-[18px] px-1 text-[10.5px]" /> : null}
              </span>
              <span className="block truncate text-[11px] text-ink-muted">{business?.industry ?? (business ? "Business" : "")}</span>
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[260px]">
          {ownBusinesses.length > 0 ? (
            <>
              <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Your businesses</DropdownMenuLabel>
              {ownBusinesses.map((b) => (
                <DropdownMenuItem key={b.id} onSelect={() => setBusinessId(b.id)} className="cursor-pointer">
                  <span className="flex-1 truncate">{b.name}</span>
                  {b.id === business?.id ? <Check className="h-4 w-4 text-indigo" /> : null}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
            </>
          ) : null}
          {demoBusinesses.length > 0 ? (
            <>
              <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Demo workspaces</DropdownMenuLabel>
              {demoBusinesses.map((b) => (
                <DropdownMenuItem key={b.id} onSelect={() => setBusinessId(b.id)} className="cursor-pointer">
                  <span className="flex-1 truncate">{b.name}</span>
                  {b.id === business?.id ? <Check className="h-4 w-4 text-indigo" /> : null}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
            </>
          ) : null}
          {others.length > 0 ? (
            <>
              <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Clients (staff view)</DropdownMenuLabel>
              {others.slice(0, 12).map((b) => (
                <DropdownMenuItem key={b.id} onSelect={() => setBusinessId(b.id)} className="cursor-pointer">
                  <span className="flex-1 truncate">{b.name}</span>
                  {b.id === business?.id ? <Check className="h-4 w-4 text-indigo" /> : null}
                </DropdownMenuItem>
              ))}
              {others.length > 12 ? (
                <DropdownMenuItem asChild>
                  <Link to="/admin/clients" className="cursor-pointer text-indigo">Browse all clients in Admin</Link>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
            </>
          ) : null}
          {canCreate ? (
            <DropdownMenuItem onSelect={() => setCreating(true)} className={cn("cursor-pointer font-medium text-indigo focus:text-indigo")}>
              <Plus className="mr-2 h-4 w-4" /> Create a business
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateBusinessDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
