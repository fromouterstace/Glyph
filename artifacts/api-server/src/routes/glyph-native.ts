import { Router } from "express";
import { getAuth } from "@clerk/express";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, glyphMessages, glyphLinks, glyphSettings } from "@workspace/db";
import { PrepareNativeMessageBody, PrepareNativeMessageResponse, SyncNativeMessagesResponse } from "@workspace/api-zod";
import { mailboxEmail, newToken } from "../lib/gmail";
import { syncNative } from "../lib/gmail-native";

// Mounted after glyphRouter: its shared cookie auth, verified mailbox ownership,
// same-origin write protection and no-store headers apply to every native route.
const router = Router();
router.post("/glyph/native/prepare", async (req, res): Promise<void> => {
  const ownerId = getAuth(req).userId;
  if (!ownerId) { res.status(401).json({ error: "Sign in to the Glyph connection tab." }); return; }
  const parsed = PrepareNativeMessageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Use one valid recipient, a subject and a message." }); return; }
  const data = parsed.data;
  if (data.senderEmail.toLowerCase() !== await mailboxEmail()) {
    res.status(403).json({ error: "The Gmail compose account does not match the connected mailbox." }); return;
  }
  if (!data.trackOpens && !data.trackClicks) { res.status(400).json({ error: "Enable open or link tracking to add a glyph." }); return; }
  const [settings] = await db.select().from(glyphSettings).where(eq(glyphSettings.ownerId, ownerId));
  const base = new URL(settings?.trackingBaseUrl || req.get("origin")!).origin;
  if (!base.startsWith("https://")) { res.status(400).json({ error: "Use an HTTPS Glyph connection." }); return; }
  const urls: string[] = [];
  for (const value of data.urls) {
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
      // Do not recursively wrap tracking links from quoted/forwarded copies.
      if (url.pathname.startsWith("/api/glyph/") || url.pathname === "/gmail") continue;
      urls.push(value);
    } catch { res.status(400).json({ error: "Only HTTP/HTTPS links without credentials can be tracked." }); return; }
  }
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(glyphMessages).where(and(eq(glyphMessages.ownerId, ownerId), eq(glyphMessages.nativeComposeKey, data.composeKey))).for("update");
    if (existing?.status === "sent") return null;
    const id = existing?.id ?? randomUUID();
    const pixelToken = existing?.pixelToken ?? newToken();
    const values = {
      recipientEmail: data.recipientEmail.toLowerCase(), recipientName: data.recipientName, subject: data.subject,
      body: data.body, trackOpens: data.trackOpens, trackClicks: data.trackClicks,
    };
    if (existing) await tx.update(glyphMessages).set(values).where(eq(glyphMessages.id, id));
    else await tx.insert(glyphMessages).values({
      ...values, id, ownerId, pixelToken, nativeComposeKey: data.composeKey, deliverySource: "gmail", rfcMessageId: `${id}@glyph.native`,
    });
    // Preserve tokens of unchanged URLs across reapplication in the same compose.
    const old = await tx.select().from(glyphLinks).where(eq(glyphLinks.messageId, id));
    const links = data.trackClicks ? [...new Set(urls)].map((url) =>
      old.find((l) => l.url === url) ?? { id: randomUUID(), messageId: id, token: newToken(), url }) : [];
    await tx.delete(glyphLinks).where(eq(glyphLinks.messageId, id));
    if (links.length) await tx.insert(glyphLinks).values(links);
    return { messageId: id, pixelUrl: data.trackOpens ? `${base}/api/glyph/t/${pixelToken}.gif` : null,
      markerUrl: `${base}/gmail?glyph=${pixelToken}`, links: links.map((l) => ({ url: l.url, trackingUrl: `${base}/api/glyph/l/${l.token}` })) };
  });
  if (!result) { res.status(409).json({ error: "This compose was already sent. Start a fresh Gmail compose." }); return; }
  res.json(PrepareNativeMessageResponse.parse(result));
});
router.post("/glyph/native/sync", async (req, res): Promise<void> => {
  const ownerId = getAuth(req).userId;
  if (!ownerId) { res.status(401).json({ error: "Sign in to Glyph." }); return; }
  res.json(SyncNativeMessagesResponse.parse(await syncNative(ownerId)));
});
export default router;
