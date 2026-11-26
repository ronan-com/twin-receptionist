import { queryOptions } from "@tanstack/react-query";
import { api } from "./base";

// "Contact support": requests to the setup provider (agency staff) or to the agency (business users).
// Server side: server/tickets.ts.
export type TicketStatus = "open" | "waiting" | "closed";
export type TicketSummary = { id: string; subject: string; status: TicketStatus; route: "platform" | "agency"; from: string; business: string; createdAt: string; updatedAt: string; unread: boolean; last: string };
export type TicketList = { canCreate: boolean; route: "platform" | "agency" | null; why: string; seller: string; unread: number; mine: TicketSummary[]; inbox: TicketSummary[] };
export type TicketMessage = { id: string; author: "requester" | "agency" | "support"; name: string; body: string; at: string; shot: string | null; shotName: string };
export type Conversation = {
  ticket: { id: string; subject: string; status: TicketStatus; route: "platform" | "agency"; from: string; business: string; createdAt: string; context: Record<string, string>; pushError: string };
  side: "requester" | "agency";
  canReply: boolean;
  otherParty: string;
  messages: TicketMessage[];
};
export type Shot = { name: string; type: string; data: string };
export const MAX_SHOT_BYTES = 2 * 1024 * 1024;

/** Reads a picked image as base64 for the request. Throws a plain message when it won't do. */
export function readShot(file: File): Promise<Shot> {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return Promise.reject(new Error("Pick a PNG, JPEG, GIF or WebP image."));
  if (file.size > MAX_SHOT_BYTES) return Promise.reject(new Error("That image is over 2 MB. Try a smaller one."));
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("Couldn't read that file."));
    r.onload = () => resolve({ name: file.name, type: file.type, data: String(r.result).split(",")[1] ?? "" });
    r.readAsDataURL(file);
  });
}

export const ticketsApi = {
  list: () => api.get<TicketList>("/api/tickets"),
  get: (id: string) => api.get<Conversation>(`/api/tickets/${id}`),
  create: (b: { subject: string; message: string; screenshot?: Shot | null; page?: string; clientId?: string }) => api.post<{ id: string; route: "platform" | "agency" }>("/api/tickets", b),
  reply: (id: string, b: { message: string; screenshot?: Shot | null }) => api.post<{ ok: true }>(`/api/tickets/${id}/reply`, b),
  setStatus: (id: string, what: "close" | "reopen") => api.post<{ ok: true }>(`/api/tickets/${id}/${what}`),
};

/** The list, refreshed every minute: it carries the unread count for the help menu and the nav. */
export const ticketsQuery = () => queryOptions({ queryKey: ["tickets"], queryFn: ticketsApi.list, refetchInterval: 60_000, staleTime: 30_000 });
export const ticketQuery = (id: string) => queryOptions({ queryKey: ["tickets", id], queryFn: () => ticketsApi.get(id), refetchInterval: 60_000 });
