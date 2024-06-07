# Example URLs

- Tuesday, 6am to 9am show: `/wcxp-lp/tue/6a` or `/wcxp-lp/2/6`
- Tuesday, 10pm to midnight show: `/wcxp-lp/tue/10p` or `/wcxp-lp/2/22`
- Wednesday, 12noon to 3pm show: `/wcxp-lp/wed/12p` or `/wcxp-lp/3/12`

# Test locally

`npm run start`

# Deploy

## Dev

`npm run deploy -- --project=chirpradiodev  --set-env-vars BUCKET=chirpradiodev-stream-archives`

## Production

`npm run deploy -- --project=chirpradio-hrd --set-env-vars BUCKET=chirpradio-stream-archives`
