gcloud pubsub schemas create shift \
  --type=AVRO \
  --definition='{
    "type" : "record", "name" : "shift",
    "fields" : [
      {"name" : "weekday", "type" : "int"},
      {"name" : "hours", "type": { "type": "array", "items": "int"}}
  ]}'