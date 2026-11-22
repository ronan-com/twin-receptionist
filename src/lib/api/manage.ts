import type {
  Agent,
  Integration,
  IntegrationEventRow,
  Invitation,
  KnowledgeItem,
  MemberRow,
  PhoneNumber,
  SubscriptionRow,
  UsageRecord,
  Voice,
  VoiceConfig,
} from "../app/types";

// The workspace's settings data layer (area S). Server side: server/routes/manage.ts
// under /api/manage/<businessId>/... Stubs return empty data in the right shapes.

export type AgentRow = Agent & { voice: Voice | null; voice_config: VoiceConfig | null };
export type PhoneNumberRow = PhoneNumber & { agent: Pick<Agent, "id" | "name"> | null };
export type TeamData = { members: MemberRow[]; invitations: Invitation[] };

export async function getAgents(_businessId: string): Promise<AgentRow[]> {
  return [];
}

export async function getVoices(_clientVisibleOnly: boolean): Promise<Voice[]> {
  return [];
}

export async function getPhoneNumbers(_businessId: string): Promise<PhoneNumberRow[]> {
  return [];
}

export async function getKnowledge(_businessId: string): Promise<KnowledgeItem[]> {
  return [];
}

export async function getIntegrations(_businessId: string): Promise<Integration[]> {
  return [];
}

export async function getIntegrationEvents(_businessId: string): Promise<IntegrationEventRow[]> {
  return [];
}

export async function getTeam(_businessId: string): Promise<TeamData> {
  return { members: [], invitations: [] };
}

export async function getSubscription(_businessId: string): Promise<SubscriptionRow | null> {
  return null;
}

export async function getUsage(_businessId: string): Promise<UsageRecord[]> {
  return [];
}
