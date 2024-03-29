Based on https://cloud.google.com/python/docs/getting-started/getting-started-on-compute-engine#use_a_startup_script_to_initialize_an_instance

# Deploy command
```
gcloud compute instances create stream-archiver-recorder \
  --image-project=debian-cloud \
  --image-family=debian-12 \
  --zone=us-central1-a \
  --machine-type=e2-micro \
  --scopes=https://www.googleapis.com/auth/servicecontrol,https://www.googleapis.com/auth/service.management.readonly,https://www.googleapis.com/auth/logging.write,https://www.googleapis.com/auth/monitoring.write,https://www.googleapis.com/auth/trace.append,https://www.googleapis.com/auth/devstorage.read_write \
  --metadata-from-file=startup-script=./startup.sh \
  --metadata=BUCKET_NAME=chirpradiodev-stream-archives-raw
```