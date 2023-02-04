Record and play the last two weeks of every DJ-hosted show.

# Architecture
The `recorder` is a Python script run by cron jobs, both of which are built into a Docker image and deployed to Google Compute Engine. Since we're currently archiving a single station and the shift schedule changes *very* infrequently, the schedule for running the script and recording the stream is hard-coded into `/recorder/crontab`. The Python script writes the audio to MP3 files stored in a Google Cloud Storage bucket. The bucket is configured in the console to delete any files with an age greater than 14 days.

The `player` is a minimal Express app deployed as a Google Cloud Function. It returns an embeddable player for the latest two recordings of a show based on the weekday and start time. For example, the archives for the 10pm to midnight show on Tuesday can be retrieved from the path `/wcxp-lp/tue/10p`.