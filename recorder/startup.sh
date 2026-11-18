#!/bin/bash
#
# Provisioning for the stream-archive-recorder VM.
#
# GCE runs a startup script on EVERY boot, and this instance is stopped at
# 03:15 and started at 05:30 America/Chicago by the `restart-stream-recorder`
# instance schedule (see create-schedule.sh). Every step below must therefore
# be safe to run repeatedly.
#
# The previous version was not. On each boot it re-ran:
#
#   git clone ... /opt/app     -> failed ("already exists and is not empty"),
#                                 so merged recorder changes never deployed
#   virtualenv -p python3 env  -> rewrote the virtualenv underneath the
#   pip install -r ...            recorder that supervisord had already
#                                 autostarted out of that same directory
#
# On 2026-11-16 and 2026-11-17 that rewrite was killed partway through, the
# recorder never came back, and ~43 hours of shows were lost. Keep this
# script idempotent.

set -uo pipefail

log() { echo "provision: $*"; }

metadata() {
  curl -fsS -H 'Metadata-Flavor: Google' \
    "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1" 2>/dev/null
}

APP_DIR=/opt/app
RECORDER_DIR="$APP_DIR/recorder"
VENV_DIR="$RECORDER_DIR/env"
STAMP="$VENV_DIR/.requirements-sha256"
REPO=https://github.com/chirpradio/stream-archiver.git

BRANCH="$(metadata BRANCH)"
BRANCH="${BRANCH:-main}"
BUCKET_NAME="$(metadata BUCKET_NAME)"

if [ -z "$BUCKET_NAME" ]; then
  log "FATAL: BUCKET_NAME metadata is missing; refusing to configure the recorder"
  exit 1
fi
log "branch=$BRANCH bucket=$BUCKET_NAME"

# --- packages --------------------------------------------------------------
# apt is naturally idempotent; later boots report "already the newest
# version". logrotate matters here because the recorder is a heavy syslog
# writer and this instance has a 10 GB disk.
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq || log "WARNING: apt-get update failed, continuing"
apt-get install -yq git supervisor python3-pip python3-virtualenv logrotate \
  || log "WARNING: apt-get install failed, continuing with installed versions"

# --- source code -----------------------------------------------------------
# Clone once; afterwards fetch and hard-reset, so changes merged to the
# tracked branch actually reach the instance. recorder/env is untracked, so
# the reset leaves the virtualenv in place.
export HOME=/root
if [ -d "$APP_DIR/.git" ]; then
  if git -C "$APP_DIR" fetch --quiet origin "$BRANCH" \
    && git -C "$APP_DIR" reset --hard --quiet "origin/$BRANCH"; then
    log "updated to $(git -C "$APP_DIR" rev-parse --short HEAD) on $BRANCH"
  else
    log "WARNING: update failed; keeping $(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  fi
elif git clone --quiet --branch "$BRANCH" "$REPO" "$APP_DIR"; then
  log "cloned $(git -C "$APP_DIR" rev-parse --short HEAD) on $BRANCH"
else
  log "FATAL: clone failed and there is no code on disk"
  exit 1
fi

# --- Cloud Ops Agent -------------------------------------------------------
if dpkg -s google-cloud-ops-agent >/dev/null 2>&1; then
  log "ops agent already installed"
else
  log "installing ops agent"
  bash "$RECORDER_DIR/add-google-cloud-ops-agent-repo.sh" --also-install \
    || log "WARNING: ops agent install failed"
fi

# --- account that owns the recording process -------------------------------
id -u recorder >/dev/null 2>&1 || useradd -m -d /home/recorder recorder

# --- virtualenv ------------------------------------------------------------
# Built once and then left alone. Rebuilt only when requirements.txt changes,
# and the recorder is stopped first so nothing is executing out of the
# directory while it is replaced. The stamp is written only after pip
# succeeds, so an interrupted install retries on the next boot rather than
# leaving behind a venv that looks finished but is not.
REQ_HASH="$(sha256sum "$RECORDER_DIR/requirements.txt" | cut -d' ' -f1)"
if [ -x "$VENV_DIR/bin/python3" ] && [ "$(cat "$STAMP" 2>/dev/null)" = "$REQ_HASH" ]; then
  log "virtualenv is current, leaving it untouched"
else
  log "building virtualenv"
  supervisorctl stop recorder >/dev/null 2>&1 || true
  if virtualenv --clear -p python3 "$VENV_DIR" \
    && "$VENV_DIR/bin/pip" install --quiet --no-input -r "$RECORDER_DIR/requirements.txt"; then
    echo "$REQ_HASH" >"$STAMP"
    log "virtualenv ready"
  else
    log "FATAL: virtualenv/pip failed; the next boot will retry"
    exit 1
  fi
fi

chown -R recorder:recorder "$APP_DIR"

# --- supervisor and logrotate configuration --------------------------------
# BUCKET_NAME is injected as the config is written out. The old script
# appended it to the repo's own copy of recorder.conf on every boot, which
# grew that file and left the working tree dirty.
sed "s|^environment=|environment=BUCKET_NAME=\"$BUCKET_NAME\",|" \
  "$RECORDER_DIR/recorder.conf" >/etc/supervisor/conf.d/recorder.conf
chmod 0644 /etc/supervisor/conf.d/recorder.conf

cp "$RECORDER_DIR/logrotate/rsyslog" /etc/logrotate.d/rsyslog

supervisorctl reread
supervisorctl update
# `update` only (re)starts programs whose config changed, so start explicitly
# in case the virtualenv rebuild above left the recorder stopped.
supervisorctl start recorder >/dev/null 2>&1 || true
supervisorctl status recorder || true
log "done"
