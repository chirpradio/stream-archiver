Based on https://cloud.google.com/python/docs/getting-started/getting-started-on-compute-engine#use_a_startup_script_to_initialize_an_instance

# Deploy command
```
gcloud compute instances create stream-archiver-recorder \
  --image-project=debian-cloud \
  --image-family=debian-12 \
  --metadata-from-file=startup-script=./startup/sh \
  --metadata=BUCKET_NAME=chirpradiodev-stream-archives-raw
```