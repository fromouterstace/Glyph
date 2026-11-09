import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ImportedTag,
  importProblem,
  isImported,
} from '../src/components/label-import';

describe('label import UI', () => {
  it('labels imported messages without implying tracking', () => {
    const html = renderToStaticMarkup(<ImportedTag />);
    expect(html).toContain('Imported');
    expect(html).toContain('No historical tracking');
    expect(isImported({ deliverySource: 'import' })).toBe(true);
    expect(isImported({ deliverySource: 'gmail' })).toBe(false);
  });

  it('maps connection and missing-label problems', () => {
    expect(importProblem(undefined, { status: 403 })?.kind).toBe('connection');
    expect(
      importProblem({ status: 'label_missing', lastSyncedAt: null }, null)
        ?.kind,
    ).toBe('label');
    expect(
      importProblem({ status: 'synced', lastSyncedAt: null }, null),
    ).toBeNull();
  });
});
