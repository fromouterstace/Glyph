---
name: Gmail extension lifecycle
description: Browser invalidation of content scripts after extension updates
---

An already-open Gmail tab can retain a content script whose Chrome extension runtime is invalidated after an extension reload or update. No app-server or database fix can restore that invalidated browser context.

**Why:** The user encountered an undefined-sendMessage error inside Gmail; it is reproducible when the extension runtime disappears or becomes invalid. A missing runtime must not be treated as a Gmail API or tracking-host failure.

**How to apply:** Guard extension messaging, distinguish disconnected-runtime failures from account/API errors, and provide explicit Gmail-tab reload instructions. Never auto-reload a compose or auto-send an email; let Gmail save the draft first. Reinjecting the supported script should dispose old observers and listeners rather than create duplicate controls. Do not describe this browser lifecycle limitation as permanently eliminated by an app publish alone.
