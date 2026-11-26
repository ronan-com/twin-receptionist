import { Link } from "@tanstack/react-router";
import { ChevronsUpDown, ExternalLink, LayoutDashboard, LogOut, ShieldCheck } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/lib/app/workspace";
import { InitialsAvatar } from "./primitives";
import { OTHER_BRAND, PRODUCT } from "@/lib/app/product";

export function UserMenu() {
  const { user, profile, isInternalAdmin, internalRole, isGuestDemo, signOut, console: consoleKind, org, viewing, exitView } = useWorkspace();
  const name = isGuestDemo ? "Demo viewer" : profile?.full_name || user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Account";
  const email = isGuestDemo ? "Sample data · not signed in" : profile?.email || user?.email || "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-[5px] px-2 py-1.5 text-left outline-none hover:bg-canvas-2 focus-visible:bg-canvas-2"
          aria-label="Account menu"
        >
          <InitialsAvatar name={name} size={28} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-ink">{name}</span>
            <span className="block truncate text-[11.5px] text-ink-muted">{isGuestDemo ? email : internalRole === "super_admin" ? `${PRODUCT} staff · Platform admin` : consoleKind === "agency" && org ? `${org.name} · Agency` : email}</span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <div className="text-[13px] font-medium text-ink">{name}</div>
          <div className="truncate text-[12px] text-ink-muted">{email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {!consoleKind ? (
          <DropdownMenuItem asChild>
            <Link to="/app" className="cursor-pointer">
              <LayoutDashboard className="mr-2 h-4 w-4" /> Workspace
            </Link>
          </DropdownMenuItem>
        ) : null}
        {viewing ? (
          <DropdownMenuItem onSelect={() => void exitView()} className="cursor-pointer">
            <ShieldCheck className="mr-2 h-4 w-4" /> Exit view
          </DropdownMenuItem>
        ) : null}
        {isInternalAdmin && !isGuestDemo && !viewing ? (
          <DropdownMenuItem asChild>
            <Link to="/admin" className="cursor-pointer">
              <ShieldCheck className="mr-2 h-4 w-4" /> Admin console
            </Link>
          </DropdownMenuItem>
        ) : null}
        {OTHER_BRAND ? null : (
          <DropdownMenuItem asChild>
            <Link to="/" className="cursor-pointer">
              <ExternalLink className="mr-2 h-4 w-4" /> answeredai.co
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()} className="cursor-pointer text-destructive focus:text-destructive">
          <LogOut className="mr-2 h-4 w-4" /> {isGuestDemo ? "Exit demo" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
