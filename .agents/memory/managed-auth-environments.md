---
name: Managed auth environment boundaries
description: Distinguish production Gmail records from Preview and managed auth popup failures
---

Treat missing Preview Gmail data separately from production delivery failures.

**Why:** A tracked message reported missing in Preview was already marked Sent
in production with its exact RFC Message-ID. Its production owner also had saved
Gmail authorization. Sharing an email address does not share Clerk user IDs,
database records, or mailbox grants across these environments.

**How to apply:** Confirm the message in the correct environment with read-only
queries before changing sync logic. Never merge identities or copy grants between
environments to make the interfaces agree.

Do not treat direct TLS failure on managed Clerk accounts subdomains as a reason
to change DNS or certificates.

**Why:** Managed production authentication uses the app proxy; a user encountered
an accounts-subdomain popup callback that could not establish TLS. Redirect-based
embedded auth avoids relying on that hosted popup endpoint.

**How to apply:** Keep canonical proxy wiring and in-app callback routes intact.
Verify real production Google callbacks separately from synthetic browser login;
neither unit props tests nor development smoke prove production consent success.
