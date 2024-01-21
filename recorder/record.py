from google.cloud import storage
import google.cloud.logging
from datetime import datetime
import argparse
import logging
import math
import os 
import requests
import secrets
import time

STREAM_URL = os.getenv('STREAM_URL')
BUCKET_NAME = os.getenv('BUCKET_NAME')
CALL_SIGN = os.getenv('CALL_SIGN')

parser = argparse.ArgumentParser()
parser.add_argument('--start', dest='start', help='hour of the day the shift starts (0-23)', type=int, required=True)
parser.add_argument('--duration', dest='duration', help='duration to record (seconds)', type=int, required=True)
args = parser.parse_args()

def setup_logging():
    logging.basicConfig(level=logging.DEBUG)
    if os.getenv('LOGGING') == 'GC':
        client = google.cloud.logging.Client()
        client.setup_logging()

def get_filename():     
    now = datetime.now()
    weekday = now.strftime('%w')
    date_string = now.strftime('%Y-%m-%d')
    # add a random token to make it harder to scrape the files
    token = secrets.token_urlsafe(4)
    return f'{CALL_SIGN}-{weekday}-{args.start}-{date_string}-{token}.mp3'

def open_blob(filename):
    storage_client = storage.Client()
    bucket = storage_client.bucket(BUCKET_NAME)
    blob = bucket.blob(filename)
    return blob.open('wb')

last_progress = 0

def log_progress(filename, elapsed_time):
    global last_progress
    progress = min(round(elapsed_time / args.duration * 100), 100)
    if math.fmod(progress, 5) == 0 and progress > last_progress:
        logging.info(f'{filename} - {progress}% complete')
        last_progress = progress

def save_streamed_response():
    start_time = time.time()
    filename = get_filename()
    file = open_blob(filename)
    chunk_size = 512 * 1024 # 0.5MB
    retries = 0
    max_retries = 3
    recording = True

    while recording:
        try:
            logging.info(f'Attempt #{retries + 1}')
            with requests.get(STREAM_URL, stream=True) as response:
                response.raise_for_status()
                logging.info(f'{filename} - starting ...')                 
                for chunk in response.iter_content(chunk_size=chunk_size):
                    if chunk:
                        file.write(chunk)
                    else:
                        logging.info('No chunk to write')
                    
                    elapsed_time = time.time() - start_time
                    log_progress(filename, elapsed_time)         
                    if elapsed_time >= args.duration:
                        recording = False
                        break
        except Exception:
            logging.exception('Exception occurred')
            if retries < max_retries:
                retries += 1
                time.sleep(retries)
                continue
            else:
                recording = False
                break

if __name__ == '__main__':    
    setup_logging()
    save_streamed_response()
