const functions = require("@google-cloud/functions-framework");
const { Storage } = require("@google-cloud/storage");
const { Datastore } = require("@google-cloud/datastore");
const storage = new Storage();
const datastore = new Datastore();
const sourceBucket = storage.bucket(process.env.SOURCE_BUCKET);
const destinationBucket = storage.bucket(process.env.DESTINATION_BUCKET);
const crypto = require("crypto");
const { formatInTimeZone, fromZonedTime } = require("date-fns-tz");
const { parse } = require("date-fns");
const { getShiftForPublishTime } = require("./shift-schedule");
const {
  getExpectedShiftDate,
  getShiftStart,
  formatCustomTime,
  filterChunksByExpectedDate,
  isRetryableError,
  deleteSourceFiles,
} = require("./archive-utils");

function getPrefix(weekday, hour) {
  const hourString = hour.toString().padStart(2, "0");
  return `WCXP-LP-${weekday}-${hourString}-`;
}

function getFilename(weekday, hour, shiftDate) {
  const prefix = getPrefix(weekday, hour);
  // add random token to make it harder to scrape the public files
  const token = crypto.randomBytes(4).toString("hex");

  return `${prefix}${shiftDate}-${token}.mp3`;
}

function sortFilesByTimeCreated(a, b) {
  return a.metadata.timeCreated < b.metadata.timeCreated ? -1 : 1;
}

async function getAudioChunksForHour(weekday, hour, expectedDate) {
  const [files] = await sourceBucket.getFiles({
    prefix: getPrefix(weekday, hour),
  });

  /*
    The prefix above only scopes by weekday+hour, not date, so it'll
    also match any chunk left over from a prior week (e.g. one that
    failed to compose and wasn't cleaned up). Filter down to chunks
    actually recorded on the date this shift covers.
  */
  const currentChunks = filterChunksByExpectedDate(files, expectedDate);

  if (currentChunks.length === 0) {
    throw Error(`Missing files for ${hour}`);
  }

  // ensure they're in order
  currentChunks.sort(sortFilesByTimeCreated);

  return currentChunks;
}

/* 
  Compose each hour individually as a first step.
  If we try to rapidly compose the entire shift into a single object
  we get a 429 Too Many Requests error from Storage.
*/
async function composeHour(weekday, hour, expectedDate) {
  const sources = await getAudioChunksForHour(weekday, hour, expectedDate);
  const filename = getFilename(weekday, hour, "");
  const hourFile = sourceBucket.file(`temp/${filename}`);

  /*
    Google only allows 32 objects to be combined at a time
    and we need to save room for the tempFile we're combining into.
  */
  const limit = 31;
  for (let i = 0; i < sources.length; i += limit) {
    const chunks = sources.slice(i, i + limit);
    if (i > 0) {
      chunks.unshift(hourFile);
    }
    await sourceBucket.combine(chunks, hourFile);
  }

  return {
    file: hourFile,
    sources,
  };
}

// compose short chunks into a single hour of audio
async function composeHours(shift, expectedDate) {
  const promises = shift.hours.map((hour) => {
    return composeHour(shift.weekday, hour, expectedDate);
  });
  const hourFiles = await Promise.all(promises);
  return hourFiles;
}

// compose each hour into a single file for the entire shift
async function composeShift(filename, hourFiles) {
  const composedHours = hourFiles.map((o) => o.file);
  composedHours.sort((a, b) => (a.name < b.name ? -1 : 1));

  const shiftFile = sourceBucket.file(`temp/${filename}`);
  await sourceBucket.combine(composedHours, shiftFile);
  return shiftFile;
}

async function moveToPublicFolder(filename, shiftFile, shiftStart) {
  const publicFile = destinationBucket.file(filename);
  await shiftFile.move(publicFile);
  await publicFile.setMetadata({
    contentType: "audio/mpeg",
    /*
      Not the most descriptive field name, but it's where we keep the
      instant this shift started. The player reads it back and renders
      each show's displayed date AND time from it, so it has to carry
      the shift's start hour, not just its calendar date.

      It does NOT currently drive deletion, despite what the field is
      usually used for: the archive bucket's only lifecycle rule is a
      plain `age: 14`. Wiring retention to this field would mean adding
      a daysSinceCustomTime condition to that rule.
      https://cloud.google.com/storage/docs/metadata#custom-time
    */
    customTime: formatCustomTime(shiftStart),
  });
}

async function getPlaylistEventsForShift(shiftStart, hours) {
  const events = [];
  const timezone = "America/Chicago";

  // Get the date in Chicago timezone
  const dateStr = formatInTimeZone(shiftStart, timezone, "yyyy-MM-dd");

  for (const hour of hours) {
    // Create start and end times in Chicago timezone
    const startTimeStr = `${dateStr} ${hour.toString().padStart(2, "0")}:00:00`;
    const endTimeStr = `${dateStr} ${hour.toString().padStart(2, "0")}:59:59`;

    // Parse the time strings into Date objects, then convert to UTC
    const startTimeLocal = parse(
      startTimeStr,
      "yyyy-MM-dd HH:mm:ss",
      new Date(),
    );
    const endTimeLocal = parse(endTimeStr, "yyyy-MM-dd HH:mm:ss", new Date());

    // Convert from Chicago time to UTC for Datastore query
    const startTime = fromZonedTime(startTimeLocal, timezone);
    const endTime = fromZonedTime(endTimeLocal, timezone);

    const query = datastore
      .createQuery("PlaylistEvent")
      .filter("established", ">=", startTime)
      .filter("established", "<=", endTime);

    try {
      const [results] = await datastore.runQuery(query);
      events.push(...results);
    } catch (err) {
      console.error(`Error querying PlaylistEvent for hour ${hour}:`, err);
    }
  }

  return events;
}

function getMostCommonDjId(events) {
  if (events.length === 0) {
    return null;
  }

  const djCounts = {};

  for (const event of events) {
    if (event.selector) {
      // Extract the User ID from the selector key
      const djId = event.selector.id || event.selector.name;
      if (djId) {
        djCounts[djId] = (djCounts[djId] || 0) + 1;
      }
    }
  }

  // Find the DJ with the most events
  let mostCommonDj = null;
  let maxCount = 0;

  for (const [djId, count] of Object.entries(djCounts)) {
    if (count > maxCount) {
      maxCount = count;
      mostCommonDj = djId;
    }
  }

  return mostCommonDj;
}

async function copyToDjFolder(filename, djId) {
  const sourceFile = destinationBucket.file(filename);
  const djFilename = `${djId}/${filename}`;
  const djFile = destinationBucket.file(djFilename);

  await sourceFile.copy(djFile);
  console.log(`Copied to DJ folder: ${djFilename}`);
}

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
  const expectedDate = getExpectedShiftDate(
    cloudEvent.data.message.publishTime,
  );

  try {
    hourFiles = await composeHours(shift, expectedDate);
    const shiftStart = getShiftStart(expectedDate, shift.hours[0]);
    const filename = getFilename(shift.weekday, shift.hours[0], expectedDate);
    const shiftFile = await composeShift(filename, hourFiles);
    await moveToPublicFolder(filename, shiftFile, shiftStart);

    // Query Datastore to find the DJ for this shift and create a copy
    try {
      const events = await getPlaylistEventsForShift(shiftStart, shift.hours);
      const djId = getMostCommonDjId(events);

      if (djId) {
        await copyToDjFolder(filename, djId);
        console.log(`DJ-specific copy created for DJ: ${djId}`);
      } else {
        console.log("No DJ ID found from PlaylistEvents");
      }
    } catch (err) {
      console.error("Error creating DJ-specific copy:", err);
      // Don't fail the whole operation if DJ copy fails
    }

    success = true;
    console.log(`Success: ${filename}`);
  } catch (err) {
    console.error(err);

    if (isRetryableError(err)) {
      /*
        Must reject with the actual error, not Promise.reject() with no
        argument. functions-framework only sends a failing (500) response
        - which is what tells Pub/Sub to redeliver - when the rejection
        reason is truthy; a bare Promise.reject() rejects with undefined,
        which it treats as "no error" and acks with 204 regardless.
      */
      return Promise.reject(err);
    } else {
      console.error(
        `SHIFT_FAILED weekday=${shift.weekday} hours=${shift.hours.join(",")} date=${expectedDate}`,
      );
      return Promise.resolve();
    }
  }

  if (success) {
    await deleteSourceFiles(hourFiles);
  }
}

functions.cloudEvent("compose-stream-archive", composeStreamArchive);

module.exports = { composeStreamArchive };
