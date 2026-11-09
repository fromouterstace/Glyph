import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PixelDiagnostics } from '../src/components/pixel-diagnostics';
import type { PixelDiagnostics as Diagnostics } from '@workspace/api-client-react';

afterEach(cleanup);

const data: Diagnostics = {
  preparedTrackingOrigin: null,
  pixelOutcomes: [
    { outcome: 'recorded', requests: 2 },
    { outcome: 'sender_compose_ignored', requests: 3 },
    { outcome: 'tracking_disabled', requests: 4 },
    { outcome: 'send_not_confirmed', requests: 5 },
    { outcome: 'unknown_token', requests: null },
    { outcome: 'event_budget_exceeded', requests: 6 },
    { outcome: 'native_reconciliation_budget_exceeded', requests: 7 },
    { outcome: 'native_reconciliation_failed', requests: 8 },
  ],
};

describe('pixel diagnostics', () => {
  it('keeps request outcomes distinct and does not invent historical attribution', () => {
    render(<PixelDiagnostics data={data} />);
    for (const label of [
      'Recorded',
      'Sender-compose ignored',
      'Tracking disabled',
      'Send unconfirmed',
      'Unknown token',
      'Pixel event budget exceeded',
      'Send verification budget exceeded',
      'Send verification unavailable',
    ])
      expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText('Not recorded')).toBeTruthy();
    expect(screen.getByText('Unattributed')).toBeTruthy();
    expect(
      screen.getByText(/no historical loads have been reconstructed/),
    ).toBeTruthy();
    expect(screen.getByText(/not additional pixel loads/)).toBeTruthy();
    expect(screen.getByText('Recorded').parentElement?.textContent).toBe(
      'Recorded2',
    );
  });

  it('updates the recorded origin and counters when polling returns fresh data', () => {
    const view = render(<PixelDiagnostics data={data} />);
    view.rerender(
      <PixelDiagnostics
        data={{
          preparedTrackingOrigin: 'https://glyph.example',
          pixelOutcomes: [{ outcome: 'recorded', requests: 9 }],
        }}
      />,
    );
    expect(screen.getByText('https://glyph.example')).toBeTruthy();
    expect(screen.queryByText('Not recorded')).toBeNull();
    expect(screen.getByText('Recorded').parentElement?.textContent).toBe(
      'Recorded9',
    );
  });
});
