import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ComposerDeliveryNotice } from '../src/components/composer-delivery';
import { composerDeliveryIssue } from '../src/lib/composer-delivery';
afterEach(cleanup);

it('opens the published web composer separately and explains that drafts do not transfer', () => {
  render(
    <ComposerDeliveryNotice
      issue={composerDeliveryIssue('https://preview.replit.dev', '')}
      recheck={vi.fn()}
    />,
  );
  const link = screen.getByRole('link', {
    name: 'Open published Glyph web composer',
  });
  expect(link.getAttribute('href')).toBe('https://glyph.rocks/emails');
  expect(link.getAttribute('target')).toBe('_blank');
  expect(screen.getByRole('note').textContent).toContain(
    'do not transfer automatically',
  );
});
it('provides settings recovery and an explicit recheck without navigating the draft away', () => {
  const recheck = vi.fn();
  render(
    <ComposerDeliveryNotice
      issue={composerDeliveryIssue(
        'https://glyph.example',
        'https://other.example',
      )}
      recheck={recheck}
    />,
  );
  expect(
    screen.getByRole('link', { name: 'Open Settings' }).getAttribute('target'),
  ).toBe('_blank');
  fireEvent.click(screen.getByRole('button', { name: 'Recheck settings' }));
  expect(recheck).toHaveBeenCalledOnce();
});
it('does not show a blocking notice for valid production configuration', () => {
  render(<ComposerDeliveryNotice issue={null} recheck={vi.fn()} />);
  expect(screen.queryByRole('note')).toBeNull();
});
