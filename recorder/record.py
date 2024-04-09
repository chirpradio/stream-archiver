import logging
import os 
import requests
import signal
import google.cloud.logging
from datetime import datetime
from google.cloud import storage
from http.client import HTTPConnection
from zoneinfo import ZoneInfo

sc = storage.Client()
bucket = sc.bucket(os.getenv('BUCKET_NAME'))

# allll the logging
HTTPConnection.debuglevel = 1
logging.basicConfig()
logging.getLogger().setLevel(logging.DEBUG)
requests_log = logging.getLogger("urllib3")
requests_log.setLevel(logging.DEBUG)
requests_log.propagate = True
lc = google.cloud.logging.Client()
lc.setup_logging()
logging.getLogger().setLevel(logging.DEBUG)

r = requests.get('http://peridot.streamguys.com:5180/live', stream=True, timeout=15)
r.raise_for_status()

# handle timeouts
class TimeoutException(Exception):
    pass

def timeout_handler(signum, frame):
    r.raise_for_status()
    raise TimeoutException

signal.signal(signal.SIGALRM, timeout_handler)


def record():
    size = 256 * 1024 # roughly 15 seconds
    for chunk in r.iter_content(chunk_size=size):
        # reset timeout
        signal.alarm(0)

        now = datetime.now(ZoneInfo('America/Chicago'))
        ts = now.strftime('%w-%-H-%M-%S-%Y-%m-%d')
        name = f'WCXP-LP-{ts}.mp3'
        blob = bucket.blob(name)
        writer = blob.open('wb')
        writer.write(chunk)
        writer.close()
        logging.info(f'wrote {name}')

        # start timeout
        signal.alarm(20)


try:
    record()
    logging.info('stopped recording')
except Exception:
    logging.exception('Exception occurred')
logging.info('out of try block')
