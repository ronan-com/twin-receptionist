import { api } from "./base";

// Telegram bot (server/telegram.ts): /api/telegram/<receptionistId>.

export type TelegramState = {
  /** An OpenRouter key is set on the server. Without one the bot can't answer. */
  keyConfigured: boolean;
  connected: boolean;
  username: string;
  botName: string;
  link: string;
  /** This server has a public https address Telegram can post to. */
  reachable: boolean;
  canEdit: boolean;
  chats: number;
};

export const telegramKey = (id: string) => ["telegram", id] as const;

export const telegramApi = {
  get: (id: string) => api.get<TelegramState>(`/api/telegram/${id}`),
  connect: (id: string, token: string) => api.put<TelegramState>(`/api/telegram/${id}`, { token }),
  disconnect: (id: string) => api.del<TelegramState>(`/api/telegram/${id}`),
};
