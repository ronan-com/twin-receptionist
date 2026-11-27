// The voice pickers: every Vapi voice has a Play button pointing at its clip; a voice with
// no clip has none.
//   bun test src/components/app/VoicePreview.test.tsx
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { vapiVoiceList } from "../../../server/voice/vapiMap";
import { VoicePicker } from "./ReceptionistFields";
import { VoicePreviewButton } from "./VoicePreview";

// The receptionist page's shape (server/routes/manage.ts answeredVoice).
const rows = vapiVoiceList().map((v) => ({ id: v.id, display_name: v.name, accent: v.accent, style: v.label, gender: v.gender, preview_url: v.previewUrl ?? null }) as any);

describe("voice previews", () => {
  test("the receptionist page's picker has a Play for every Vapi voice", () => {
    const html = renderToStaticMarkup(<VoicePicker voices={rows} value={rows[0].id} onChange={() => {}} />);
    const plays = html.match(/data-action="preview-voice"/g) ?? [];
    expect(plays.length).toBe(rows.length);
    for (const r of rows) expect(html).toContain(`data-voice="${r.id}"`);
    expect(html).toContain('aria-label="Play Charlie"');
  });

  test("no clip, no button", () => {
    expect(renderToStaticMarkup(<VoicePreviewButton id="x" url={null} name="X" />)).toBe("");
    expect(renderToStaticMarkup(<VoicePreviewButton id="y" url="/voice-previews/vapi-Clara.mp3" name="Clara" />)).toContain('aria-pressed="false"');
  });
});
