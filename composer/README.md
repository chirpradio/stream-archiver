The `composeStreamArchive` function is set up to be [triggered in response to a Pub/Sub message](https://cloud.google.com/functions/docs/calling/pubsub). A single Cloud Scheduler job publishes a message every hour; the function itself determines which shift (if any) just ended by checking the message's `publishTime` against the shift schedule defined in `shift-schedule.js`. Most hourly triggers are a no-op — only the hours that land on an actual shift boundary do any work.

# Testing

Run `npm run test:unit` to run the shift-schedule lookup tests (`shift-schedule.test.js`), which cover every kind of shift boundary without needing a live server or GCP credentials.

To manually exercise the full `composeStreamArchive` function against real buckets, `test.json` simulates a Pub/Sub message with a `publishTime`. The sample value, `2024-01-02T15:05:00Z`, resolves to the Tuesday 6am-9am shift. To test a different shift, pick a UTC timestamp that falls at :05 past the hour immediately after that shift's last hour in America/Chicago, and replace `data.message.publishTime` in `test.json`.
