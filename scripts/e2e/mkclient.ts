// A complete receptionist record for the local end-to-end tests (no phone provider needed).
import { blankSettings } from "../../src/lib/shared";

const now = new Date().toISOString();
const settings = { ...blankSettings(), businessName: "Alpha Plumbing", receptionistName: "Mia", voiceName: "Arlo - Service Specialist" };
console.log(JSON.stringify({ assistantId: "asst-A", settings, instructions: "x", createdAt: now, updatedAt: now }));
