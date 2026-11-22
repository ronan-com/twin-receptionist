import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { authApi, type Session, type SignedIn } from "@/lib/api/auth";
import type { WorkspaceBusiness, WorkspaceMembership } from "@/lib/api/workspace";
import { STORAGE_KEYS } from "./constants";
import { isRangePreset, resolveRange, type RangePreset, type ResolvedRange } from "./date-range";
import { businessesQuery, membershipsQuery } from "./queries";
import type { InternalRole, MembershipRole, Profile } from "./types";

// The same context the Answered pages expect (useWorkspace), backed by our server:
// /api/session (who is signed in, their role, console or workspace) and
// /api/session/businesses (the businesses they work with, in Answered's shapes).
//
// Mapping to our three tiers:
//  - platform admin      -> isInternalAdmin, internalRole "super_admin", console "platform"
//  - agency staff        -> isInternalAdmin (console access), internalRole null, console "agency"
//  - business manager    -> membership role "admin" (access.canManage), workspace
//  - business viewer     -> membership role "read_only" (read-only), workspace
//  - platform viewing as a business -> no membership, access.kind "staff_view" (read-only)

export const sessionQuery = () =>
  queryOptions({
    queryKey: ["session"],
    queryFn: authApi.session,
    staleTime: 60_000,
  });

export type AccessKind = "member" | "staff_view" | "demo" | "none";

export interface Access {
  kind: AccessKind;
  role: MembershipRole | null;
  canEdit: boolean;
  canManage: boolean;
  isOwner: boolean;
  readOnlyReason: string | null;
}

/** The parts of Supabase's User the pages read. */
export interface WorkspaceUser {
  id: string;
  email: string;
  user_metadata: { full_name?: string };
}

export interface WorkspaceValue {
  loading: boolean;
  error: string | null;
  user: WorkspaceUser | null;
  isGuestDemo: boolean;
  profile: Profile | null;
  isInternalAdmin: boolean;
  internalRole: InternalRole | null;
  bootstrapped: boolean;
  businesses: WorkspaceBusiness[];
  ownBusinesses: WorkspaceBusiness[];
  demoBusinesses: WorkspaceBusiness[];
  memberships: WorkspaceMembership[];
  business: WorkspaceBusiness | null;
  businessId: string | null;
  access: Access;
  setBusinessId: (id: string) => void;
  rangePreset: RangePreset;
  setRangePreset: (p: RangePreset) => void;
  range: ResolvedRange;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;

  // ---- Ours ----
  /** The raw /api/session answer (signed in). */
  session: SignedIn | null;
  /** "platform" or "agency" for console users, null for business users. */
  console: "platform" | "agency" | null;
  isPlatformAdmin: boolean;
  /** Set while the platform team is viewing as an agency or a business (read-only). */
  viewing: SignedIn["viewing"] | null;
  /** The org this session works in (an agency, or the org that owns a business). */
  org: { id: string; name: string } | null;
  /** manager / viewer for the current business (business users only). */
  accessRole: "manager" | "viewer" | null;
  /** Leave "View as" and go back to the console. */
  exitView: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

function readStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

const NO_ACCESS: Access = { kind: "none", role: null, canEdit: false, canManage: false, isOwner: false, readOnlyReason: null };

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const sessionQ = useQuery(sessionQuery());
  const session: SignedIn | null = sessionQ.data?.signedIn ? sessionQ.data : null;

  const businessesQ = useQuery({ ...businessesQuery(), enabled: !!session });
  const membershipsQ = useQuery({ ...membershipsQuery(session?.user.id ?? null), enabled: !!session });

  const businesses = useMemo(() => businessesQ.data ?? [], [businessesQ.data]);
  const memberships = useMemo(() => membershipsQ.data ?? [], [membershipsQ.data]);

  const ownBusinesses = useMemo(() => {
    const ids = new Set(memberships.map((m) => m.business_id));
    return businesses.filter((b) => ids.has(b.id));
  }, [businesses, memberships]);
  const demoBusinesses = useMemo(() => businesses.filter((b) => b.is_demo), [businesses]);

  const [selectedId, setSelectedId] = useState<string | null>(() => readStorage(STORAGE_KEYS.currentBusiness));
  const [rangePreset, setRangePresetState] = useState<RangePreset>(() => {
    const stored = readStorage(STORAGE_KEYS.range);
    return isRangePreset(stored) ? stored : "30d";
  });

  // A business in the session's own org comes first (its API calls are scoped to that org).
  const businessId = useMemo(() => {
    if (businesses.length === 0) return null;
    if (session?.viewing?.client) return session.viewing.client;
    if (selectedId && businesses.some((b) => b.id === selectedId && b.org_id === session?.org?.id)) return selectedId;
    const inOrg = businesses.filter((b) => b.org_id === session?.org?.id);
    return inOrg[0]?.id ?? ownBusinesses[0]?.id ?? businesses[0]?.id ?? null;
  }, [businesses, ownBusinesses, selectedId, session?.org?.id, session?.viewing?.client]);

  useEffect(() => {
    if (businessId && businessId !== selectedId) {
      setSelectedId(businessId);
      writeStorage(STORAGE_KEYS.currentBusiness, businessId);
    }
  }, [businessId, selectedId]);

  const setBusinessId = useCallback(
    (id: string) => {
      setSelectedId(id);
      writeStorage(STORAGE_KEYS.currentBusiness, id);
      // A business in another org: move the session there first.
      const target = businesses.find((b) => b.id === id);
      if (target && session?.org && target.org_id !== session.org.id && !session.viewing) {
        void authApi.switchOrg(target.org_id).then(async () => {
          await queryClient.invalidateQueries();
        });
      }
    },
    [businesses, session, queryClient],
  );

  const setRangePreset = useCallback((p: RangePreset) => {
    setRangePresetState(p);
    writeStorage(STORAGE_KEYS.range, p);
  }, []);

  const business = useMemo(() => businesses.find((b) => b.id === businessId) ?? null, [businesses, businessId]);
  const consoleKind = session?.console ?? null;
  const isPlatformAdmin = Boolean(session?.user.platformAdmin);
  const isInternalAdmin = isPlatformAdmin || consoleKind !== null;

  const access = useMemo<Access>(() => {
    if (!business || !session) return NO_ACCESS;
    if (session.viewing) {
      return {
        kind: "staff_view",
        role: null,
        canEdit: false,
        canManage: false,
        isOwner: false,
        readOnlyReason: `You're viewing ${business.name} as the platform team. This view is read only.`,
      };
    }
    const m = memberships.find((x) => x.business_id === business.id);
    if (m) {
      const canManage = m.access_role === "manager";
      return {
        kind: "member",
        role: m.role,
        canEdit: canManage,
        canManage,
        isOwner: false,
        readOnlyReason: canManage ? null : "Your access to this business is view only. Ask a manager for more access.",
      };
    }
    // Agency staff (and the platform team) looking at one of their receptionists.
    if (consoleKind) return { kind: "member", role: "admin", canEdit: true, canManage: true, isOwner: false, readOnlyReason: null };
    return { ...NO_ACCESS, readOnlyReason: "You do not have access to this workspace." };
  }, [business, memberships, session, consoleKind]);

  const range = useMemo(() => resolveRange(rangePreset, business?.timezone ?? null), [rangePreset, business?.timezone]);

  const refresh = useCallback(async () => {
    await Promise.all([sessionQ.refetch(), businessesQ.refetch()]);
  }, [sessionQ, businessesQ]);

  const signOut = useCallback(async () => {
    await authApi.signOut().catch(() => {});
    await queryClient.cancelQueries();
    queryClient.clear();
    navigate({ to: "/login", replace: true });
  }, [queryClient, navigate]);

  const exitView = useCallback(async () => {
    await authApi.exitView();
    await queryClient.cancelQueries();
    // Reset (not just clear) so the mounted console refetches the session: exiting an
    // agency view from /admin stays on /admin and must switch back to the platform console.
    await queryClient.resetQueries();
    navigate({ to: "/admin", replace: true });
  }, [queryClient, navigate]);

  const user = useMemo<WorkspaceUser | null>(
    () => (session ? { id: session.user.id, email: session.user.email, user_metadata: { full_name: session.user.name } } : null),
    [session],
  );
  const profile = useMemo<Profile | null>(
    () =>
      session
        ? { id: session.user.id, email: session.user.email, full_name: session.user.name || null, avatar_url: null, timezone: null, created_at: "", updated_at: "" }
        : null,
    [session],
  );

  const loading = sessionQ.isPending || (!!session && businessesQ.isPending);
  const error = sessionQ.error?.message ?? businessesQ.error?.message ?? null;

  const value: WorkspaceValue = {
    loading,
    error,
    user,
    isGuestDemo: false,
    profile,
    isInternalAdmin,
    internalRole: isPlatformAdmin && !session?.viewing ? "super_admin" : null,
    bootstrapped: false,
    businesses,
    ownBusinesses,
    demoBusinesses,
    memberships,
    business,
    businessId,
    access,
    setBusinessId,
    rangePreset,
    setRangePreset,
    range,
    refresh,
    signOut,
    session,
    console: consoleKind,
    isPlatformAdmin,
    viewing: session?.viewing ?? null,
    org: session?.org ?? null,
    accessRole: memberships.find((m) => m.business_id === businessId)?.access_role ?? null,
    exitView,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}

export type { Session };
