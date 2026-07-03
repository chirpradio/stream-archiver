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
