bucket=$1
branch=$2
# Optional. Needed when the previous instance is being kept around (stopped)
# rather than deleted, since instance names must be unique within a zone.
name=${3:-stream-archive-recorder}

gcloud compute instances create ${name} \
  --image-project=debian-cloud \
  --image-family=debian-12 \
  --zone=us-central1-a \
  --machine-type=e2-micro \
  --resource-policies=restart-stream-recorder \
  --scopes=https://www.googleapis.com/auth/servicecontrol,https://www.googleapis.com/auth/service.management.readonly,https://www.googleapis.com/auth/logging.write,https://www.googleapis.com/auth/monitoring.write,https://www.googleapis.com/auth/trace.append,https://www.googleapis.com/auth/devstorage.read_write \
  --metadata-from-file=startup-script=./startup.sh \
  --metadata=BUCKET_NAME=${bucket},BRANCH=${branch}