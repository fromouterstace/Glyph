---
name: Composer sender identity
description: User-defined meaning of the name shown in the web composer
---

The user said: "It should not be hardcoded and it should always be the senders name."
The composer name row represents the sender, not an editable recipient label.

**Why:** A fictional recipient-name placeholder in a row labeled only "Name"
was mistaken for account identity. The user explicitly requested sender identity.

**How to apply:** Use the current authenticated user's real profile name and a
clear Sender label. Keep recipient metadata separate; never save sender names
into recipient-name fields. Show an explicit missing/loading state if the
profile has no name rather than inventing one or reusing a previous user's name.
Use neutral input hints rather than fictional people or email addresses.
