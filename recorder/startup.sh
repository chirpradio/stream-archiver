# Install or update needed software
apt-get update
apt-get install -yq git supervisor python3-pip python3-virtualenv logrotate

# Fetch source code
export HOME=/root
git clone --branch $(curl http://metadata.google.internal/computeMetadata/v1/instance/attributes/BRANCH -H "Metadata-Flavor: Google") https://github.com/chirpradio/stream-archiver.git /opt/app

# Install Cloud Ops Agent
sudo bash /opt/app/recorder/add-google-cloud-ops-agent-repo.sh --also-install

# Account to own recording process
useradd -m -d /home/recorder recorder

# Python environment setup
virtualenv -p python3 /opt/app/recorder/env
/bin/bash -c "source /opt/app/recorder/env/bin/activate"
/opt/app/recorder/env/bin/pip install -r /opt/app/recorder/requirements.txt

# Add environment variable from metadata
echo -n ,BUCKET_NAME=\"$(curl http://metadata.google.internal/computeMetadata/v1/instance/attributes/BUCKET_NAME -H "Metadata-Flavor: Google")\" >> /opt/app/recorder/recorder.conf

# Set ownership to newly created account
chown -R recorder:recorder /opt/app

# Put configuration files in place
cp /opt/app/recorder/recorder.conf /etc/supervisor/conf.d/recorder.conf
cp /opt/app/recorder/logrotate/rsyslog /etc/logrotate.d/rsyslog

# Start service via supervisorctl
supervisorctl reread
supervisorctl update