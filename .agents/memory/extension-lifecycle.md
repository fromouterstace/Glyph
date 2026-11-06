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
