import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { BrandMark, BrandWave } from "@/components/app/BrandMark";
import { Button } from "@/components/ui/button";

// Placeholder from the foundation; the marketing area replaces it with Answered's site.
export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Answered — The AI Receptionist" }] }),
  component: Home,
});

function Home() {
  return (
    <div className="min-h-screen bg-white text-ink">
      <header className="gutter mx-auto flex h-16 max-w-[1200px] items-center justify-between">
        <BrandMark to="/" />
        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/login">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/signup">Get started</Link>
          </Button>
        </nav>
      </header>
      <main className="gutter mx-auto max-w-[1200px] pb-24 pt-16 sm:pt-24">
        <BrandWave className="mb-6 h-4" animate />
        <h1 className="max-w-3xl text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[56px]">Every call answered. Every booking made.</h1>
        <p className="mt-5 max-w-xl text-[16px] leading-7 text-ink-muted">
          Answered picks up every call, books every appointment and never sleeps. A voice-native AI receptionist for modern business.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild className="h-11 px-5">
            <Link to="/signup" search={{ as: "business" }}>
              Set up my business <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-11 px-5">
            <Link to="/signup" search={{ as: "agency" }}>I'm an agency</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
