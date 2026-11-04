import { useEffect, useState } from 'react';
import { CheckCircle2, CircleSlash, BellRing, Globe } from 'lucide-react';
import { useGetSettings, useGetConnection, useUpdateSettings, type SettingsInput } from '@workspace/api-client-react';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Caveat, DemoTag, ErrorState, SectionHead, SignInNudge } from '@/components/bits';
import { errorText, useInvalidateAll, useSession } from '@/lib/glyph';
import { useToast } from '@/hooks/use-toast';

export default function SettingsPage() {
  const { isSignedIn } = useSession();
  const s = useGetSettings();
  const c = useGetConnection();
  const upd = useUpdateSettings();
  const invalidate = useInvalidateAll();
  const { toast } = useToast();
  const [form, setForm] = useState<SettingsInput | null>(null);
  const [perm, setPerm] = useState<string>(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');

  useEffect(() => {
    if (s.data && !form) {
      const { isDemo: _d, ...rest } = s.data;
      setForm(rest);
    }
  }, [s.data, form]);

  const isDemo = s.data?.isDemo ?? !isSignedIn;
  const locked = !isSignedIn || isDemo;
  const url = form?.trackingBaseUrl.trim() ?? '';
  const urlBad = url !== '' && !/^https:\/\/[^\s/]+(\/.*)?$/.test(url);
  const dirty = !!(form && s.data && (Object.keys(form) as (keyof SettingsInput)[]).some((k) => form[k] !== s.data![k]));

  const save = () => {
    if (!form || urlBad) return;
    upd.mutate({ data: { ...form, trackingBaseUrl: url.replace(/\/$/, '') } }, {
      onSuccess: (r) => { const { isDemo: _d, ...rest } = r; setForm(rest); invalidate(); toast({ title: 'Settings saved' }); },
      onError: (e) => toast({ title: 'Could not save', description: errorText(e), variant: 'destructive' }),
    });
  };

  const askPerm = async () => {
    if (typeof Notification === 'undefined') return;
    const r = await Notification.requestPermission();
    setPerm(r);
  };

  const set = <K extends keyof SettingsInput>(k: K, v: SettingsInput[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <div className="max-w-3xl space-y-6">
      <SectionHead kicker="Configuration" title={<span className="flex items-center gap-3">Settings {isDemo && <DemoTag />}</span>} />
      {!isSignedIn && <SignInNudge what="change settings" />}

      <section className="border border-border bg-card">
        <Head title="Gmail connection" />
        <div className="p-5">
          {c.isLoading ? <Skeleton className="h-16" /> : c.isError ? <ErrorState error={errorText(c.error)} onRetry={() => c.refetch()} /> : c.data && (
            <div className="flex gap-4">
              <span className={`flex size-10 shrink-0 items-center justify-center rounded-sm ${c.data.connected && c.data.authorized ? 'bg-accent text-accent-foreground' : 'bg-secondary text-muted-foreground'}`}>
                {c.data.connected && c.data.authorized ? <CheckCircle2 className="size-5" /> : <CircleSlash className="size-5" />}
              </span>
              <div className="space-y-1 text-sm">
                <div className="font-medium" data-testid="text-connection-status">
                  {!c.data.connected ? 'Gmail not connected' : c.data.authorized ? 'Connected and authorized to send' : 'Gmail connected, but not to this account'}
                </div>
                {c.data.email && <div className="font-mono text-xs" data-testid="text-connection-email">{c.data.email}</div>}
                <p className="text-muted-foreground" data-testid="text-connection-message">{c.data.message}</p>
                <p className="text-xs text-muted-foreground">To send, sign in with a verified account whose email matches the connected Gmail mailbox. Other accounts see only their own (empty) data and cannot send.</p>
              </div>
            </div>
          )}
        </div>
      </section>

      {s.isError ? <ErrorState error={errorText(s.error)} onRetry={() => s.refetch()} /> : !form ? <Skeleton className="h-72" /> : (
        <>
          <section className="border border-border bg-card">
            <Head title="Tracking defaults" />
            <Toggle id="default-opens" label="Embed open glyph" desc="Adds the 1x1 pixel to new drafts." checked={form.defaultTrackOpens} disabled={locked} onChange={(v) => set('defaultTrackOpens', v)} />
            <Toggle id="default-clicks" label="Track links" desc="Rewrites URLs in the body through a redirect." checked={form.defaultTrackClicks} disabled={locked} onChange={(v) => set('defaultTrackClicks', v)} />
            <div className="border-t border-border p-5">
              <label className="flex items-center gap-2 text-sm font-medium"><Globe className="size-4" /> Tracking base URL</label>
              <input data-testid="input-tracking-url" disabled={locked} value={form.trackingBaseUrl} onChange={(e) => set('trackingBaseUrl', e.target.value)} placeholder={window.location.origin} maxLength={500} className="mt-2 h-10 w-full rounded-sm border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary disabled:opacity-60" />
              {urlBad && <p className="mt-1 text-xs text-destructive">Must be an HTTPS origin, e.g. https://glyph.yourco.app</p>}
              <div className="mt-3"><Caveat>Blank uses the current origin. Preview URLs are temporary, so pixels and links in already-sent emails will break when they change. Publish the app and paste its HTTPS address here for reliable tracking.</Caveat></div>
            </div>
          </section>

          <section className="border border-border bg-card">
            <Head title="Alerts" />
            <Toggle id="notify-opens" label="Alert on open signals" desc="In-app toast when a new pixel load arrives." checked={form.notifyOpens} disabled={locked} onChange={(v) => set('notifyOpens', v)} />
            <Toggle id="notify-clicks" label="Alert on click signals" desc="In-app toast when a tracked link is followed." checked={form.notifyClicks} disabled={locked} onChange={(v) => set('notifyClicks', v)} />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-5 text-sm">
              <div>
                <div className="flex items-center gap-2 font-medium"><BellRing className="size-4" /> Browser notifications</div>
                <p className="text-xs text-muted-foreground">Only new live events while Glyph is open. History and sample data never alert.</p>
              </div>
              {perm === 'granted' ? <span className="font-mono text-xs text-accent-foreground" data-testid="text-notify-permission">Enabled</span>
                : perm === 'denied' ? <span className="text-xs text-muted-foreground" data-testid="text-notify-permission">Blocked in browser settings</span>
                : perm === 'unsupported' ? <span className="text-xs text-muted-foreground">Not supported here</span>
                : <button data-testid="button-enable-notifications" disabled={locked} onClick={askPerm} className="rounded-sm border border-border px-3 py-1.5 text-xs font-medium hover:border-foreground/40 disabled:opacity-40">Enable</button>}
            </div>
          </section>

          <div className="sticky bottom-4 flex justify-end">
            <button data-testid="button-save-settings" disabled={locked || !dirty || urlBad || upd.isPending} onClick={save} className="rounded-sm bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-transform hover:bg-primary/90 active:scale-[0.98] disabled:opacity-40 disabled:shadow-none">
              {upd.isPending ? 'Saving...' : dirty ? 'Save changes' : 'Saved'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Head({ title }: { title: string }) {
  return <div className="border-b border-border px-5 py-3 font-display text-lg font-bold">{title}</div>;
}
function Toggle({ id, label, desc, checked, disabled, onChange }: { id: string; label: string; desc: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 border-t border-border p-5 first-of-type:border-t-0">
      <div><div className="text-sm font-medium">{label}</div><div className="text-xs text-muted-foreground">{desc}</div></div>
      <Switch data-testid={`switch-${id}`} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  );
}
