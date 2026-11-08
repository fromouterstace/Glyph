import { useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { Download, Copy, Check, ArrowUpRight } from 'lucide-react';
import { Caveat, SectionHead } from '@/components/bits';
import { GMAIL_URL } from '@/components/gmail-sync';
import { GmailAuthorization } from '@/components/gmail-authorization';
import { useSession } from '@/lib/glyph';
import { extensionConnectionOrigin } from '@/lib/tracking-origin';

const zipUrl = `${import.meta.env.BASE_URL}glyph-extension.zip`;

export default function GmailPage() {
  const { isSignedIn } = useSession();
  const origin = extensionConnectionOrigin(window.location.origin);
  const preview = origin !== window.location.origin;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(origin);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  const steps: { t: string; d: ReactNode }[] = [
    {
      t: 'Download and extract',
      d: (
        <>
          Get the ZIP below and extract it. You will get a folder named{' '}
          <code className="font-mono">glyph-extension</code>.
        </>
      ),
    },
    {
      t: 'Enable Developer mode',
      d: (
        <>
          Open <code className="font-mono">chrome://extensions</code> or{' '}
          <code className="font-mono">edge://extensions</code> and switch on
          Developer mode.
        </>
      ),
    },
    {
      t: 'Load unpacked',
      d: (
        <>
          Click Load unpacked and choose the extracted{' '}
          <code className="font-mono">glyph-extension</code> folder. Pin the
          extension to your toolbar.
        </>
      ),
    },
    {
      t: 'Connect to published Glyph',
      d: (
        <>
          The extension is fixed to the verified published origin. Confirm it
          matches the address below, then click Connect. Do not use this
          development preview address.
          <span className="mt-2 flex items-center gap-2 rounded-sm border border-border bg-background px-3 py-2">
            <code
              className="min-w-0 flex-1 truncate font-mono text-xs"
              data-testid="text-origin"
            >
              {origin}
            </code>
            <button
              type="button"
              onClick={copy}
              data-testid="button-copy-origin"
              className="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"
            >
              {copied ? (
                <>
                  <Check className="size-3" /> Copied
                </>
              ) : (
                <>
                  <Copy className="size-3" /> Copy
                </>
              )}
            </button>
          </span>
        </>
      ),
    },
    {
      t: 'Sign in on the connection tab',
      d: (
        <>
          A Glyph connection tab opens. Sign in with the verified email that
          matches your Gmail. Then click Connect Gmail on that page and approve
          access to the same mailbox. Signing in to Glyph alone does not connect
          Gmail. Keep that tab open; it can sit in the background while the
          extension works.
        </>
      ),
    },
    {
      t: 'Compose in Gmail',
      d: (
        <>
          Reload Gmail. Compose with To, Cc and Bcc recipients. Click Add glyph
          in the compose window, then send with Gmail's own Send button or
          Ctrl/Cmd+Enter.
        </>
      ),
    },
  ];

  return (
    <div className="max-w-4xl space-y-8">
      <SectionHead
        kicker="Native Gmail"
        title="Track from inside Gmail."
        right={
          <div className="flex flex-wrap gap-2">
            <a
              href={zipUrl}
              download
              data-testid="link-download-extension"
              className="inline-flex items-center gap-2 rounded-sm bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <Download className="size-4" /> Download extension
            </a>
            <a
              href={GMAIL_URL}
              target="_blank"
              rel="noreferrer"
              data-testid="link-open-gmail"
              className="inline-flex items-center gap-2 rounded-sm border border-border bg-card px-4 py-2.5 text-sm font-medium hover:border-foreground/40"
            >
              Open Gmail <ArrowUpRight className="size-4" />
            </a>
          </div>
        }
      />
      <p className="max-w-2xl text-sm text-muted-foreground">
        Write in Gmail like you always do. The Glyph extension adds a pixel and
        wraps links in the draft only when you click Add glyph. It never sends
        through the API and never intercepts Send. Glyph stays here as your
        reporting and connection companion.
      </p>

      {preview && (
        <Caveat>
          <strong>Production connection required.</strong> This preview cannot
          prepare tracked sends. Connect the extension to{' '}
          <a
            href={`${origin}/gmail`}
            className="font-semibold text-primary underline"
          >
            {origin}/gmail
          </a>
          , sign in there, and start a fresh Gmail compose. View its signals on
          the published dashboard. Previously sent preview pixels cannot be
          moved to production.
        </Caveat>
      )}

      {isSignedIn && <GmailAuthorization />}

      <ol className="border-l border-t border-border bg-card">
        {steps.map((s, i) => (
          <li
            key={i}
            className="grid grid-cols-[48px_minmax(0,1fr)] border-b border-r border-border"
            data-testid={`step-${i + 1}`}
          >
            <span className="border-r border-border p-4 font-mono text-xs text-primary">
              0{i + 1}
            </span>
            <div className="p-4">
              <div className="font-display text-base font-bold">{s.t}</div>
              <div className="mt-1 text-sm text-muted-foreground">{s.d}</div>
            </div>
          </li>
        ))}
      </ol>

      <section
        className="border border-border bg-card p-5"
        data-testid="section-update-extension"
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
          Already installed? Update to v0.5.5
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Tracking controls have their own compact row above Gmail’s Send
          controls, outside the outgoing message. If disconnected, Connect Glyph
          opens extension setup rather than attempting to add tracking. Connects
          only to glyph.rocks, where you sign in and connect your Gmail account.
          An older glyph-mail.replit.app extension connection is cleared on
          update; reconnect and approve access to glyph.rocks. Refreshes open
          Gmail tabs after extension updates, browser startup, and reconnect.
          Updated scripts hand over without reloading Gmail or sending your
          draft. Older scripts may need one manual Gmail reload after the draft
          is saved.
        </p>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm">
          <li>Download the new ZIP above and extract it.</li>
          <li>
            Replace the files inside your original unpacked{' '}
            <code className="font-mono">glyph-extension</code> folder with the
            new ones (keep the same folder location).
          </li>
          <li>
            Open{' '}
            <code className="break-all font-mono">chrome://extensions</code> or{' '}
            <code className="break-all font-mono">edge://extensions</code> and
            click Reload on Glyph.
          </li>
          <li>
            Reconnect to the verified published origin above and sign in on its
            connection tab. Do not enter a custom or preview address.
          </li>
          <li>
            Reload Gmail and use a fresh compose; old tracked drafts retain old
            pixels.
          </li>
        </ol>
      </section>
      <Caveat>
        <strong>Extension updated while Gmail was open?</strong> Chrome can
        invalidate the script in an existing Gmail tab. Wait until Gmail saves
        your draft, then reload that Gmail tab. The new extension offers a
        Reload Gmail action rather than displaying a sendMessage error. If the
        problem continues, reload Glyph in chrome://extensions, reopen its
        popup, and reconnect to the published app. No reload happens
        automatically.
      </Caveat>
      <section className="grid gap-px border border-border bg-border text-sm md:grid-cols-2">
        {[
          [
            'When is it sent?',
            'A native draft becomes sent only after Glyph finds its marker in your Gmail Sent folder. Until then it stays Awaiting Gmail send. Use Sync Gmail status to check now.',
          ],
          [
            'Notifications',
            'The extension raises browser notifications for pixel loads and tracked-link requests while the browser and the connection tab are running.',
          ],
          [
            'Where it works',
            'Desktop Chrome and Edge only. Gmail DOM integration is experimental and may break when Gmail changes its layout.',
          ],
          [
            'Plain-text mode',
            'Gmail plain-text compose cannot carry a pixel or wrapped links, so those messages are not tracked.',
          ],
        ].map(([k, v]) => (
          <div key={k} className="bg-card p-5">
            <div className="font-mono text-[10px] uppercase tracking-wider text-primary">
              {k}
            </div>
            <p className="mt-2 text-muted-foreground">{v}</p>
          </div>
        ))}
      </section>

      <Caveat>
        <strong>Individual Gmail authorization.</strong> Each Glyph user
        connects one Gmail mailbox matching a verified email on their account.
        Gmail must compose from that linked mailbox. Installing the extension
        does not grant access to another user's mail. Disconnecting removes
        personal credentials, not saved messages or recipient tracking links.
      </Caveat>
      <Caveat>
        <strong>Browser permissions.</strong> Gmail access lets the extension
        add controls and edit the current compose. You separately approve only
        the verified published Glyph origin for the signed-in connection bridge.
        The extension does not accept user-entered hosts. On update, it removes
        any previously stored untrusted host permission and connection state.
        Storage keeps connection preferences, alarms check status, and
        notifications show engagement signals. No Gmail passwords, OAuth tokens
        or app session cookies are copied into extension storage. Disconnect in
        the popup to revoke the Glyph origin permission.
      </Caveat>
      <Caveat>
        <strong>Developer build, not a store listing.</strong> This is a local
        unpacked extension, not published on the Chrome Web Store. Long-term it
        connects only to the verified published origin. Preview and custom
        domains are blocked; supporting a new domain requires a reviewed
        extension update.{' '}
        {!isSignedIn && (
          <Link
            href="/sign-in"
            className="font-semibold text-primary hover:underline"
          >
            Sign in to connect.
          </Link>
        )}
      </Caveat>
    </div>
  );
}
