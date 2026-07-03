topic=$1

gcloud scheduler jobs create pubsub compose-stream-archive-hourly \
  --location us-central1 \
  --time-zone "America/Chicago" \
  --schedule "5 * * * *" \
  --topic ${topic} \
  --message-body "{}" \
  --max-retry-attempts=5 \
  --min-backoff="15m" \
  --max-backoff="60m";
