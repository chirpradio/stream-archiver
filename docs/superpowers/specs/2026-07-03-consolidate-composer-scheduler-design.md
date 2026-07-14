# Consolidate Composer Cloud Scheduler Jobs

## Problem

The recorder + composer cost ~$8-10/month to run on Google Cloud. The largest
controllable line item is Cloud Scheduler at $5.22/month. `composer/scripts/schedule.sh`
creates one Cloud Scheduler job per weekday per shift block — roughly 56 jobs
total. Cloud Scheduler bills $0.10/job/month after the first 3 free jobs, so
~56 jobs ≈ $5.30/month, matching the observed cost. The job *count* is the
cost driver, not invocation frequency.

The shift-block schedule (which hours belong to which shift, for weekdays vs.
weekends) is also duplicated as data in two places: `schedule.sh` (as
generated `gcloud` commands) and `getShiftHours()` in
`composer/scripts/backfill-dj-folders.js`.

## Goal

Reduce Cloud Scheduler cost to effectively $0/month by collapsing the ~56
per-shift jobs into a single recurring job, while consolidating the
shift-schedule data into one source of truth in application code.

Out of scope: the App Engine charge ($11.18/month, the largest line item
overall) is a separate, likely unrelated cost and will be investigated
separately. Also out of scope: updating `getShiftHours()` in
`backfill-dj-folders.js` to reuse the new shared table — left untouched since
it's a one-off historical backfill script, not part of the ongoing trigger
system.

## Architecture

- Delete all ~56 per-shift Cloud Scheduler jobs (in both `chirpradiodev` and
  `chirpradio-hrd` projects). Replace with **one** job,
  `compose-stream-archive-hourly`, cron `5 * * * *`, timezone
  `America/Chicago`, publishing to the same Pub/Sub topic the composer
  already subscribes to. The message body becomes trivial/empty — it no
  longer carries `weekday`/`hours`.
- The composer (`composer/index.js`) gains a new module,
  `composer/shift-schedule.js`, holding the canonical list of shift blocks
  (the same data currently duplicated in `schedule.sh` and
  `backfill-dj-folders.js`'s `getShiftHours()`), expressed as
  `{ weekday, hours: number[] }` entries — one entry per shift block, for
  every weekday.
- From that block list, the module derives (at load time) a lookup map keyed
  by `"<triggerWeekday>-<triggerHour>"` → block. The trigger weekday/hour for
  a block is computed as "one hour after the block's last hour," rolling the
  weekday over (`(weekday + 1) % 7`) and wrapping the hour to `0` when a
  block's last hour is 23. This replaces the hand-alignment that previously
  existed between `schedule.sh`'s cron times and its hours-lists — the
  mapping is derived, not duplicated.

  Examples:
  - Same-day: Tuesday 6am–9am is `{ weekday: 2, hours: [6, 7, 8] }`. Last hour
    8 → trigger hour 9, no rollover → key `"2-9"`. Matches today's
    `compose-stream-archive-2-6` job (`schedule: "5 9 * * 2"`).
  - Midnight-crossing: Monday 10pm–midnight is
    `{ weekday: 1, hours: [22, 23] }`. Last hour 23 → trigger hour rolls to
    `0`, trigger weekday advances to `2` (Tuesday) → key `"2-0"`. Matches
    today's job that fires Tuesday 00:05 carrying `weekday: 1` (Monday).

- `composeStreamArchive` looks up the current trigger's weekday/hour in that
  map. No match → log and exit successfully (no-op). Match → run the existing
  compose pipeline unchanged (`composeHours` → `composeShift` →
  `moveToPublicFolder` → DJ copy → `deleteSourceFiles`).

## Data Flow

1. Scheduler fires `compose-stream-archive-hourly` at `:05` every hour →
   publishes a minimal Pub/Sub message to the existing topic.
2. `composeStreamArchive` reads the event's **publish timestamp** (not
   `Date.now()`), converts to `America/Chicago`, extracts weekday + hour.
3. Looks up `"<weekday>-<hour>"` in the precomputed trigger map.
4. No match → log `"No shift ends at <weekday> <hour>:00, skipping"` and
   resolve successfully.
5. Match → run the existing pipeline unchanged.

## Error Handling

- **Deterministic retries:** the composer already retries on `429` by
  rejecting the promise, which redelivers the same Pub/Sub message. Deriving
  weekday/hour from the message's **publish timestamp**, rather than
  wall-clock time at execution, ensures a redelivered message always resolves
  to the same shift — a retry landing near an hour boundary can't compute a
  different (or no) shift than the original trigger.
- **No-op must be a success, not a throw** — otherwise Scheduler's retry
  policy would fire every non-boundary hour for no reason.
- **DST transitions:** Cloud Scheduler already resolves `America/Chicago`
  cron schedules correctly across DST; this isn't a new risk, just now
  handled by one job instead of 56.
- **429 retry path:** unchanged — still governed by the function's existing
  reject-to-retry logic.

## Testing

- New unit tests for the trigger-lookup module covering: a same-day block, a
  midnight-crossing block, an hour with no matching shift (no-op), and the
  Sunday/Saturday 9pm–midnight edge cases.
- Update the local test flow (`composer/test.sh` + `test.json`): since the
  message no longer carries `{weekday, hours}`, the local test needs to let
  you override the "current time" instead, so any weekday/hour can be
  simulated without waiting for a real clock boundary.

## Migration

- Delete the 56 existing Cloud Scheduler jobs in both `chirpradiodev` and
  `chirpradio-hrd` projects.
- Create the single `compose-stream-archive-hourly` job in each project.
- Replace `composer/scripts/schedule.sh` with a one-line `gcloud scheduler
  jobs create` command (or drop the script if creating the single job
  manually is simpler going forward).

## Expected Outcome

Cloud Scheduler job count: 56 → 1 (under the 3-free-jobs threshold).
Cloud Scheduler cost: ~$5.22/month → ~$0/month. Extra Cloud Function
invocations (24/day vs. ~1.8/day) are trivial relative to the existing free
tier that already zeroes out the Cloud Run Functions line.
