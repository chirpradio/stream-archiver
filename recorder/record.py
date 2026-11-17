import logging
import os 
import requests
import signal
import google.cloud.logging
from datetime import datetime
from google.cloud import storage
from zoneinfo import ZoneInfo

# Log at INFO. The per-chunk "wrote ..." line below is the signal used to spot
# recording gaps, so it stays. What is deliberately gone is the byte-level HTTP
# transcript: HTTPConnection.debuglevel = 1 plus DEBUG on both the root logger
# and urllib3 emitted dozens of syslog lines per 20-second chunk, including the
# raw audio bytes, which is severe write amplification on a 10 GB disk.
logging.basicConfig(level=logging.INFO)
lc = google.cloud.logging.Client()
lc.setup_logging()

# handle timeouts
class TimeoutException(Exception):
    pass

def timeout_handler(signum, frame):
    raise TimeoutException

signal.signal(signal.SIGALRM, timeout_handler)


def record():
    sc = storage.Client()
    bucket = sc.bucket(os.getenv('BUCKET_NAME'))

    r = requests.get('http://peridot.streamguys.com:5180/live', stream=True, timeout=25)
    r.raise_for_status()
    size = 320 * 1024 # ~20 seconds of audio
    
    for chunk in r.iter_content(chunk_size=size):
        # reset timer
        signal.alarm(0)

        now = datetime.now(ZoneInfo('America/Chicago'))
        ts = now.strftime('%w-%H-%M-%S-%Y-%m-%d')
        name = f'WCXP-LP-{ts}.mp3'
        blob = bucket.blob(name)
        writer = blob.open('wb')
        writer.write(chunk)
        writer.close()
        logging.info(f'wrote {name}')

        # start timer
        signal.alarm(30)


try:
    record()
except Exception:
    logging.exception('Exception occurred')
