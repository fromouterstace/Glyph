import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import {
  RichEmailEditor,
  RichEmailPreview,
  normalizeLinkUrl,
  plainTextToHtml,
  FONT_FAMILIES,
} from '@/components/rich-email-editor';

const editor = () =>
  (screen.getByTestId('input-body') as HTMLElement & { editor: Editor }).editor;
const click = (id: string) => fireEvent.click(screen.getByTestId(id));
beforeEach(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
    }),
  });
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => null,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('renders saved formatting read-only and follows fresh server content without an editing toolbar', () => {
  const view = render(
    <RichEmailPreview html="<p><strong>Saved formatting</strong></p>" />,
  );
  expect(screen.getByText('Saved formatting').tagName).toBe('STRONG');
  expect(screen.queryByTestId('toolbar-body-format')).toBeNull();
  expect(screen.getByRole('document').getAttribute('contenteditable')).toBe(
    'false',
  );
  view.rerender(<RichEmailPreview html="<p><em>Updated formatting</em></p>" />);
  expect(screen.getByText('Updated formatting').tagName).toBe('EM');
});
it('applies bold, italic, underline, font and size without changing plain text', () => {
  const changed = vi.fn();
  render(<RichEmailEditor value="<p>Hello</p>" onChange={changed} />);
  act(() => {
    editor().commands.selectAll();
  });
  click('button-format-bold');
  click('button-format-italic');
  click('button-format-underline');
  fireEvent.change(screen.getByTestId('select-font-family'), {
    target: { value: FONT_FAMILIES[1].value },
  });
  fireEvent.change(screen.getByTestId('select-font-size'), {
    target: { value: '18px' },
  });
  expect(editor().getHTML()).toMatch(/<strong>/);
  expect(editor().getHTML()).toMatch(/<em>/);
  expect(editor().getHTML()).toMatch(/<u>/);
  expect(editor().getHTML()).toMatch(/font-size: 18px/);
  expect(editor().getHTML()).toMatch(/font-family:/);
  expect(changed.mock.lastCall?.[1]).toBe('Hello');
});
it('supports lists, alignment, undo and redo', () => {
  render(<RichEmailEditor value="<p>Hello</p>" onChange={vi.fn()} />);
  act(() => {
    editor().commands.selectAll();
  });
  click('button-list-bullet');
  expect(editor().getHTML()).toContain('<ul>');
  click('button-align-center');
  expect(editor().getHTML()).toContain('text-align: center');
  const formatted = editor().getHTML();
  click('button-undo');
  expect(editor().getHTML()).not.toBe(formatted);
  click('button-redo');
  expect(editor().getHTML()).toBe(formatted);
});
it('inserts a link on selected text and rejects unsafe destinations', () => {
  vi.spyOn(window, 'prompt').mockReturnValue('https://example.org/offer');
  render(<RichEmailEditor value="<p>Hello</p>" onChange={vi.fn()} />);
  act(() => {
    editor().commands.selectAll();
  });
  click('button-format-link');
  expect(editor().getHTML()).toContain('href="https://example.org/offer"');
  expect(editor().getText()).toBe('Hello');
  expect(normalizeLinkUrl('javascript:alert(1)')).toBeNull();
  expect(normalizeLinkUrl('https://user:password@example.org')).toBeNull();
  expect(normalizeLinkUrl('example.org')).toBe('https://example.org/');
  expect(normalizeLinkUrl('mailto:sender@example.org')).toBe(
    'mailto:sender@example.org',
  );
});
it('preserves local content across polling and resets only on a new session key', () => {
  const changed = vi.fn();
  const view = render(
    <RichEmailEditor key="first" value="<p>Saved</p>" onChange={changed} />,
  );
  act(() => {
    editor().commands.setContent('<p><strong>Unsaved</strong></p>');
  });
  view.rerender(
    <RichEmailEditor key="first" value="<p>Polled</p>" onChange={changed} />,
  );
  expect(editor().getHTML()).toContain('<strong>Unsaved</strong>');
  view.rerender(
    <RichEmailEditor
      key="second"
      value="<p>Different message</p>"
      onChange={changed}
    />,
  );
  expect(editor().getText()).toBe('Different message');
});
it('escapes legacy text, strips unsupported active markup and disables editing', () => {
  expect(plainTextToHtml('<b>plain</b>\nnext\n\nlast')).toBe(
    '<p>&lt;b&gt;plain&lt;/b&gt;<br>next</p><p>last</p>',
  );
  const view = render(
    <RichEmailEditor
      value="<p>Hello<img src=x onerror=bad()></p><script>bad()</script>"
      onChange={vi.fn()}
    />,
  );
  expect(editor().getHTML()).not.toMatch(/img|onerror|script/);
  view.rerender(<RichEmailEditor value="" disabled onChange={vi.fn()} />);
  expect(screen.getByTestId('input-body').getAttribute('contenteditable')).toBe(
    'false',
  );
  expect(
    (screen.getByTestId('button-format-bold') as HTMLButtonElement).disabled,
  ).toBe(true);
});
