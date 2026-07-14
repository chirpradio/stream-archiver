# Consolidate Composer Cloud Scheduler Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ~56 per-shift Cloud Scheduler jobs in `composer/scripts/schedule.sh` with a single hourly job, moving the shift-schedule data into application code so the composer determines which shift (if any) just ended from the trigger time itself.

**Architecture:** A new `composer/shift-schedule.js` module holds the canonical list of shift blocks (weekday + hours), derives a lookup map keyed by trigger weekday/hour, and exposes `getShiftForPublishTime(isoTimestamp)`. `composer/index.js` calls this instead of parsing shift data out of the Pub/Sub message body. `composer/scripts/schedule.sh` is rewritten to create one Cloud Scheduler job (`5 * * * *`) instead of 56.

**Tech Stack:** Node.js 20 (Gen2 Cloud Function), `date-fns-tz` (already a dependency — no new packages), Node's built-in test runner (`node --test`), `gcloud` CLI for scheduler job management.

## Global Constraints

- All shift-boundary math uses `America/Chicago` as the canonical timezone.
- No new npm dependencies — `date-fns-tz` already provides everything needed.
- The existing compose pipeline (`composeHours` → `composeShift` → `moveToPublicFolder` → DJ copy → `deleteSourceFiles`) is unchanged; only how `composeStreamArchive` determines the `shift` object changes.
- Deploy and verify against the `chirpradiodev` project before touching `chirpradio-hrd`.

---

### Task 1: Shift-schedule lookup module

**Files:**
- Create: `composer/shift-schedule.js`
- Test: `composer/shift-schedule.test.js`

**Interfaces:**
- Produces: `getShiftForTrigger(weekday: number, hour: number) => { weekday: number, hours: number[] } | null`
- Produces: `getShiftForPublishTime(isoTimestamp: string) => { weekday: number, hours: number[] } | null`
- Produces: `SHIFT_BLOCKS: Array<{ weekday: number, hours: number[] }>` (exported for testing/introspection)

- [ ] **Step 1: Write the failing test**

Create `composer/shift-schedule.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  SHIFT_BLOCKS,
  getShiftForTrigger,
  getShiftForPublishTime,
} = require("./shift-schedule");

test("has 56 total shift blocks", () => {
  assert.equal(SHIFT_BLOCKS.length, 56);
});

test("same-day block: Tuesday 6am-9am triggers at Tuesday 9am", () => {
  const shift = getShiftForTrigger(2, 9);
  assert.deepEqual(shift, { weekday: 2, hours: [6, 7, 8] });
});

test("midnight-crossing block: Monday 10pm-midnight triggers at Tuesday 12am", () => {
  const shift = getShiftForTrigger(2, 0);
  assert.deepEqual(shift, { weekday: 1, hours: [22, 23] });
});

test("Sunday 9pm-midnight triggers at Monday 12am", () => {
  const shift = getShiftForTrigger(1, 0);
  assert.deepEqual(shift, { weekday: 0, hours: [21, 22, 23] });
});

test("Saturday 9pm-midnight triggers at Sunday 12am", () => {
  const shift = getShiftForTrigger(0, 0);
  assert.deepEqual(shift, { weekday: 6, hours: [21, 22, 23] });
});

test("returns null for an hour that isn't a shift boundary", () => {
  const shift = getShiftForTrigger(2, 10);
  assert.equal(shift, null);
});

test("getShiftForPublishTime derives weekday/hour from a UTC timestamp", () => {
  // 2024-01-02T15:05:00Z is Tuesday 9:05am America/Chicago (CST, UTC-6)
  const shift = getShiftForPublishTime("2024-01-02T15:05:00Z");
  assert.deepEqual(shift, { weekday: 2, hours: [6, 7, 8] });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `composer/`): `node --test`
Expected: FAIL — `Cannot find module './shift-schedule'`

- [ ] **Step 3: Write the implementation**

Create `composer/shift-schedule.js`:

```js
const { toZonedTime } = require("date-fns-tz");

const TIMEZONE = "America/Chicago";

// Every day: overnight, early morning, and late morning blocks
const DAILY_BLOCKS = [
  [0, 1, 2],
  [6, 7, 8],
  [9, 10, 11],
];

// Monday-Friday only
const WEEKDAY_BLOCKS = [
  [12, 13, 14],
  [15, 16, 17],
  [18, 19],
  [20, 21],
  [22, 23],
];

// Sunday and Saturday only
const WEEKEND_BLOCKS = [
  [12, 13],
  [14, 15],
  [16, 17],
  [18, 19, 20],
  [21, 22, 23],
];

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND_DAYS = [0, 6];

function buildShiftBlocks() {
  const blocks = [];
  for (const weekday of ALL_DAYS) {
    for (const hours of DAILY_BLOCKS) {
      blocks.push({ weekday, hours });
    }
  }
  for (const weekday of WEEKDAYS) {
    for (const hours of WEEKDAY_BLOCKS) {
      blocks.push({ weekday, hours });
    }
  }
  for (const weekday of WEEKEND_DAYS) {
    for (const hours of WEEKEND_BLOCKS) {
      blocks.push({ weekday, hours });
    }
  }
  return blocks;
}

const SHIFT_BLOCKS = buildShiftBlocks();

function triggerKey(weekday, hour) {
  return `${weekday}-${hour}`;
}

/*
  A block "triggers" one hour after its last hour ends. If that rolls
  past midnight, the trigger happens at hour 0 on the next weekday.
*/
function buildTriggerMap(blocks) {
  const map = new Map();
  for (const block of blocks) {
    const lastHour = Math.max(...block.hours);
    let triggerHour = lastHour + 1;
    let triggerWeekday = block.weekday;
    if (triggerHour === 24) {
      triggerHour = 0;
      triggerWeekday = (block.weekday + 1) % 7;
    }
    map.set(triggerKey(triggerWeekday, triggerHour), block);
  }
  return map;
}

const TRIGGER_MAP = buildTriggerMap(SHIFT_BLOCKS);

function getShiftForTrigger(weekday, hour) {
  return TRIGGER_MAP.get(triggerKey(weekday, hour)) || null;
}

function getShiftForPublishTime(isoTimestamp) {
  const zoned = toZonedTime(new Date(isoTimestamp), TIMEZONE);
  return getShiftForTrigger(zoned.getDay(), zoned.getHours());
}

module.exports = {
  SHIFT_BLOCKS,
  getShiftForTrigger,
  getShiftForPublishTime,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `composer/`): `node --test`
Expected: `tests 7`, `pass 7`, `fail 0`

- [ ] **Step 5: Commit**

```bash
git add composer/shift-schedule.js composer/shift-schedule.test.js
git commit -m "Add shift-schedule lookup module for trigger-time shift resolution"
```

---

### Task 2: Wire the composer to the new lookup

**Files:**
- Modify: `composer/index.js:1-10` (add import)
- Modify: `composer/index.js:207-221` (`composeStreamArchive`)
- Modify: `composer/package.json:8` (add `test:unit` script)

**Interfaces:**
- Consumes: `getShiftForPublishTime(isoTimestamp)` from Task 1's `composer/shift-schedule.js`

- [ ] **Step 1: Add the import**

In `composer/index.js`, after the existing `date-fns` import (line 10):

```js
const { parse } = require("date-fns");
const { getShiftForPublishTime } = require("./shift-schedule");
```

- [ ] **Step 2: Replace the shift-parsing logic in `composeStreamArchive`**

Replace this (currently `composer/index.js:207-213`):

```js
async function composeStreamArchive(cloudEvent) {
  let success = false;
  let hourFiles;

  try {
    const shift = JSON.parse(atob(cloudEvent.data.message.data));
    hourFiles = await composeHours(shift);
```

With:

```js
async function composeStreamArchive(cloudEvent) {
  const shift = getShiftForPublishTime(cloudEvent.data.message.publishTime);
  if (!shift) {
    console.log(
      `No shift ends at this trigger time, skipping. publishTime=${cloudEvent.data.message.publishTime}`,
    );
    return;
  }

  let success = false;
  let hourFiles;

  try {
    hourFiles = await composeHours(shift);
```

- [ ] **Step 3: Add the `test:unit` npm script**

In `composer/package.json`, in the `scripts` block, add a line after `"test": "sh ./test.sh",`:

```json
    "test": "sh ./test.sh",
    "test:unit": "node --test",
```

- [ ] **Step 4: Run lint**

Run (from `composer/`): `npm run lint`
Expected: no errors (formats `index.js` and `shift-schedule.js` in place if needed)

- [ ] **Step 5: Run the unit suite to confirm nothing broke**

Run (from `composer/`): `npm run test:unit`
Expected: `tests 7`, `pass 7`, `fail 0`

- [ ] **Step 6: Commit**

```bash
git add composer/index.js composer/package.json
git commit -m "Derive shift from trigger publish time instead of message payload"
```

---

### Task 3: Update the local integration test fixture and docs

**Files:**
- Modify: `composer/test.json`
- Modify: `composer/README.md`

**Interfaces:**
- Consumes: `composeStreamArchive`'s new expectation of `cloudEvent.data.message.publishTime` (from Task 2)

- [ ] **Step 1: Replace `composer/test.json`**

```json
{
  "data": {
    "message": {
      "publishTime": "2024-01-02T15:05:00Z"
    }
  }
}
```

(`2024-01-02T15:05:00Z` is Tuesday 9:05am in America/Chicago, which resolves to the Tuesday 6am-9am shift.)

- [ ] **Step 2: Replace the `composer/README.md` content**

```markdown
The `composeStreamArchive` function is set up to be [triggered in response to a Pub/Sub message](https://cloud.google.com/functions/docs/calling/pubsub). A single Cloud Scheduler job publishes a message every hour; the function itself determines which shift (if any) just ended by checking the message's `publishTime` against the shift schedule defined in `shift-schedule.js`. Most hourly triggers are a no-op — only the hours that land on an actual shift boundary do any work.

# Testing

Run `npm run test:unit` to run the shift-schedule lookup tests (`shift-schedule.test.js`), which cover every kind of shift boundary without needing a live server or GCP credentials.

To manually exercise the full `composeStreamArchive` function against real buckets, `test.json` simulates a Pub/Sub message with a `publishTime`. The sample value, `2024-01-02T15:05:00Z`, resolves to the Tuesday 6am-9am shift. To test a different shift, pick a UTC timestamp that falls at :05 past the hour immediately after that shift's last hour in America/Chicago, and replace `data.message.publishTime` in `test.json`.
```

- [ ] **Step 3: Verify the JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('composer/test.json'))" && echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add composer/test.json composer/README.md
git commit -m "Update local test fixture and docs for trigger-time based scheduling"
```

---

### Task 4: Replace the 56-job scheduler script with a single hourly job

**Files:**
- Modify: `composer/scripts/schedule.sh`
- Modify: `composer/package.json:12-13` (fix `schedule:dev`/`schedule:prod` paths)

**Interfaces:**
- Produces: a `gcloud scheduler jobs create` invocation that creates one job named `compose-stream-archive-hourly`

- [ ] **Step 1: Replace `composer/scripts/schedule.sh`**

```sh
topic=$1

gcloud scheduler jobs create pubsub compose-stream-archive-hourly \
  --location us-central1 \
  --time-zone "America/Chicago" \
  --schedule "5 * * * *" \
  --topic ${topic} \
  --message-body "{}" \
  --max-retry-attempts=5 \
  --min-backoff="15m" \
  --max-backoff="60m";
```

- [ ] **Step 2: Fix the `schedule:dev`/`schedule:prod` script paths in `composer/package.json`**

`schedule.sh` lives at `composer/scripts/schedule.sh`, but the existing npm scripts point at `./schedule.sh` (a pre-existing path bug). Replace:

```json
    "schedule:dev": "sh ./schedule.sh projects/chirpradiodev/topics/compose-stream-archive",
    "schedule:prod": "sh ./schedule.sh projects/chirpradio-hrd/topics/compose-stream-archive"
```

With:

```json
    "schedule:dev": "sh ./scripts/schedule.sh projects/chirpradiodev/topics/compose-stream-archive",
    "schedule:prod": "sh ./scripts/schedule.sh projects/chirpradio-hrd/topics/compose-stream-archive"
```

- [ ] **Step 3: Syntax-check the script**

Run: `bash -n composer/scripts/schedule.sh`
Expected: no output (exit code 0)

- [ ] **Step 4: Commit**

```bash
git add composer/scripts/schedule.sh composer/package.json
git commit -m "Replace per-shift scheduler jobs with a single hourly job"
```

---

### Task 5: Migrate live Cloud Scheduler jobs (manual — requires operator execution)

> **This task modifies live, billed cloud infrastructure in `chirpradiodev` and `chirpradio-hrd`. Do not run these commands unattended — the operator (Steve) should run each command and confirm the result before proceeding to the next, in both dev first, then prod.**

**Files:** none (infrastructure only)

**Interfaces:**
- Consumes: Task 2's deployed `composeStreamArchive`, Task 4's `schedule:dev`/`schedule:prod` npm scripts

- [ ] **Step 1: Deploy the updated composer to dev**

Run (from `composer/`): `npm run deploy:dev`
Expected: deploy succeeds; note the revision URL/output for reference

- [ ] **Step 2: Create the new hourly job in dev**

Run (from `composer/`): `npm run schedule:dev`
Expected: `gcloud` reports the `compose-stream-archive-hourly` job created

- [ ] **Step 3: Verify the new job exists**

Run: `gcloud scheduler jobs describe compose-stream-archive-hourly --project chirpradiodev --location us-central1`
Expected: job details printed, `schedule: 5 * * * *`, `state: ENABLED`

- [ ] **Step 4: Manually fire the job once and confirm correct behavior in logs**

Run: `gcloud scheduler jobs run compose-stream-archive-hourly --project chirpradiodev --location us-central1`

Then check Cloud Logging for the `composeStreamArchive` function in `chirpradiodev` and confirm the log line is either a successful compose (`Success: ...`) or the new no-op message (`No shift ends at this trigger time, skipping...`) — not an error.

- [ ] **Step 5: Delete the old per-shift jobs in dev**

```bash
PROJECT=chirpradiodev
LOCATION=us-central1
for job in $(gcloud scheduler jobs list --project ${PROJECT} --location ${LOCATION} --format="value(name)" | grep -E 'compose-stream-archive-[0-9]'); do
  gcloud scheduler jobs delete "${job}" --project ${PROJECT} --location ${LOCATION} --quiet
done
```

Expected: all `compose-stream-archive-<digit>-<digits>` jobs deleted; `compose-stream-archive-hourly` untouched (its name doesn't match the `[0-9]` filter right after `archive-`)

- [ ] **Step 6: Verify only the hourly job remains in dev**

Run: `gcloud scheduler jobs list --project chirpradiodev --location us-central1 --format="value(name)"`
Expected: only `compose-stream-archive-hourly` listed

- [ ] **Step 7: Repeat steps 1-6 against production**

Run: `npm run deploy:prod`, then `npm run schedule:prod`, then repeat the describe/run/verify/delete steps above with `--project chirpradio-hrd` in place of `chirpradiodev`.

- [ ] **Step 8: Confirm cost drop**

A few days after the prod migration, check the GCP Billing report's Cloud Scheduler line item and confirm it has dropped from ~$5.22/month to ~$0/month (1 job is under the 3-free-job threshold).
