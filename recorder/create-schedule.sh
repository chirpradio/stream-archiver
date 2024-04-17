gcloud compute resource-policies create instance-schedule restart-stream-recorder \    
  --region=us-central1 \
  --vm-start-schedule="45 5 * * *" \
  --vm-stop-schedule="15 3 * * *" \
  --timezone="America/Chicago"