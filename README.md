Record and play the last two weeks of every DJ-hosted show.

# Architecture
The `recorder` is a Python script run on Google Compute Engine that continually records audio from the stream. The Python script writes ~20 seconds of audio at a time to MP3 files stored in a Google Cloud Storage bucket. 

The `composer` is a Google Cloud Function that combines those short chunks of audio into a single file for each shift. The function is triggered by Cloud Scheduler jobs that are scheduled to run five minutes after the end of each shift. 

The `player` is a minimal Express app deployed as a Google Cloud Function. It returns an embeddable player for the latest two recordings of a shift based on the weekday and start time. For example, the archives for the 10pm to midnight shift on Tuesday can be retrieved from the path `/wcxp-lp/tue/10p`.