bucket=$1
branch=$2

gcloud compute instances create stream-archive-recorder \
  --image-project=debian-cloud \
  --image-family=debian-12 \
  --zone=us-central1-a \
  --machine-type=e2-micro \
  --resource-policies=restart-stream-recorder \
  --scopes=https://www.googleapis.com/auth/servicecontrol,https://www.googleapis.com/auth/service.management.readonly,https://www.googleapis.com/auth/logging.write,https://www.googleapis.com/auth/monitoring.write,https://www.googleapis.com/auth/trace.append,https://www.googleapis.com/auth/devstorage.read_write \
  --metadata-from-file=startup-script=./startup.sh \
  --metadata=BUCKET_NAME=${bucket},BRANCH=${branch}