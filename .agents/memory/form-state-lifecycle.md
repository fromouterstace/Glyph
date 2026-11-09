---
name: Editable form lifetimes
description: Preserve local work during polling and isolate message-specific confirmations
---

Preserve local edits when polling refreshes the same entity. Reset the form and its confirmations when the user closes/reopens it or selects a different message.

**Why:** A refresh is not permission to discard local work. Conversely, retaining a send/delete confirmation across message identities can apply an earlier intent to a different email.

**How to apply:** Scope editable sessions and detail dialogs to message identity. Initialize a session once, rather than synchronizing query objects into editable state through effects with omitted dependencies. Settings may use server data until the first local edit; thereafter change the draft only through explicit edits, successful saves, or a deliberate reset. Test both same-identity refresh and different-identity transitions.

Identity changes must actually reset identity-bound UI state, not merely display
temporary defaults while a different entity is selected.

**Why:** A default projection can pass an A-to-B test but restore stale pagination
or confirmations on A-to-B-to-A navigation. The original state was never reset.

**How to apply:** Test round trips and delayed responses across identities.
Give identity-bound sessions a real reset/lifetime boundary, while preserving
same-entity edits and independent pagination during ordinary refreshes.
