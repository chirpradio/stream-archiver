const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.SOURCE_BUCKET = "test-source-raw";
process.env.DESTINATION_BUCKET = "test-destination";

class FakeFile {
  constructor(name, { timeCreated } = {}) {
    this.name = name;
    this.metadata = { timeCreated: timeCreated || new Date().toISOString() };
    this.deleted = false;
  }
  async delete() {
    this.deleted = true;
  }
  async move(dest) {
    dest.movedFrom = this.name;
  }
  async setMetadata(metadata) {
    this.metadata = { ...this.metadata, ...metadata };
  }
  async copy(dest) {
    dest.copiedFrom = this.name;
  }
}

class FakeBucket {
  constructor() {
    this.filesByName = new Map();
    this.combineError = null;
  }
  file(name) {
    if (!this.filesByName.has(name)) {
      this.filesByName.set(name, new FakeFile(name));
    }
    return this.filesByName.get(name);
  }
  seed(name, opts) {
    const file = new FakeFile(name, opts);
    this.filesByName.set(name, file);
    return file;
  }
  async getFiles({ prefix }) {
    const matches = [...this.filesByName.values()].filter(
      (f) => f.name.startsWith(prefix) && !f.deleted,
    );
    return [matches];
  }
  async combine(sources, dest) {
    if (this.combineError) throw this.combineError;
    dest.combinedFrom = (dest.combinedFrom || []).concat(
      sources.map((s) => s.name),
    );
  }
}

class FakeStorage {
  constructor() {
    this.sourceBucket = new FakeBucket();
    this.destinationBucket = new FakeBucket();
  }
  bucket(name) {
    if (name === process.env.SOURCE_BUCKET) return this.sourceBucket;
    if (name === process.env.DESTINATION_BUCKET) return this.destinationBucket;
    throw new Error(`unexpected bucket requested: ${name}`);
  }
}

class FakeQuery {
  filter() {
    return this;
  }
}

class FakeDatastore {
  async runQuery() {
    return [[]]; // no PlaylistEvents by default
  }
  createQuery() {
    return new FakeQuery();
  }
}

let fakeStorage;

/*
  node:test's mock.module() doesn't actually intercept plain CJS require()
  calls for these packages (confirmed directly - the real Storage client
  got constructed and made a real network call despite being "mocked").
  Stub via require.cache instead: a well-established, reliable pattern
  that doesn't depend on an experimental loader hook.
*/
function stubModule(specifier, exportsObj) {
  const resolvedPath = require.resolve(specifier);
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports: exportsObj,
  };
}

function setup() {
  fakeStorage = new FakeStorage();
  stubModule("@google-cloud/storage", {
    Storage: function Storage() {
      return fakeStorage;
    },
  });
  stubModule("@google-cloud/datastore", {
    Datastore: function Datastore() {
      return new FakeDatastore();
    },
  });
  delete require.cache[require.resolve("./index.js")];
  return require("./index.js");
}

// Tuesday 9:05am America/Chicago (CST, UTC-6) -> the [6,7,8] block's trigger.
// Resolves (via getExpectedShiftDate) to 2024-01-02.
const TUESDAY_9AM_TRIGGER = "2024-01-02T15:05:00.000Z";
const EXPECTED_DATE = "2024-01-02";

function seedHourChunks(bucket, weekday, hours, date) {
  for (const hour of hours) {
    const hourStr = hour.toString().padStart(2, "0");
    bucket.seed(`WCXP-LP-${weekday}-${hourStr}-00-00-${date}.mp3`);
  }
}

test("composeStreamArchive: skips without touching storage when no shift ends at this trigger time", async () => {
  const { composeStreamArchive } = setup();

  // Tuesday 10am isn't any shift block's trigger hour.
  await composeStreamArchive({
    data: { message: { publishTime: "2024-01-02T16:05:00.000Z" } },
  });

  assert.equal(fakeStorage.sourceBucket.filesByName.size, 0);
  assert.equal(fakeStorage.destinationBucket.filesByName.size, 0);
});

test("composeStreamArchive: composes and publishes a shift, ignoring a stale chunk from a prior week", async () => {
  const { composeStreamArchive } = setup();
  seedHourChunks(fakeStorage.sourceBucket, 2, [6, 7, 8], EXPECTED_DATE);
  // a straggler left over from the previous Tuesday - same weekday/hour
  // prefix, different embedded date
  const staleChunk = fakeStorage.sourceBucket.seed(
    "WCXP-LP-2-06-00-00-2023-12-26.mp3",
  );

  await composeStreamArchive({
    data: { message: { publishTime: TUESDAY_9AM_TRIGGER } },
  });

  const published = [...fakeStorage.destinationBucket.filesByName.values()];
  assert.equal(published.length, 1);
  assert.match(published[0].name, /^WCXP-LP-2-06-2024-01-02-/);

  // the stale chunk was never picked up as a source, so it's untouched
  assert.equal(staleChunk.deleted, false);
});

test("composeStreamArchive: rejects with the underlying error for a retryable Storage failure", async () => {
  const { composeStreamArchive } = setup();
  seedHourChunks(fakeStorage.sourceBucket, 2, [6, 7, 8], EXPECTED_DATE);
  fakeStorage.sourceBucket.combineError = Object.assign(
    new Error("backend error"),
    { code: 503 },
  );

  await assert.rejects(
    () =>
      composeStreamArchive({
        data: { message: { publishTime: TUESDAY_9AM_TRIGGER } },
      }),
    (err) => {
      assert.equal(err.code, 503);
      return true;
    },
  );
});

test("composeStreamArchive: resolves (does not retry) and logs SHIFT_FAILED for a non-retryable failure", async () => {
  const { composeStreamArchive } = setup();
  // only seed hours 6 and 7 - hour 8 is genuinely missing
  seedHourChunks(fakeStorage.sourceBucket, 2, [6, 7], EXPECTED_DATE);

  const originalConsoleError = console.error;
  const errorLogs = [];
  console.error = (...args) => errorLogs.push(args.join(" "));

  try {
    await composeStreamArchive({
      data: { message: { publishTime: TUESDAY_9AM_TRIGGER } },
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.ok(
    errorLogs.some((line) =>
      line.includes("SHIFT_FAILED weekday=2 hours=6,7,8 date=2024-01-02"),
    ),
    `expected a SHIFT_FAILED log line, got: ${JSON.stringify(errorLogs)}`,
  );
});
