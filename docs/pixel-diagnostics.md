# Pixel request diagnostics

Pixel-load digits still count only persisted `open` events. The message detail
panel reports request outcomes separately: recorded, sender-compose ignored,
tracking disabled, send unconfirmed, unknown token, event budget exceeded,
native reconciliation budget exceeded and native reconciliation failed.
Recorded aggregates are attempted only after the event commits. Diagnostic
failures never roll back events; a crash between writes may leave fewer
diagnostics than events, never a recorded diagnostic for an uncommitted event.
HEAD requests do not write either events or diagnostics.

Diagnostics are best-effort lower bounds, not an exact audit trail. A
constant-space in-memory gate runs before every diagnostic database write:
at most 600 attempts per minute per API process, including at most 10 unknown
and 60 ignored/over-budget attempts, with at most four concurrent writes.
No per-token/IP map is allocated. Counters include attempts that fail, so
storage outages cannot create an unlimited retry loop. No retry or background
queue is introduced. Each process enforces its own ceiling; these limits are
not presented as a cross-instance exact count or a general DDoS defense.

Each outcome is aggregated per message per UTC day; concurrency increments the
same counter rather than retaining individual requests. Unknown and malformed
tokens share one anonymous daily counter with no message association. No token,
IP, referrer, full user agent, recipient or request URL is stored in diagnostics.
Unknown counts are deliberately not exposed to tenants; the panel labels this
category “Unattributed,” not zero or an invented message-specific count.

The nullable prepared origin records the validated origin actually used to
prepare native tracking URLs or claim a web draft for send. Reapplying native
tracking updates it alongside the compose contents. Existing messages remain
null (“Not recorded”); current settings must not be substituted for history.
No events or diagnostics are backfilled. A zero diagnostic counter means no
outcomes retained since instrumentation, not proof that no request ever occurred.
Requests served from caches, blocked before arrival, sent to another origin, or
lost during storage failure cannot be recovered by these diagnostics.

## Additive schema release review

Review `lib/db/schema-reviews/0005.sql` and the actual platform diff. The only
message change is nullable text; no tokens, statuses or historical rows are
rewritten. A new primary key limits row growth to eight outcomes per message per
day (unknown tokens produce at most one global row per day). A message index
supports owner-authorized reads; a cascading foreign key removes its aggregates
with existing message deletion. Old instances ignore the new structures; new
instances require the expansion first. The new table starts empty. No retention
purge is introduced; establish retention/privacy policy before adding one.

Only isolated test schemas are created by automated verification. The real
development database is not pushed during routine validation, and no production
DDL is installed in runtime, deploy or post-merge code. Follow the reviewed
development push and Replit Publish flow in `database-safety.md`; never run this
review SQL directly against production.

Before schema application, an authorized operator must complete and retain:

- [ ] Target environment/schema version verified without recording credentials.
- [ ] Development diff and actual Publish diff reviewed; no renames, removals,
      drop/add substitutions or overwrite-from-development selected.
- [ ] Target-specific restorable production recovery point, timestamp, retention,
      operator and recovery objective recorded and verified.
- [ ] Isolated restored-clone recovery verified for counts, constraints, owners,
      tokens/events and attachment generations, with mail/OAuth workers disabled.
- [ ] Old/new compatibility and bounded locks/timeouts rehearsed on that clone;
      nullable-column lock duration measured against the release budget.
- [ ] Supported schema application approved; readiness, tenant isolation,
      preparation and synthetic tracking outcomes observed after application.
- [ ] Sanitized evidence retained; clone/export cleanup never targets production.

No production recovery point or restored-clone rehearsal is claimed by this
code change. For application rollback, retain the expansion and diagnostics;
restore old code rather than deleting message or diagnostic data.
