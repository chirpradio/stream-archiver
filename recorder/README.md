# Run unit tests
`python -m unittest tests/record_test.py`

# Run locally
`docker run -e GOOGLE_APPLICATION_CREDENTIALS=/tmp/keys/credentials.json -e GOOGLE_CLOUD_PROJECT=chirpradiodev -v ~/.config/gcloud/application_default_credentials.json:/tmp/keys/credentials.json stream-recorder`

# Build commands
From this directory:
* `docker build --build-arg GOOGLE_CLOUD_PROJECT=<PROJECT_ID> --build-arg BUCKET_NAME=<BUCKET_NAME> .`
* `docker tag stream-recorder us-central1-docker.pkg.dev/<PROJECT_ID>/docker-repo/stream-recorder:wcxp-lp`
* `docker push us-central1-docker.pkg.dev/<PROJECT_ID>/docker-repo/stream-recorder:wcxp-lp`

# Deploy command
`gcloud compute instances create-with-container wcxp-lp-stream-recorder-b-side --project=chirpradio-hrd --zone=us-central1-a --machine-type=e2-micro --network-interface=network-tier=PREMIUM,subnet=default --maintenance-policy=MIGRATE --provisioning-model=STANDARD --service-account=292714882487-compute@developer.gserviceaccount.com --scopes=https://www.googleapis.com/auth/servicecontrol,https://www.googleapis.com/auth/service.management.readonly,https://www.googleapis.com/auth/logging.write,https://www.googleapis.com/auth/monitoring.write,https://www.googleapis.com/auth/trace.append,https://www.googleapis.com/auth/devstorage.read_write --image=projects/cos-cloud/global/images/cos-109-17800-66-57 --boot-disk-size=10GB --boot-disk-type=pd-balanced --boot-disk-device-name=wcxp-lp-stream-recorder --container-image=us-central1-docker.pkg.dev/chirpradio-hrd/docker-repo/stream-recorder:wcxp-lp --container-restart-policy=always --no-shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring --labels=container-vm=cos-109-17800-66-57`