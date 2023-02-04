const express = require("express");
const { engine } = require("express-handlebars");

const app = express();
app.engine("handlebars", engine());
app.set("view engine", "handlebars");
app.set("views", "./views");

const { Storage } = require("@google-cloud/storage");
const storage = new Storage();
const BUCKET = process.env.BUCKET;

/*
  parses weekday for a shift
  from three-letter abbreviation (e.g., "tue") 
  or cron notation (0-6 = sun-sat)
*/
function parseWeekdayToInt(req, res, next, value) {
  const parsed = parseInt(value, 10);
  if (!isNaN(parsed)) {
    req.weekdayInt = parsed;  
    next();
  } else {
    const weekdayMap = {
      "sun": 0,
      "mon": 1,
      "tue": 2,
      "wed": 3,
      "thu": 4,
      "fri": 5,
      "sat": 6,
    };
    if(Object.keys(weekdayMap).includes(value.toLowerCase())) {
      req.weekdayInt = weekdayMap[value.toLowerCase()];
      next();
    } else {
      res.sendStatus(400);
    }
  }
}

/* 
  parses hour that a shift starts
  from human-readable abbreviations (e.g., "9a", "12p", "10p") 
  or 24-hour notation (e.g., "9", "12", "22")
*/
function parseShiftStartTo24Hr(req, res, next, value) {
  const groups = value.match(/(\d{1,2})([ap]*)/);
  
  const hour = parseInt(groups[1], 10);
  if (isNaN(hour)) {
    res.sendStatus(400);
  }

  const dayPart = groups[2];
  if (dayPart === "a" || dayPart === "") {
    req.shiftStart = hour;
    next();
  } else if (dayPart === "p") {
    if (hour === 12) {
      req.shiftStart = hour;
    } else {
      req.shiftStart = hour + 12;
    }
    next();     
  } else {
    res.sendStatus(400);
  } 
} 

async function getFiles({ callSign, weekday, shiftStart } = params) {
  const [files] = await storage.bucket(BUCKET).getFiles({
    prefix: `${callSign.toUpperCase()}-${weekday}-${shiftStart}`,
  }); 

  // Return the two most recent recordings
  files.sort((a, b) => {
    return a.metadata.timeCreated < b.metadata.timeCreated ? 1 : -1;
  }); 
  return files.slice(0, 2);
}

function mapToLocals(files) {
  return files.map(file => {
    const d = new Date(file.metadata.timeCreated);
    /* 
      ensure that shifts that end at midnight 
      are listed as their start date
    */
    d.setHours(d.getHours() - 2);
    
    const options = { 
      weekday: "long", 
      year: "numeric", 
      month: "long", 
      day: "numeric", 
      timeZone: "America/Chicago" 
    };

    return {
      title: d.toLocaleDateString("en-US", options),
      src: file.metadata.mediaLink
    }
  }); 
}

async function renderPlayer(req, res) {  
  const files = await getFiles({
    callSign: req.params.callSign,
    weekday: req.weekdayInt,
    shiftStart: req.shiftStart,
  });  
  if(files.length === 0) {
    res.sendStatus(404);
  } else {
    const streams = mapToLocals(files);    
    res.render("player", { streams, layout: false });
  }
}


app.param("weekday", parseWeekdayToInt);
app.param("shift_start", parseShiftStartTo24Hr);
app.use("/:callSign/:weekday/:shift_start", renderPlayer);

exports.archivePlayer = app;