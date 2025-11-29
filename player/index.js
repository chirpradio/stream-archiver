const functions = require("@google-cloud/functions-framework");
const { Storage } = require("@google-cloud/storage");
const storage = new Storage();
const BUCKET = process.env.BUCKET;
const Handlebars = require("handlebars");
const fs = require("fs").promises;

/*
  parses weekday for a shift
  from three-letter abbreviation (e.g., "tue") 
  or cron notation (0-6 = sun-sat)
*/
function parseWeekdayToInt(value) {
  const parsed = parseInt(value, 10);
  if (!isNaN(parsed)) {
    return parsed;
  } else {
    const weekdayMap = {
      sun: 0,
      mon: 1,
      tue: 2,
      wed: 3,
      thu: 4,
      fri: 5,
      sat: 6,
    };
    if (Object.keys(weekdayMap).includes(value.toLowerCase())) {
      return weekdayMap[value.toLowerCase()];
    } else {
      throw new TypeError(`'${value}' isn't a valid weekday value`);
    }
  }
}

/* 
  parses hour that a shift starts
  from human-readable abbreviations (e.g., "9a", "12p", "10p") 
  or 24-hour notation (e.g., "9", "12", "22")
*/
function parseShiftStartTo24Hr(value) {
  const groups = value.match(/(\d{1,2})([ap]*)/);
  if (groups === null) {
    throw new TypeError(`'${value}' isn't a valid shift start value`);
  }

  const hour = parseInt(groups[1], 10);
  if (isNaN(hour)) {
    throw new TypeError(`'${value}' isn't a valid shift start value`);
  }

  let shiftStart;
  const dayPart = groups[2];
  if (hour === 12) {
    if (dayPart === "a") {
      shiftStart = 0;
    } else if (dayPart === "p" || dayPart === "") {
      shiftStart = 12;
    }
  } else {
    if (dayPart === "a" || dayPart === "") {
      shiftStart = hour;
    } else if (dayPart === "p") {
      shiftStart = hour + 12;
    }
  }

  if (typeof shiftStart === "undefined") {
    throw new TypeError(`'${value}' isn't a valid shift start value`);
  }

  return shiftStart.toString().padStart(2, "0");
}

async function getFiles({ callSign, weekday, shiftStart }) {
  const [files] = await storage.bucket(BUCKET).getFiles({
    prefix: `${callSign.toUpperCase()}-${weekday}-${shiftStart}`,
  });

  // Return the two most recent recordings
  files.sort((a, b) => {
    return a.name < b.name ? 1 : -1;
  });
  return files.slice(0, 2);
}

async function getFilesByDj(djId) {
  const [files] = await storage.bucket(BUCKET).getFiles({
    prefix: `${djId}/`,
  });

  // Return the most recent recordings by this DJ
  return files.sort((a, b) => {
    return a.name < b.name ? 1 : -1;
  });  
}

function mapToLocals(files) {
  return files.map((file) => {
    const d = new Date(file.metadata.customTime);
    const options = {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "America/Chicago",
    };

    return {
      title: d.toLocaleDateString("en-US", options),
      src: file.metadata.mediaLink,
    };
  });
}

async function renderHtml(files) {
  const streams = mapToLocals(files);
  const template = await fs.readFile("./player.handlebars", "utf8");
  const compiledTemplate = Handlebars.compile(template);
  return compiledTemplate({ streams });
}

functions.http("player", async (req, res) => {
  if (req.method === "GET") {
    try {
      const pathParts = req.path.split("/").filter((p) => p);

      let files;

      // Route: /{callSign}/dj/{djId}
      if (pathParts.length === 3 && pathParts[1] === "dj") {
        const djId = pathParts[2];
        files = await getFilesByDj(djId);
      }
      // Route: /{callSign}/{weekday}/{shiftStart}
      else if (pathParts.length === 3) {
        const [callSign, weekday, shiftStart] = pathParts;
        const parsedStart = parseShiftStartTo24Hr(shiftStart);
        files = await getFiles({
          callSign: callSign,
          weekday: parseWeekdayToInt(weekday),
          shiftStart: parsedStart,
        });
      } else {
        res.status(400).send("Invalid route");
        return;
      }

      if (files.length > 0) {
        const html = await renderHtml(files);
        res.status(200).send(html);
      } else {
        res.status(404).send("");
      }
    } catch (err) {
      console.log(req.path);
      console.error(err);
      if (err instanceof TypeError) {
        res.status(400).send(err.message);
      } else {
        res.status(500).send("");
      }
    }
  } else {
    res.sendStatus(405);
  }
});
