---
name: Gmail transport contracts
description: Why importer regressions must exercise the real per-user OAuth transport
---

New Gmail operations need a regression through the actual owner-bound OAuth
transport, not only service tests that replace the Gmail adapter.

**Why:** Label imports passed adapter-level tests but failed for personal Gmail
accounts because the outbound security allowlist rejected label discovery before
any contact could be stored. Mocking that boundary concealed the failure.

**How to apply:** Mock Google only at the network edge in at least one provider
contract, preserving authorization, transport checks and PostgreSQL persistence.
Extend outbound permissions narrowly for the required read; do not allow broad
provider paths or label mutations merely to make imports pass.
