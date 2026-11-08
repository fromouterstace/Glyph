// Used both when accepting a signal and immediately before sending its alert.
export function wantsEmailAlert(
  settings:
    | {
        emailAlerts: boolean;
        emailAlertsSince: Date | null;
        alertMailbox?: string | null;
        notifyOpens: boolean;
        notifyClicks: boolean;
      }
    | undefined,
  event: { type: string; automated: boolean; occurredAt: Date },
  consentAt?: Date,
) {
  return (
    !!settings?.emailAlerts &&
    !!settings.emailAlertsSince &&
    !!settings.alertMailbox &&
    !event.automated &&
    event.occurredAt >= settings.emailAlertsSince &&
    (!consentAt ||
      consentAt.getTime() === settings.emailAlertsSince.getTime()) &&
    ((event.type === 'open' && settings.notifyOpens) ||
      (event.type === 'click' && settings.notifyClicks))
  );
}

export const alertCaveat =
  'This is an approximate engagement signal, not proof that a human read your email or that the intended recipient acted. Image proxies, security scanners and forwarding can affect signals.';

// The connector doesn't expose an abort signal. Stop waiting, but treat any
// timed-out send as uncertain: the underlying request may still succeed.
export async function withinDeadline<T>(
  operation: Promise<T>,
  ms = 20_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Alert provider deadline exceeded')),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export interface AlertTransport {
  claim(): Promise<boolean>;
  send(): Promise<string>;
  reconcile(): Promise<string | null>;
  finish(status: 'sent' | 'uncertain', gmailId?: string): Promise<void>;
}

export async function deliverAlert(status: string, transport: AlertTransport) {
  if (status !== 'pending') {
    // A crash after Gmail accepted a message is indistinguishable from a lost
    // response. Never resend, even if Gmail's search hasn't indexed it yet.
    const id = await transport.reconcile();
    await transport.finish(id ? 'sent' : 'uncertain', id ?? undefined);
    return;
  }
  if (!(await transport.claim())) return;
  let id: string;
  try {
    id = await transport.send();
  } catch {
    await transport.finish('uncertain');
    return;
  }
  // A failed DB write here leaves "sending", which is reconciled, not retried.
  await transport.finish('sent', id);
}
