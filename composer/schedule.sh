topic=$1

# Daily
for day in {0..6}; do
  # 12am-3am
  gcloud scheduler jobs create pubsub compose-stream-archive-${day}-0 \
    --location us-central1 \
    --time-zone "America/Chicago" \
    --schedule "5 3 * * ${day}" \
    --topic ${topic} \
    --message-body "{\"weekday\": ${day}, \"hours\": [0, 1, 2]}";

  # 6am-9am
  gcloud scheduler jobs create pubsub compose-stream-archive-${day}-6 \
    --location us-central1 \
    --time-zone "America/Chicago" \
    --schedule "5 9 * * ${day}" \
    --topic ${topic} \
    --message-body "{\"weekday\": ${day}, \"hours\": [6, 7, 8]}";
  
  # 9am-12pm
  gcloud scheduler jobs create pubsub compose-stream-archive-${day}-9 \
    --location us-central1 \
    --time-zone "America/Chicago" \
    --schedule "5 12 * * ${day}" \
    --topic ${topic} \
    --message-body "{\"weekday\": ${day}, \"hours\": [9, 10, 11]}";
done

# Weekdays
for day in {1..5}; do
  # 12pm-3pm
  gcloud scheduler jobs create pubsub compose-stream-archive-${day}-12 \
    --location us-central1 \
    --time-zone "America/Chicago" \
    --schedule "5 15 * * ${day}" \
    --topic ${topic} \
    --message-body "{\"weekday\": ${day}, \"hours\": [12, 13, 14]}";
  
  # 3pm-6pm
  gcloud scheduler jobs create pubsub compose-stream-archive-${day}-15 \
    --location us-central1 \
    --time-zone "America/Chicago" \
    --schedule "5 18 * * ${day}" \
    --topic ${topic} \
    --message-body "{\"weekday\": ${day}, \"hours\": [15, 16, 17]}";

  # 6pm-8pm
  gcloud scheduler jobs create pubsub compose-stream-archive-${day}-18 \
    --location us-central1 \
    --time-zone "America/Chicago" \
    --schedule "5 20 * * ${day}" \
    --topic ${topic} \
    --message-body "{\"weekday\": ${day}, \"hours\": [18, 19]}";

  # 8pm-10pm
  gcloud scheduler jobs create pubsub compose-stream-archive-${day}-20 \
    --location us-central1 \
    --time-zone "America/Chicago" \
    --schedule "5 22 * * ${day}" \
    --topic ${topic} \
    --message-body "{\"weekday\": ${day}, \"hours\": [20, 21]}";
done

# Weekends
for day in 0 6; do
  # 12pm-2pm
  gcloud scheduler jobs create pubsub compose-stream-archive-${day}-12 \
    --location us-central1 \
    --time-zone "America/Chicago" \
    --schedule "5 14 * * ${day}" \
    --topic ${topic} \
    --message-body "{\"weekday\": ${day}, \"hours\": [12, 13]}";
  
  # 2pm-4pm
  gcloud scheduler jobs create pubsub compose-stream-archive-${day}-14 \
    --location us-central1 \
    --time-zone "America/Chicago" \
    --schedule "5 16 * * ${day}" \
    --topic ${topic} \
    --message-body "{\"weekday\": ${day}, \"hours\": [14, 15]}";

  # 4pm-6pm
  gcloud scheduler jobs create pubsub compose-stream-archive-${day}-16 \
    --location us-central1 \
    --time-zone "America/Chicago" \
    --schedule "5 18 * * ${day}" \
    --topic ${topic} \
    --message-body "{\"weekday\": ${day}, \"hours\": [16, 17]}";

  # 6pm-9pm
  gcloud scheduler jobs create pubsub compose-stream-archive-${day}-18 \
    --location us-central1 \
    --time-zone "America/Chicago" \
    --schedule "5 21 * * ${day}" \
    --topic ${topic} \
    --message-body "{\"weekday\": ${day}, \"hours\": [18, 19, 20]}";
done

# Mon-Fri 10pm-12am
for day in {2..6}; do
  prev=$((day - 1))
  gcloud scheduler jobs create pubsub compose-stream-archive-${prev}-22 \
    --location us-central1 \
    --time-zone "America/Chicago" \
    --schedule "5 0 * * ${day}" \
    --topic ${topic} \
    --message-body "{\"weekday\": ${prev}, \"hours\": [22, 23]}";
done

# Sunday 9pm-12am
gcloud scheduler jobs create pubsub compose-stream-archive-0-21 \
  --location us-central1 \
  --time-zone "America/Chicago" \
  --schedule "5 0 * * 1" \
  --topic ${topic} \
  --message-body "{\"weekday\": 0, \"hours\": [21, 22, 23]}";

# Saturday 9pm-12am
gcloud scheduler jobs create pubsub compose-stream-archive-6-21 \
  --location us-central1 \
  --time-zone "America/Chicago" \
  --schedule "5 0 * * 0" \
  --topic ${topic} \
  --message-body "{\"weekday\": 6, \"hours\": [21, 22, 23]}";
