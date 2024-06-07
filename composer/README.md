The `composeStreamArchive` function is set up to be [triggered in response to a Pub/Sub message](https://cloud.google.com/functions/docs/calling/pubsub). The `data` in the message should be an object defining the shift to record. For example, the Wednesday 6am shift would be defined as:

```
{
  "weekday": 3, // Sunday = 0, Saturday = 6
  "hours": [6, 7, 8]
}
```

# Testing

`data` in the Pub/Sub message has to be Base64 encoded. The above sample shift is already encoded into test.json. To test with a different shift, edit the sample above, Base64 encode, and replace the `data.message.data` value in test.json
