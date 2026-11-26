import type {
  AvailableNumber,
  Business,
  CallMessage,
  CallSummary,
  ConnectedNumber,
  NumberCountry,
  NumberOrder,
  NumberSupport,
  NumberType,
  Settings,
  Voice,
  VoiceProviderId,
} from "../../src/lib/shared";
import type { Ctx } from "../accounts";

// The voice engine behind a receptionist. Two exist: Telnyx (the default, server/voice/telnyx.ts)
// and Vapi (server/voice/vapi.ts). server/index.ts and the other server files talk to this
// interface through server/voice/index.ts and never to an engine's API directly.
//
// Everything runs inside an org scope (runAsOrg / enterOrg from server/telnyx.ts), which
// is how an engine finds the agency's own keys.

/** One call or text from the engine's records. */
export type Conversation = CallSummary & {
  to: string;
  endedAt: string;
};

/** What the browser needs to start a test call without a phone. */
export type WebCallConfig =
  | { provider: "telnyx"; assistantId: string }
  | { provider: "vapi"; assistantId: string; publicKey: string };

export type NumbersState = { numbers: ConnectedNumber[]; pending: NumberOrder[]; balance: { amount: number; currency: string } | null };

export interface VoiceProvider {
  readonly id: VoiceProviderId;
  /** Name for screens ("Telnyx", "Vapi"). */
  readonly label: string;

  /** Makes the assistant for a new receptionist (its id is chosen first so tool and report addresses can carry it); returns the engine's id for it. */
  createAssistant(settings: Settings, instructions: string, clientId: string): Promise<string>;
  /**
   * Pushes the script, the booking tools and the automations (server/index.ts syncAssistant).
   * `allowedTools` are the booking tools this receptionist may use right now (paused, booking mode).
   */
  syncAssistant(client: Business, instructions: string, allowedTools: string[]): Promise<void>;
  /** Pushes the profile (name, greeting, voice) with the script (server/index.ts updateClient). */
  updateAssistant(client: Business, settings: Settings, instructions: string): Promise<void>;
  /** Pushes recording, language, limits and the greeting (server/automations.ts applyAutomations). */
  applyAutomations(client: Business): Promise<void>;
  /** Removes the assistant. An assistant that is already gone is not an error. */
  deleteAssistant(client: Business): Promise<void>;

  /** Recent calls and texts for the dashboard and the call log sync. */
  recentConversations(assistantId: string, limit: number): Promise<Conversation[]>;
  /** One conversation's summary and transcript, only if it belongs to this receptionist. */
  callDetail(business: Business, conversationId: string): Promise<{ summary: string; messages: CallMessage[] }>;

  /** The voices to choose from for this agency. */
  voices(): Promise<Voice[]>;

  readonly numbers: {
    support(): NumberSupport;
    state(ctx: Ctx, client: Business): Promise<NumbersState>;
    search(type: NumberType, country: NumberCountry): Promise<AvailableNumber[]>;
    /** Buys a number and points it at the receptionist. Spends money: needs input.confirm === true. */
    buy(client: Business, input: unknown): Promise<NumberOrder>;
    /** Brings a number the agency already owns elsewhere and points it at the receptionist. */
    attach(client: Business, input: unknown): Promise<NumberOrder>;
  };

  /** What the browser test call needs. */
  webCall(assistantId: string): Promise<WebCallConfig>;
}
