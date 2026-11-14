const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  getExpectedShiftDate,
  getDateFromFilename,
  filterChunksByExpectedDate,
  isRetryableError,
  deleteSourceFiles,
} = require("./archive-utils");

test("getExpectedShiftDate: same-day trigger resolves to the trigger's own date", () => {
  // Wednesday 9:05am America/Chicago (CDT, UTC-5) -> 14:05 UTC
  const date = getExpectedShiftDate("2026-09-16T14:05:21.000Z");
  assert.equal(date, "2026-09-16");
});

test("getExpectedShiftDate: midnight-crossing trigger resolves to the previous day", () => {
  // Monday 10pm-midnight block triggers Tuesday 12:05am America/Chicago (CDT, UTC-5) -> 05:05 UTC Tuesday
  const date = getExpectedShiftDate("2026-09-15T05:05:00.000Z");
  assert.equal(date, "2026-09-14");
});

test("getDateFromFilename: extracts the trailing date from a raw chunk filename", () => {
  const date = getDateFromFilename("WCXP-LP-3-06-15-42-2026-09-16.mp3");
  assert.equal(date, "2026-09-16");
});

test("getDateFromFilename: returns null for a filename with no trailing date", () => {
  // intermediate combined hour files, e.g. temp/WCXP-LP-3-06--abcd1234.mp3
  const date = getDateFromFilename("WCXP-LP-3-06--abcd1234.mp3");
  assert.equal(date, null);
});

test("filterChunksByExpectedDate: drops a stale chunk left over from a prior week", () => {
  const files = [
    { name: "WCXP-LP-3-06-00-05-2026-09-09.mp3" }, // straggler from the prior Wednesday
    { name: "WCXP-LP-3-06-00-05-2026-09-16.mp3" },
    { name: "WCXP-LP-3-06-00-25-2026-09-16.mp3" },
  ];

  const filtered = filterChunksByExpectedDate(files, "2026-09-16");

  assert.deepEqual(
    filtered.map((f) => f.name),
    ["WCXP-LP-3-06-00-05-2026-09-16.mp3", "WCXP-LP-3-06-00-25-2026-09-16.mp3"],
  );
});

test("isRetryableError: 429 (rate limited) is retryable", () => {
  assert.equal(isRetryableError({ code: 429 }), true);
});

test("isRetryableError: 503 (transient Storage backend error) is retryable", () => {
  assert.equal(isRetryableError({ code: 503 }), true);
});

test("isRetryableError: 404 (not found) is not retryable", () => {
  assert.equal(isRetryableError({ code: 404 }), false);
});

test("isRetryableError: ECONNRESET (transient network reset) is retryable", () => {
  // observed live: a FetchError "socket hang up" during Storage combine(),
  // with a string errno code rather than an HTTP status
  assert.equal(isRetryableError({ code: "ECONNRESET" }), true);
});

test("isRetryableError: ETIMEDOUT is retryable", () => {
  assert.equal(isRetryableError({ code: "ETIMEDOUT" }), true);
});

test("isRetryableError: EACCES (permission denied) is not retryable", () => {
  assert.equal(isRetryableError({ code: "EACCES" }), false);
});

test("deleteSourceFiles: a failed delete doesn't stop the rest of the batch from being deleted", async () => {
  const deleted = [];
  const makeFile = (name, shouldFail) => ({
    name,
    delete: async () => {
      if (shouldFail) throw new Error(`boom deleting ${name}`);
      deleted.push(name);
    },
  });

  const hourFiles = [
    {
      file: makeFile("temp/hour-a", false),
      sources: [makeFile("chunk-a1", true), makeFile("chunk-a2", false)],
    },
    {
      file: makeFile("temp/hour-b", false),
      sources: [makeFile("chunk-b1", false)],
    },
  ];

  await deleteSourceFiles(hourFiles);

  assert.deepEqual(deleted, [
    "temp/hour-a",
    "chunk-a2",
    "temp/hour-b",
    "chunk-b1",
  ]);
});
