import { Router } from "express";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, glyphEvents, glyphLinks, glyphMessages } from "@workspace/db";
import { syncNative } from "../lib/gmail-native";

const router = Router();
const transparentGif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

async function recordSignal(messageId: string, token: string, type: "open" | "click", agent: string, url: string | null) {
  const automated = /bot|crawler|spider|scanner|safelinks|proofpoint|barracuda|mimecast|headless|preview/i.test(agent);
  const proxy = /googleimageproxy|ggpht|google.*proxy/i.test(agent);
  const source = automated ? "Suspected automated scanner" : proxy ? "Google image proxy — open signal only" : "Unverified client request";
  const bucket = Math.floor(Date.now() / 60_000);
  const fingerprint = createHash("sha256").update(`${token}:${type}:${agent}:${bucket}`).digest("hex");
  await db.insert(glyphEvents).values({
    id: randomUUID(), messageId, type, url, automated, source, fingerprint,
  }).onConflictDoNothing();
}

router.get("/glyph/t/:token", async (req, res): Promise<void> => {
  res.set({ "Cache-Control": "no-store, no-cache, must-revalidate, private, max-age=0", Pragma: "no-cache", Expires: "0", "Content-Type": "image/gif", "X-Content-Type-Options": "nosniff" });
  if (req.method !== "HEAD") {
    try {
      const token = String(req.params.token).replace(/\.gif$/, "");
      if (/^[a-f0-9]{48}$/.test(token)) {
        let [message] = await db.select().from(glyphMessages).where(eq(glyphMessages.pixelToken, token));
        // A directly embedded compose image is fetched by the sender's browser.
        // Do not count that as recipient engagement or scan Sent unnecessarily.
        const composeReferrer = /^https:\/\/mail\.google\.com(?:\/|$)/.test(req.get("referer") ?? "");
        if (message?.deliverySource === "gmail" && message.status === "draft" && composeReferrer) {
          res.send(transparentGif); return;
        }
        if (message?.deliverySource === "gmail" && message.status === "draft") {
          await syncNative(message.ownerId, true);
          [message] = await db.select().from(glyphMessages).where(eq(glyphMessages.pixelToken, token));
        }
        if (message?.trackOpens && ["sent", "sending", "uncertain"].includes(message.status))
          await recordSignal(message.id, token, "open", req.get("user-agent") ?? "", null);
      }
    } catch (err) { req.log.warn({ err }, "Pixel signal could not be recorded"); }
  }
  res.send(transparentGif);
});

router.get("/glyph/l/:token", async (req, res): Promise<void> => {
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" });
  const token = String(req.params.token);
  if (!/^[a-f0-9]{48}$/.test(token)) { res.status(404).send("Link not found"); return; }
  const [row] = await db.select({ link: glyphLinks, message: glyphMessages }).from(glyphLinks)
    .innerJoin(glyphMessages, eq(glyphLinks.messageId, glyphMessages.id)).where(eq(glyphLinks.token, token));
  if (!row) { res.status(404).send("Link not found"); return; }
  if (row.message.deliverySource === "gmail" && row.message.status === "draft") {
    try {
      await syncNative(row.message.ownerId, true);
      const [current] = await db.select().from(glyphMessages).where(eq(glyphMessages.id, row.message.id));
      row.message = current;
    } catch (err) { req.log.warn({ err }, "Native send verification deferred"); }
  }
  const canRecord = ["sent", "sending", "uncertain"].includes(row.message.status);
  // Links must still work during Gmail's Undo Send delay or while confirmation is pending.
  if (!canRecord && row.message.deliverySource !== "gmail") { res.status(404).send("Link not found"); return; }
  const url = new URL(row.link.url);
  if (!["https:", "http:"].includes(url.protocol)) { res.status(400).send("Invalid link"); return; }
  if (req.method !== "HEAD" && canRecord && row.message.trackClicks) {
    try { await recordSignal(row.message.id, token, "click", req.get("user-agent") ?? "", row.link.url); }
    catch (err) { req.log.warn({ err }, "Click signal could not be recorded"); }
  }
  res.redirect(302, row.link.url);
});

export default router;
