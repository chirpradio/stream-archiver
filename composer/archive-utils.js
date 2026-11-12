const { formatInTimeZone, fromZonedTime } = require("date-fns-tz");
const { parse } = require("date-fns");

const TIMEZONE = "America/Chicago";

/*
  A shift's compose trigger fires ~5 minutes after its last hour ends.
  Stepping back 65 minutes from the trigger's publish time lands inside
  the shift's last hour on the correct calendar date, regardless of DST
  or shifts that cross midnight.
*/
function getExpectedShiftDate(publishTime) {
  const anchor = new Date(new Date(publishTime).getTime() - 65 * 60 * 1000);
  return formatInTimeZone(anchor, TIMEZONE, "yyyy-MM-dd");
}

/*
  The instant the shift started: the Chicago calendar date its audio was
  recorded on, at the hour the shift begins. This has to carry the hour -
  the player renders each show's displayed time straight out of the
  customTime metadata written from it, so a date-only value makes every
  show on the site read as 12am.
*/
function getShiftStart(expectedDate, startHour) {
  const hourString = startHour.toString().padStart(2, "0");
  const localStart = parse(
    `${expectedDate} ${hourString}:00:00`,
    "yyyy-MM-dd HH:mm:ss",
    new Date(),
  );
  return fromZonedTime(localStart, TIMEZONE);
}

/*
  The customTime stamp for a composed shift. Formatted explicitly in UTC:
  date-fns' own `format` renders in the host's zone while this pattern
  appends a literal "Z", which only produced correct stamps because Cloud
  Run happens to run as UTC.
*/
function formatCustomTime(instant) {
  return formatInTimeZone(instant, "UTC", "yyyy-MM-dd'T'HH:mm:ss'Z'");
}

// Recorder chunk filenames end in ...-YYYY-MM-DD.mp3
const FILENAME_DATE = /(\d{4}-\d{2}-\d{2})\.mp3$/;

function getDateFromFilename(name) {
  const match = name.match(FILENAME_DATE);
  return match ? match[1] : null;
}

function filterChunksByExpectedDate(files, expectedDate) {
  return files.filter(
    (file) => getDateFromFilename(file.name) === expectedDate,
  );
}

// Transient network-level failures (Node/libuv errno codes), as distinct
// from the HTTP status codes Storage's own ApiError carries in err.code.
const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EPIPE",
]);

function isRetryableError(err) {
  return (
    err.code === 429 ||
    (err.code >= 500 && err.code < 600) ||
    RETRYABLE_NETWORK_CODES.has(err.code)
  );
}

async function deleteSourceFiles(hourFiles) {
  const allFiles = hourFiles.map((o) => [o.file, ...o.sources]).flat(1);
  for (const file of allFiles) {
    try {
      await file.delete();
    } catch (err) {
      console.error(`Failed to delete ${file.name}:`, err);
    }
  }
}

module.exports = {
  getExpectedShiftDate,
  getShiftStart,
  formatCustomTime,
  getDateFromFilename,
  filterChunksByExpectedDate,
  isRetryableError,
  deleteSourceFiles,
};
