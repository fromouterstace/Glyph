import { useState } from 'react';
import { BellRing, Globe } from 'lucide-react';
import {
  useGetSettings,
  useUpdateSettings,
  type SettingsInput,
} from '@workspace/api-client-react';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { GmailConnection } from '@/components/gmail-connection';
import { validTrackingOrigin } from '@/lib/tracking-origin';
import {
  Caveat,
  ReadOnlyTag,
  ErrorState,
  SectionHead,
  SignInNudge,
} from '@/components/bits';
import { errorText, useInvalidateAll, useSession } from '@/lib/glyph';
import { useToast } from '@/hooks/use-toast';

export default function SettingsPage() {
  const { isSignedIn } = useSession();
  const s = useGetSettings();
  const upd = useUpdateSettings();
  const invalidate = useInvalidateAll();
  const { toast } = useToast();
  const [edits, setForm] = useState<SettingsInput | null>(null);
  const saved = s.data ? editableSettings(s.data) : null;
  const form = edits ?? saved;

  const readOnly = s.data?.readOnly ?? !isSignedIn;
  const locked = !isSignedIn || readOnly;
  const url = form?.trackingBaseUrl.trim() ?? '';
  const urlBad = !validTrackingOrigin(url);
  const dirty = settingsChanged(form, saved);

  const save = () => {
    if (!form || urlBad) return;
    upd.mutate(
      { data: { ...form, trackingBaseUrl: url.replace(/\/$/, '') } },
      {
        onSuccess: (r) => {
          setForm(editableSettings(r));
          invalidate();
          toast({ title: 'Settings saved' });
        },
        onError: (e) =>
          toast({
            title: 'Could not save',
            description: errorText(e),
            variant: 'destructive',
          }),
      },
    );
  };

  const set = <K extends keyof SettingsInput>(k: K, v: SettingsInput[K]) => {
    if (form) setForm({ ...form, [k]: v });
  };

  return (
    <div className="max-w-3xl space-y-6">
      <SectionHead
        kicker="Configuration"
        title={
          <span className="flex items-center gap-3">
            Settings {readOnly && <ReadOnlyTag />}
          </span>
        }
      />
      {!isSignedIn && <SignInNudge what="change settings" />}

      <section className="border border-border bg-card">
        <Head title="Gmail connection" />
        <GmailConnection locked={locked} />
      </section>

      {s.isError ? (
        <ErrorState error={errorText(s.error)} onRetry={() => s.refetch()} />
      ) : !form ? (
        <Skeleton className="h-72" />
      ) : (
        <>
          <section className="border border-border bg-card">
            <Head title="Tracking defaults" />
            <Toggle
              id="default-opens"
              label="Embed open glyph"
              desc="Adds the 1x1 pixel when you click Add glyph in Gmail or compose here."
              checked={form.defaultTrackOpens}
              disabled={locked}
              onChange={(v) => set('defaultTrackOpens', v)}
            />
            <Toggle
              id="default-clicks"
              label="Track links"
              desc="Rewrites URLs in the body through a redirect."
              checked={form.defaultTrackClicks}
              disabled={locked}
              onChange={(v) => set('defaultTrackClicks', v)}
            />
            <div className="border-t border-border p-5">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Globe className="size-4" /> Tracking base URL
              </label>
              <input
                data-testid="input-tracking-url"
                disabled={locked}
                value={form.trackingBaseUrl}
                onChange={(e) => set('trackingBaseUrl', e.target.value)}
                placeholder={window.location.origin}
                maxLength={500}
                className="mt-2 h-10 w-full rounded-sm border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary disabled:opacity-60"
              />
              {urlBad && (
                <p className="mt-1 text-xs text-destructive">
                  Must be an HTTPS origin, e.g. https://glyph.yourco.app
                </p>
              )}
              <div className="mt-3">
                <Caveat>
                  Blank uses the current origin. For real sends, open the
                  published app and reconnect the Gmail extension there. Only
                  use a custom tracking origin that routes to the same backend
                  and message store; changing this URL alone does not move
                  development messages into production.
                </Caveat>
              </div>
            </div>
          </section>

          <section className="border border-border bg-card">
            <Head title="Alerts" />
            <Toggle
              id="notify-opens"
              label="Alert on open signals"
              desc="In-app toast when a new pixel load arrives."
              checked={form.notifyOpens}
              disabled={locked}
              onChange={(v) => set('notifyOpens', v)}
            />
            <Toggle
              id="notify-clicks"
              label="Alert on click signals"
              desc="In-app toast when a tracked link is followed."
              checked={form.notifyClicks}
              disabled={locked}
              onChange={(v) => set('notifyClicks', v)}
            />
            <Toggle
              id="notify-replies"
              label="Alert on replies"
              desc="In-app toast when Gmail sync finds a reply referencing a tracked message."
              checked={form.notifyReplies ?? true}
              disabled={locked}
              onChange={(v) => set('notifyReplies', v)}
            />
            <BrowserNotifications locked={locked} />
          </section>

          <div className="flex justify-end">
            <button
              data-testid="button-save-settings"
              disabled={locked || !dirty || urlBad || upd.isPending}
              onClick={save}
              className="rounded-sm bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-transform hover:bg-primary/90 active:scale-[0.98] disabled:opacity-40 disabled:shadow-none"
            >
              {upd.isPending ? 'Saving...' : dirty ? 'Save changes' : 'Saved'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function editableSettings({
  readOnly: _readOnly,
  ...settings
}: SettingsInput & { readOnly?: boolean }): SettingsInput {
  return { ...settings, notifyReplies: settings.notifyReplies ?? true };
}

function settingsChanged(
  form: SettingsInput | null,
  saved: SettingsInput | null,
) {
  return (
    !!form &&
    !!saved &&
    (Object.keys(form) as (keyof SettingsInput)[]).some(
      (key) => form[key] !== saved[key],
    )
  );
}

function BrowserNotifications({ locked }: { locked: boolean }) {
  const { toast } = useToast();
  const [perm, setPerm] = useState<string>(
    typeof Notification !== 'undefined'
      ? Notification.permission
      : 'unsupported',
  );
  async function askPerm() {
    if (typeof Notification === 'undefined') return;
    try {
      setPerm(await Notification.requestPermission());
    } catch (error) {
      toast({
        title: 'Could not enable notifications',
        description: errorText(error),
        variant: 'destructive',
      });
    }
  }
  const labels: Record<string, string> = {
    granted: 'Enabled',
    denied: 'Blocked in browser settings',
    unsupported: 'Not supported here',
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-5 text-sm">
      <div>
        <div className="flex items-center gap-2 font-medium">
          <BellRing className="size-4" /> Browser notifications
        </div>
        <p className="text-xs text-muted-foreground">
          Only new live events while this tab is open. The Gmail extension also
          notifies while your browser and its connection tab are running. Sample
          data never alerts.
        </p>
      </div>
      {labels[perm] ? (
        <span
          className={
            perm === 'granted'
              ? 'font-mono text-xs text-accent-foreground'
              : 'text-xs text-muted-foreground'
          }
          data-testid="text-notify-permission"
        >
          {labels[perm]}
        </span>
      ) : (
        <button
          data-testid="button-enable-notifications"
          disabled={locked}
          onClick={askPerm}
          className="rounded-sm border border-border px-3 py-1.5 text-xs font-medium hover:border-foreground/40 disabled:opacity-40"
        >
          Enable
        </button>
      )}
    </div>
  );
}

function Head({ title }: { title: string }) {
  return (
    <div className="border-b border-border px-5 py-3 font-display text-lg font-bold">
      {title}
    </div>
  );
}
function Toggle({
  id,
  label,
  desc,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  desc: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 border-t border-border p-5 first-of-type:border-t-0">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      <Switch
        data-testid={`switch-${id}`}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </label>
  );
}
