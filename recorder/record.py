from google.cloud import storage
import google.cloud.logging
from datetime import datetime
from zoneinfo import ZoneInfo
import logging
import os 
import requests

sc = storage.Client()
bucket = sc.bucket(os.getenv('BUCKET_NAME'))

logging.basicConfig(level=logging.DEBUG)
lc = google.cloud.logging.Client()
lc.setup_logging()
logging.getLogger().setLevel(logging.DEBUG)

def record():
    size = 256 * 1024 # roughly 15 seconds
    r = requests.get('http://peridot.streamguys.com:5180/live', stream=True)
    r.raise_for_status()

    for chunk in r.iter_content(chunk_size=size):
        now = datetime.now(ZoneInfo('America/Chicago'))
        ts = now.strftime('%Y-%m-%d-%w-%H-%M-%S')
        name = f'WCXP-LP-{ts}.mp3'
        blob = bucket.blob(name)
        writer = blob.open('wb')
        writer.write(chunk)
        writer.close()
        logging.info(f'wrote {name}')        


try:
    record()
except Exception:
    logging.exception('Exception occurred')
