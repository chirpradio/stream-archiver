from google.cloud import storage
from datetime import datetime
import argparse
import time
import requests
import logging
import math
import os 
import secrets

STREAM_URL = os.getenv('STREAM_URL')
BUCKET_NAME = os.getenv('BUCKET_NAME')
CALL_SIGN = os.getenv('CALL_SIGN')

parser = argparse.ArgumentParser()
parser.add_argument('--start', dest='start', help='hour of the day the shift starts (0-23)', type=int, required=True)
parser.add_argument('--duration', dest='duration', help='duration to record (seconds)', type=int, required=True)
args = parser.parse_args()

logging.basicConfig(level=logging.DEBUG)

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

def log_progress(filename, elapsed):
    global last_progress
    progress = round(elapsed / args.duration * 100)
    if math.fmod(progress, 5) == 0 and progress > last_progress:
        logging.info(f'{filename} - {progress}% complete')
        last_progress = progress

if __name__ == "__main__": 
    start_time = time.time()    
    filename = get_filename()
    logging.info(f'{filename} - starting ...') 
    blob_writer = open_blob(filename) 
    r = requests.get(STREAM_URL, stream=True)
    with blob_writer as f:
        try:
            while True:                
                for block in r.iter_content(10000):                
                    f.write(block)                
                    elapsed = time.time() - start_time 
                    if elapsed > args.duration:                        
                        break
                    else: 
                        log_progress(filename, elapsed)                      
                logging.info(f'{filename} - complete')
                break
        except Exception as e:
            logging.exception('Exception occurred')