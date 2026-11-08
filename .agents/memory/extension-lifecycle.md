---
name: Gmail extension lifecycle
description: Browser invalidation of content scripts after extension updates
---

An already-open Gmail tab can retain a content script whose Chrome extension runtime is invalidated after an extension reload or update. No app-server or database fix can restore that invalidated browser context.

**Why:** The user encountered an undefined-sendMessage error inside Gmail; it is reproducible when the extension runtime disappears or becomes invalid. A missing runtime must not be treated as a Gmail API or tracking-host failure.

**How to apply:** Guard extension messaging, distinguish disconnected-runtime failures from account/API errors, and provide explicit Gmail-tab reload instructions. Never auto-reload a compose or auto-send an email; let Gmail save the draft first. Reinjecting the supported script should dispose old observers and listeners rather than create duplicate controls. Do not describe this browser lifecycle limitation as permanently eliminated by an app publish alone.

Recover already-open Gmail tabs explicitly on extension install/update, browser
startup and reconnect; manifest content scripts alone do not refresh an already
loaded document. Use DOM-level handoff as well as same-world disposal because
an invalidated world's global references may not be available to its replacement.
Restore only generated tracking, retain user edits and notify Gmail of the edit.
The user must re-add tracking after handoff.

**Why:** Prior recovery only restored the app bridge, leaving open Gmail tabs
with stale scripts and repeated invalidated-context errors. Explaining that
error was not equivalent to replacing the stale script.

**How to apply:** Treat reinjection as best-effort and isolate each tab's
failure. If an older script cannot surrender its tracking state safely, retain
the draft and require one manual saved-draft reload rather than guessing
original URLs. Never promise self-repair while the extension is disabled or
removed. Distinguish deterministic handoff contracts from live Chrome evidence.

Treat a published-domain change as an extension authentication migration, not
just a web-link update.

**Why:** A signed-in custom-domain tab did not authorize an extension bridge
still targeting the older deployment alias. Sharing a backend does not mean
the two browser origins share the user's authenticated session.

**How to apply:** Move setup instructions, the fixed extension origin, host
permission and package version together. Clear obsolete bridge state and
require explicit permission on the new origin. Keep mailbox OAuth authorization
distinct from app sign-in; never bypass either check to repair the connection.

Keep Glyph's browser controls outside outgoing message content and use a compact
separate row above Gmail's native Send controls, including inline replies.

**Why:** The user found the full-width toolbar above reply text too intrusive
and explicitly chose compact controls near Send instead. A subsequent real Gmail
screenshot showed that putting them inline with Send squeezed controls and errors
into Gmail's narrow button wrapper.

**How to apply:** Preserve draft content and Gmail's own Send behavior when
changing placement; do not mix tracking controls into the native action row.
If an unfamiliar layout prevents locating Send safely,
place controls outside the editor rather than guessing inside message content.
Keep the independent row outside Gmail's constrained action table, and do not
assume the nearest editor wrapper also owns the compose footer.

**Why:** Testing a generic div-based footer did not expose Gmail's table-cell
clipping or editor-only wrapper variants. A passing simplified DOM fixture is
not evidence that placement works in the user's live Gmail tab.

**How to apply:** Exercise table-based narrow composes and wrapper variants;
report live-Gmail verification separately from local layout evidence.
