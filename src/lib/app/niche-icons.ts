import type { LucideIcon } from "lucide-react";
import { Baby, BedDouble, Briefcase, Calculator, Car, Coffee, Droplets, Dog, Dumbbell, HeartPulse, House, PawPrint, Scale, Scissors, Shapes, ShoppingBag, Smile, SprayCan, Stethoscope, Truck, Wrench, GraduationCap } from "lucide-react";
import type { Hue } from "@/components/app/hues";
import type { IndustryKey } from "@/lib/shared";

// One icon and colour for each business niche (the receptionist wizard, clients, receptionist cards).
export const NICHE_ICONS: Record<IndustryKey, { icon: LucideIcon; hue: Hue }> = {
  dental: { icon: Smile, hue: "sky" },
  health: { icon: Stethoscope, hue: "cyan" },
  trades: { icon: Wrench, hue: "amber" },
  beauty: { icon: Scissors, hue: "magenta" },
  property: { icon: House, hue: "indigo" },
  auto: { icon: Car, hue: "slate" },
  professional: { icon: Briefcase, hue: "violet" },
  childcare: { icon: Baby, hue: "amber" },
  cafe: { icon: Coffee, hue: "coral" },
  vet: { icon: PawPrint, hue: "green" },
  gym: { icon: Dumbbell, hue: "coral" },
  physio: { icon: HeartPulse, hue: "cyan" },
  legal: { icon: Scale, hue: "violet" },
  accounting: { icon: Calculator, hue: "sky" },
  cleaning: { icon: SprayCan, hue: "green" },
  plumbing: { icon: Droplets, hue: "sky" },
  hotel: { icon: BedDouble, hue: "indigo" },
  retail: { icon: ShoppingBag, hue: "magenta" },
  tutoring: { icon: GraduationCap, hue: "violet" },
  grooming: { icon: Dog, hue: "amber" },
  removalist: { icon: Truck, hue: "slate" },
  other: { icon: Shapes, hue: "indigo" },
};

export const nicheIcon = (key: string | null | undefined) => NICHE_ICONS[(key as IndustryKey) ?? "other"] ?? NICHE_ICONS.other;
