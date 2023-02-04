FROM --platform=linux/amd64 python:3.9.16 as build

# Set environment variables
ARG GOOGLE_CLOUD_PROJECT=chirpradiodev
ENV GOOGLE_CLOUD_PROJECT=${GOOGLE_CLOUD_PROJECT}

ARG BUCKET_NAME=chirpradiodev-stream-archives
ENV BUCKET_NAME=${BUCKET_NAME}

ARG CALL_SIGN=WCXP-LP
ENV CALL_SIGN=${CALL_SIGN}

ARG STREAM_URL=http://peridot.streamguys.com:5180/live
ENV STREAM_URL=${STREAM_URL}

# Use station's local time
RUN apt-get update && apt-get install -y tzdata

ARG TZ=America/Chicago
ENV TZ=${TZ}

# Add crontab file in the cron directory
ADD crontab /etc/cron.d/recorder-cron

# Give execution rights on the cron job
RUN chmod 0644 /etc/cron.d/recorder-cron

# Create the log file to be able to run tail
RUN touch /var/log/cron.log

# Install cron
RUN apt-get -y install cron

# Set up Python script
WORKDIR /app
COPY . /app

RUN pip install -r requirements.txt

# Make environment variables available to cron jobs
RUN env >> /etc/environment

CMD ["cron", "-f"]