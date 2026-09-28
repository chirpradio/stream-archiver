const { formatInTimeZone } = require("date-fns-tz");

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
  getDateFromFilename,
  filterChunksByExpectedDate,
  isRetryableError,
  deleteSourceFiles,
};
