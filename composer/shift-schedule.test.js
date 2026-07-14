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
