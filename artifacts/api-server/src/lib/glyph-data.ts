import { db, glyphMessages, glyphEvents, type GlyphMessage, type GlyphEvent } from "@workspace/db";
import { desc, eq, inArray } from "drizzle-orm";

export function publicMessage(message: GlyphMessage, events: GlyphEvent[]) {
  const signals = events.filter((e) => e.messageId === message.id);
  return {
    id: message.id, recipientEmail: message.recipientEmail, recipientName: message.recipientName,
    subject: message.subject, body: message.body, trackOpens: message.trackOpens, trackClicks: message.trackClicks,
    status: message.status as "draft" | "sent" | "sending" | "failed" | "uncertain",
    createdAt: message.createdAt.toISOString(), sentAt: message.sentAt?.toISOString() ?? null,
    opens: signals.filter((e) => e.type === "open" && !e.automated).length,
    clicks: signals.filter((e) => e.type === "click" && !e.automated).length,
    lastActivityAt: (signals[0]?.occurredAt.toISOString() ?? null) as string | null, starred: false, isDemo: false,
  };
}

export function publicEvent(event: GlyphEvent, message: GlyphMessage) {
  return {
    id: event.id, messageId: message.id, recipientName: message.recipientName, recipientEmail: message.recipientEmail,
    subject: message.subject, type: event.type as "sent" | "open" | "click", occurredAt: event.occurredAt.toISOString(),
    url: event.url, automated: event.automated, source: event.source, read: event.read, isDemo: false,
  };
}

export async function ownerData(ownerId: string) {
  const messages = await db.select().from(glyphMessages).where(eq(glyphMessages.ownerId, ownerId)).orderBy(desc(glyphMessages.createdAt));
  const events = messages.length ? await db.select().from(glyphEvents).where(inArray(glyphEvents.messageId, messages.map((m) => m.id))).orderBy(desc(glyphEvents.occurredAt)) : [];
  return { messages, events };
}

export const defaultSettings = {
  notifyOpens: true, notifyClicks: true, defaultTrackOpens: true, defaultTrackClicks: true, trackingBaseUrl: "",
};

export function overview(messages: ReturnType<typeof publicMessage>[], events: ReturnType<typeof publicEvent>[], isDemo: boolean) {
  const sent = messages.filter((m) => m.status === "sent");
  const eligibleOpen = sent.filter((m) => m.trackOpens);
  const eligibleClick = sent.filter((m) => m.trackClicks);
  const daily = Array.from({ length: 14 }, (_, i) => {
    const date = new Date(); date.setUTCDate(date.getUTCDate() - 13 + i);
    const key = date.toISOString().slice(0, 10);
    return {
      date: key,
      sent: sent.filter((m) => m.sentAt?.startsWith(key)).length,
      opens: events.filter((e) => e.type === "open" && !e.automated && e.occurredAt.startsWith(key)).length,
      clicks: events.filter((e) => e.type === "click" && !e.automated && e.occurredAt.startsWith(key)).length,
    };
  });
  return {
    isDemo, totalSent: sent.length, totalOpens: events.filter((e) => e.type === "open" && !e.automated).length,
    totalClicks: events.filter((e) => e.type === "click" && !e.automated).length,
    openRate: eligibleOpen.length ? Math.round(eligibleOpen.filter((m) => m.opens > 0).length / eligibleOpen.length * 100) : 0,
    clickRate: eligibleClick.length ? Math.round(eligibleClick.filter((m) => m.clicks > 0).length / eligibleClick.length * 100) : 0,
    unreadCount: events.filter((e) => !e.read && !e.automated && e.type !== "sent").length, daily,
  };
}

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
export function demoData() {
  const examples = [
    ["Alex Morgan", "alex@northstar.example", "A better way to connect with your customers", 3, 1, 22],
    ["Sarah Chen", "sarah@layers.example", "Following up on our conversation", 2, 0, 86],
    ["James Wilson", "james@orbit.example", "Your proposal, with a little extra detail", 1, 1, 175],
    ["Olivia Martin", "olivia@studio.example", "Let’s make something great together", 0, 0, 320],
    ["David Park", "david@acme.example", "A quick introduction to Glyph", 2, 1, 1400],
    ["Emma Taylor", "emma@form.example", "A few ideas for your next launch", 0, 0, 2850],
  ] as const;
  const messages = examples.map(([recipientName, recipientEmail, subject, opens, clicks, minutes], i) => ({
    id: `demo-${i + 1}`, recipientName, recipientEmail, subject,
    body: `Hi ${recipientName.split(" ")[0]},\n\nThanks for the conversation earlier. I thought you might like a closer look at what we’re building.\n\nHere’s an overview: https://example.com/overview\n\nWould you have 15 minutes this week to catch up?\n\nBest,\nThe Glyph team`,
    trackOpens: true, trackClicks: true, status: "sent" as const,
    createdAt: ago(minutes + 60), sentAt: ago(minutes), opens, clicks,
    lastActivityAt: opens ? ago(Math.max(2, minutes - 20)) : null, starred: false, isDemo: true,
  }));
  const events = messages.flatMap((m, i) => {
    const base = { messageId: m.id, recipientName: m.recipientName, recipientEmail: m.recipientEmail, subject: m.subject,
      automated: false, source: "Sample signal", read: i > 1, isDemo: true };
    return [
      { ...base, id: `${m.id}-sent`, type: "sent" as const, occurredAt: m.sentAt!, url: null },
      ...Array.from({ length: m.opens }, (_, j) => ({ ...base, id: `${m.id}-open-${j}`, type: "open" as const, occurredAt: ago(i * 33 + j * 7 + 2), url: null })),
      ...Array.from({ length: m.clicks }, (_, j) => ({ ...base, id: `${m.id}-click-${j}`, type: "click" as const, occurredAt: ago(i * 37 + j * 9 + 5), url: "https://example.com/overview" })),
    ];
  }).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return { messages, events };
}
