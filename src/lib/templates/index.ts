// All niche templates. Each file holds one half; ids must be unique across both.
import type { NicheTemplate } from "../profile";
import { TEMPLATES_A } from "./a";
import { TEMPLATES_B } from "./b";

export const TEMPLATES: NicheTemplate[] = [...TEMPLATES_A, ...TEMPLATES_B];
export const templateById = (id: string | undefined) => TEMPLATES.find((t) => t.id === id);
export const TEMPLATE_GROUPS = [...new Set(TEMPLATES.map((t) => t.group))];
