import logging
import os 
import requests
import signal
import socket
import google.cloud.logging
from datetime import datetime
from google.cloud import storage
from http.client import HTTPConnection
from zoneinfo import ZoneInfo

# allll the logging
HTTPConnection.debuglevel = 1
logging.basicConfig()
logging.getLogger().setLevel(logging.DEBUG)
requests_log = logging.getLogger("urllib3")
requests_log.setLevel(logging.DEBUG)
requests_log.propagate = True
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
    s = socket.fromfd(r.raw.fileno(), socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPIDLE, 1)
    s.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPINTVL, 3)
    s.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPCNT, 5)

    size = 320 * 1024 # ~20 seconds of audio
    
    for chunk in r.iter_content(chunk_size=size):
        # reset timer
        signal.alarm(0)

        now = datetime.now(ZoneInfo('America/Chicago'))
        ts = now.strftime('%w-%-H-%M-%S-%Y-%m-%d')
        name = f'WCXP-LP-{ts}.mp3'
        blob = bucket.blob(name)
        writer = blob.open('wb')
        # writer.write(chunk)
        writer.close()
        logging.info(f'wrote {name}')

        # start timer
        signal.alarm(30)


try:
    record()
except Exception:
    logging.exception('Exception occurred')
