import { useEffect, useState, type ReactNode } from 'react';
import {
  useEditor,
  useEditorState,
  EditorContent,
  type Editor,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Link2,
  Undo2,
  Redo2,
  RemoveFormatting,
} from 'lucide-react';

export type RichEmailEditorProps = {
  value: string;
  plainText?: string;
  onChange: (html: string, text: string) => void;
  disabled?: boolean;
  placeholder?: string;
};

export const FONT_FAMILIES = [
  { label: 'Default', value: '' },
  { label: 'Sans', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Mono', value: '"Courier New", Courier, monospace' },
];
export const FONT_SIZES = ['', '12px', '14px', '16px', '18px', '24px'];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Converts legacy plain text into paragraph HTML (escaped). */
export function plainTextToHtml(text: string): string {
  if (!text) return '';
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function normalizeLinkUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    if (u.username || u.password) return null;
    return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

function buildExtensions() {
  return [
    StarterKit.configure({
      heading: false,
      codeBlock: false,
      code: false,
      horizontalRule: false,
      blockquote: false,
      strike: false,
      link: {
        openOnClick: false,
        autolink: true,
        protocols: ['http', 'https', 'mailto'],
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      },
    }),
    TextStyleKit.configure({
      backgroundColor: false,
      lineHeight: false,
    }),
    TextAlign.configure({ types: ['paragraph'] }),
  ];
}

function emit(editor: Editor, onChange: RichEmailEditorProps['onChange']) {
  onChange(
    editor.isEmpty ? '' : editor.getHTML(),
    editor.getText({ blockSeparator: '\n' }),
  );
}

function useRichEditor(props: RichEmailEditorProps) {
  const { value, plainText, onChange, disabled, placeholder } = props;
  // Captured once: later prop rerenders never overwrite user edits.
  const [initial] = useState(() => value || plainTextToHtml(plainText ?? ''));
  return useEditor({
    extensions: buildExtensions(),
    content: initial,
    editable: !disabled,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Message body',
        'data-testid': 'input-body',
        'data-placeholder': placeholder ?? 'Write your message',
        class:
          'glyph-rte max-h-[320px] min-h-[180px] overflow-y-auto px-5 py-4 text-sm leading-relaxed outline-none',
      },
    },
    onUpdate: ({ editor }) => emit(editor, onChange),
  });
}

function useToolbarState(editor: Editor) {
  return useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      link: e.isActive('link'),
      align: (['center', 'right'].find((a) => e.isActive({ textAlign: a })) ??
        'left') as string,
      font:
        (e.getAttributes('textStyle').fontFamily as string | undefined) ?? '',
      size: (e.getAttributes('textStyle').fontSize as string | undefined) ?? '',
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
      empty: e.isEmpty,
    }),
  });
}

type BtnProps = {
  label: string;
  testId: string;
  active?: boolean;
  disabled?: boolean;
  onRun: () => void;
  children: ReactNode;
};

function ToolButton({
  label,
  testId,
  active,
  disabled,
  onRun,
  children,
}: BtnProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      data-testid={testId}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onRun}
      className={`inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-35 ${active ? 'bg-accent text-accent-foreground' : ''}`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span aria-hidden className="mx-1 h-4 w-px bg-border" />;
}

type SelectProps = {
  label: string;
  testId: string;
  value: string;
  disabled?: boolean;
  options: { label: string; value: string }[];
  onPick: (v: string) => void;
};

function ToolSelect({
  label,
  testId,
  value,
  disabled,
  options,
  onPick,
}: SelectProps) {
  const known = options.some((o) => o.value === value);
  return (
    <select
      aria-label={label}
      title={label}
      data-testid={testId}
      value={known ? value : ''}
      disabled={disabled}
      onChange={(e) => onPick(e.target.value)}
      className="h-7 rounded-sm border border-border bg-card px-1.5 font-mono text-[11px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
    >
      {options.map((o) => (
        <option key={o.label} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function promptLink(editor: Editor) {
  const prev = (editor.getAttributes('link').href as string | undefined) ?? '';
  const raw = window.prompt('Link URL (leave empty to remove)', prev);
  if (raw === null) return;
  const chain = editor.chain().focus().extendMarkRange('link');
  if (!raw.trim()) {
    chain.unsetLink().run();
    return;
  }
  const href = normalizeLinkUrl(raw);
  if (!href) {
    window.alert('Use an http, https, or mailto link.');
    return;
  }
  if (editor.state.selection.empty && !editor.isActive('link')) {
    editor
      .chain()
      .focus()
      .insertContent({
        type: 'text',
        text: href,
        marks: [{ type: 'link', attrs: { href } }],
      })
      .run();
    return;
  }
  chain.setLink({ href }).run();
}

type GroupProps = {
  editor: Editor;
  s: ReturnType<typeof useToolbarState>;
  off: boolean;
};

function MarkGroup({ editor, s, off }: GroupProps) {
  const c = () => editor.chain().focus();
  return (
    <>
      <ToolButton
        label="Bold"
        testId="button-format-bold"
        active={s.bold}
        disabled={off}
        onRun={() => c().toggleBold().run()}
      >
        <Bold className="size-3.5" />
      </ToolButton>
      <ToolButton
        label="Italic"
        testId="button-format-italic"
        active={s.italic}
        disabled={off}
        onRun={() => c().toggleItalic().run()}
      >
        <Italic className="size-3.5" />
      </ToolButton>
      <ToolButton
        label="Underline"
        testId="button-format-underline"
        active={s.underline}
        disabled={off}
        onRun={() => c().toggleUnderline().run()}
      >
        <Underline className="size-3.5" />
      </ToolButton>
      <ToolButton
        label="Link"
        testId="button-format-link"
        active={s.link}
        disabled={off}
        onRun={() => promptLink(editor)}
      >
        <Link2 className="size-3.5" />
      </ToolButton>
    </>
  );
}

function FontGroup({ editor, s, off }: GroupProps) {
  const pickFont = (v: string) => {
    const c = editor.chain().focus();
    (v ? c.setFontFamily(v) : c.unsetFontFamily()).run();
  };
  const pickSize = (v: string) => {
    const c = editor.chain().focus();
    (v ? c.setFontSize(v) : c.unsetFontSize()).run();
  };
  const sizes = FONT_SIZES.map((v) => ({
    label: v ? v.replace('px', '') : 'Size',
    value: v,
  }));
  return (
    <>
      <ToolSelect
        label="Font family"
        testId="select-font-family"
        value={s.font}
        disabled={off}
        options={FONT_FAMILIES}
        onPick={pickFont}
      />
      <ToolSelect
        label="Font size"
        testId="select-font-size"
        value={s.size}
        disabled={off}
        options={sizes}
        onPick={pickSize}
      />
    </>
  );
}

function BlockGroup({ editor, s, off }: GroupProps) {
  const c = () => editor.chain().focus();
  return (
    <>
      <ToolButton
        label="Bulleted list"
        testId="button-list-bullet"
        active={s.bullet}
        disabled={off}
        onRun={() => c().toggleBulletList().run()}
      >
        <List className="size-3.5" />
      </ToolButton>
      <ToolButton
        label="Numbered list"
        testId="button-list-ordered"
        active={s.ordered}
        disabled={off}
        onRun={() => c().toggleOrderedList().run()}
      >
        <ListOrdered className="size-3.5" />
      </ToolButton>
      <Divider />
      <ToolButton
        label="Align left"
        testId="button-align-left"
        active={s.align === 'left'}
        disabled={off}
        onRun={() => c().setTextAlign('left').run()}
      >
        <AlignLeft className="size-3.5" />
      </ToolButton>
      <ToolButton
        label="Align center"
        testId="button-align-center"
        active={s.align === 'center'}
        disabled={off}
        onRun={() => c().setTextAlign('center').run()}
      >
        <AlignCenter className="size-3.5" />
      </ToolButton>
      <ToolButton
        label="Align right"
        testId="button-align-right"
        active={s.align === 'right'}
        disabled={off}
        onRun={() => c().setTextAlign('right').run()}
      >
        <AlignRight className="size-3.5" />
      </ToolButton>
    </>
  );
}

function HistoryGroup({ editor, s, off }: GroupProps) {
  const c = () => editor.chain().focus();
  return (
    <>
      <ToolButton
        label="Clear formatting"
        testId="button-clear-formatting"
        disabled={off}
        onRun={() => c().unsetAllMarks().unsetTextAlign().clearNodes().run()}
      >
        <RemoveFormatting className="size-3.5" />
      </ToolButton>
      <ToolButton
        label="Undo"
        testId="button-undo"
        disabled={off || !s.canUndo}
        onRun={() => c().undo().run()}
      >
        <Undo2 className="size-3.5" />
      </ToolButton>
      <ToolButton
        label="Redo"
        testId="button-redo"
        disabled={off || !s.canRedo}
        onRun={() => c().redo().run()}
      >
        <Redo2 className="size-3.5" />
      </ToolButton>
    </>
  );
}

function Toolbar({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const s = useToolbarState(editor);
  const g = { editor, s, off: disabled };
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      data-testid="toolbar-body-format"
      className="flex flex-wrap items-center gap-0.5 border-b border-border bg-background/60 px-3 py-1.5"
    >
      <FontGroup {...g} />
      <Divider />
      <MarkGroup {...g} />
      <Divider />
      <BlockGroup {...g} />
      <Divider />
      <HistoryGroup {...g} />
    </div>
  );
}

const CONTENT_CSS = `
.glyph-rte p{margin:0 0 .6em}
.glyph-rte p:last-child{margin-bottom:0}
.glyph-rte ul{list-style:disc;padding-left:1.4em;margin:0 0 .6em}
.glyph-rte ol{list-style:decimal;padding-left:1.4em;margin:0 0 .6em}
.glyph-rte a{color:hsl(var(--primary));text-decoration:underline;text-underline-offset:2px}
.glyph-rte:not(.glyph-email-preview)[contenteditable=false]{opacity:.6;cursor:not-allowed}
`;

export function RichEmailPreview({ html }: { html: string }) {
  const editor = useEditor({
    extensions: buildExtensions(),
    content: html,
    editable: false,
    immediatelyRender: true,
    editorProps: {
      attributes: {
        class:
          'glyph-rte glyph-email-preview text-sm leading-relaxed outline-none',
        role: 'document',
        'aria-label': 'Email body',
      },
    },
  });
  useEffect(() => {
    if (editor && editor.getHTML() !== html)
      editor.commands.setContent(html, { emitUpdate: false });
  }, [editor, html]);
  return (
    <>
      <style>{CONTENT_CSS}</style>
      <EditorContent editor={editor} />
    </>
  );
}

/**
 * Rich HTML email body editor. Initializes once per mount; key the parent
 * session to reset. Reports (html, text); empty document reports html ''.
 */
export function RichEmailEditor(props: RichEmailEditorProps) {
  const editor = useRichEditor(props);
  const empty = useEditorState({
    editor,
    selector: ({ editor: current }) => current?.isEmpty ?? true,
  });
  const disabled = !!props.disabled;
  useEffect(() => {
    if (editor && editor.isEditable === disabled)
      editor.setEditable(!disabled, false);
  }, [editor, disabled]);
  return (
    <div className="bg-card" data-testid="rich-email-editor">
      <style>{CONTENT_CSS}</style>
      {editor && <Toolbar editor={editor} disabled={disabled} />}
      <div className="relative">
        {empty && (
          <span className="pointer-events-none absolute left-5 top-4 text-sm text-muted-foreground">
            {props.placeholder ?? 'Write your message'}
          </span>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

export default RichEmailEditor;
