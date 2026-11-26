import { api } from "./base";

// Website chat (server/webchat.ts): /api/website-chat/<receptionistId>.

export type WebchatState = {
  /** An OpenRouter key is set on the server. Without one the chat and its snippet stay off. */
  keyConfigured: boolean;
  enabled: boolean;
  publicId: string;
  domains: string[];
  greeting: string;
  defaultGreeting: string;
  snippet: string;
  canEdit: boolean;
  chats: number;
};

export type WebchatChat = {
  id: string;
  startedAt: string;
  lastMessageAt: string;
  origin: string;
  messageCount: number;
  outcome: "booked" | "callback" | null;
  visitorName: string;
  preview: string;
};

export type WebchatLine = { role: "user" | "assistant" | "event"; text: string; at: string };

export const webchatKey = (id: string) => ["website-chat", id] as const;

export const webchatApi = {
  get: (id: string) => api.get<WebchatState>(`/api/website-chat/${id}`),
  save: (id: string, patch: { enabled?: boolean; domains?: string; greeting?: string }) => api.put<WebchatState>(`/api/website-chat/${id}`, patch),
  chats: async (id: string) => (await api.get<{ chats: WebchatChat[] }>(`/api/website-chat/${id}/chats`)).chats,
  transcript: (id: string, chatId: string) => api.get<{ chat: WebchatChat; lines: WebchatLine[] }>(`/api/website-chat/${id}/chats/${chatId}`),
};
