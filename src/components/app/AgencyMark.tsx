import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { brandApi } from "@/lib/api/console";
import { NEUTRAL_DASHBOARD, PRODUCT } from "@/lib/app/product";
import { useWorkspace } from "@/lib/app/workspace";
import { BrandMark } from "./BrandMark";
import { brandVars } from "./WorkspaceBrand";

/** The agency's own logo, name and colours on its admin console. */
export function AgencyMark({ to }: { to: string }) {
  const ws = useWorkspace();
  const name = NEUTRAL_DASHBOARD ? ws.org?.name || PRODUCT : PRODUCT;
  const look = useQuery({ queryKey: ["console", "brand"], queryFn: brandApi.get, retry: false }).data;
  useEffect(() => {
    const root = document.documentElement;
    const vars = brandVars(look);
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    return () => {
      for (const k of Object.keys(vars)) root.style.removeProperty(k);
    };
  }, [look]);
  if (!look?.logo) return <BrandMark to={to} size="sm" name={name} />;
  return (
    <Link to={to} className="inline-flex min-w-0 items-center gap-2">
      <img src={look.logo} alt="" className="h-8 max-w-[96px] shrink-0 object-contain" />
      <span className="truncate text-[15px] font-semibold tracking-[-0.02em] text-ink">{name}</span>
    </Link>
  );
}
