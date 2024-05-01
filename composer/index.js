const functions = require("@google-cloud/functions-framework");
const { Storage } = require("@google-cloud/storage");
const storage = new Storage();
const sourceBucket = storage.bucket(process.env.SOURCE_BUCKET);
const destinationBucket = storage.bucket(process.env.DESTINATION_BUCKET);
const crypto = require("crypto");
const { formatInTimeZone, format } = require("date-fns-tz");

function getPrefix(weekday, hour, padStart = false) {
  const hourString = padStart ? hour.toString().padStart(2, "0") : hour;
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

async function getAudioChunksForHour(weekday, hour) {
  const [files] = await sourceBucket.getFiles({
    prefix: getPrefix(weekday, hour, true),
  });
  if (files.length === 0) {
    throw Error(`Missing files for ${hour}`);
  }

  // ensure they're in order
  files.sort(sortFilesByTimeCreated);

  return files;
}

/* 
  Compose each hour individually as a first step.
  If we try to rapidly compose the entire shift into a single object
  we get a 429 Too Many Requests error from Storage.
*/
async function composeHour(weekday, hour) {
  const sources = await getAudioChunksForHour(weekday, hour);
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
async function composeHours(shift) {
  const promises = shift.hours.map((hour) => {
    return composeHour(shift.weekday, hour);
  });
  const hourFiles = await Promise.all(promises);
  return hourFiles;
}

function getShiftDate(hourFiles) {
  // find the earliest source file
  const firstSources = hourFiles.map((f) => f.sources[0]);
  firstSources.sort(sortFilesByTimeCreated);
  const earliest = firstSources[0];
  const shiftDate = new Date(earliest.metadata.timeCreated);
  
  // set time to the beginning of that hour
  shiftDate.setMinutes(0);
  shiftDate.setSeconds(0);
  shiftDate.setMilliseconds(0);
  
  return shiftDate;
}

// compose each hour into a single file for the entire shift
async function composeShift(filename, hourFiles) {
  const composedHours = hourFiles.map((o) => o.file);
  composedHours.sort((a, b) => (a.name < b.name ? -1 : 1));

  const shiftFile = sourceBucket.file(`temp/${filename}`);
  await sourceBucket.combine(composedHours, shiftFile);
  return shiftFile;
}

async function moveToPublicFolder(filename, shiftFile, shiftDate) {
  const publicFile = destinationBucket.file(filename);
  await shiftFile.move(publicFile);
  await publicFile.setMetadata({
    contentType: "audio/mpeg",
    /*
      Not the most descriptive field name, but
      it can be used to automatically delete recordings
      https://cloud.google.com/storage/docs/metadata#custom-time
    */
    customTime: format(shiftDate, "yyyy-MM-dd'T'HH:mm:ss'Z'"),
  });
}

async function deleteSourceFiles(hourFiles) {
  const allFiles = hourFiles.map((o) => [o.file, ...o.sources]).flat(1);
  for (const file of allFiles) {
    await file.delete();
  }
}

async function composeStreamArchive(cloudEvent) {
  let success = false;
  let hourFiles;

  try {
    const shift = JSON.parse(atob(cloudEvent.data.message.data));
    hourFiles = await composeHours(shift);
    const shiftDate = getShiftDate(hourFiles);
    const filename = getFilename(
      shift.weekday,
      shift.hours[0],
      formatInTimeZone(shiftDate, "America/Chicago", "yyyy-MM-dd"),
    );
    const shiftFile = await composeShift(filename, hourFiles);
    await moveToPublicFolder(filename, shiftFile, shiftDate);
    success = true;
    console.log(`Success: ${filename}`);
  } catch (err) {
    console.error(err);

    if (err.code === 429) {
      // retry if we made too many API requests when combining
      return Promise.reject();
    } else {
      // otherwise do not retry
      return Promise.resolve();
    }
  }

  if (success) {
    try {
      await deleteSourceFiles(hourFiles);
    } catch (err) {
      console.error(err);
      /*
        don't worry about retrying and let the bucket 
        retention policy handle clean up instead
      */
    }
  }
}

functions.cloudEvent("composeStreamArchive", composeStreamArchive);
