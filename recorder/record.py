from google.cloud import storage
import google.cloud.logging
from datetime import datetime
import argparse
import logging
import math
import os 
import requests
import secrets
import sys
import time

class Recorder():

    last_progress = 0
    STREAM_URL = os.getenv('STREAM_URL')
    BUCKET_NAME = os.getenv('BUCKET_NAME')
    CALL_SIGN = os.getenv('CALL_SIGN')
    MAX_ATTEMPTS = 3
    MAX_ATTEMPTS_CODE = 'Exceeded maximum attempts'

    def __init__(self, mode = 'normal', test_param = None):
       self.parse_args(mode, test_param)
       self.setup_logging()

    def parse_args(self, mode, test_param):
        if mode == 'unittest':
            if test_param is None:
                sys.exit('Missing test params')

            self.start = test_param['start']
            self.duration = test_param['duration']
        else:
            parser = argparse.ArgumentParser()
            parser.add_argument('--start', dest='start', help='hour of the day the shift starts (0-23)', type=int, required=True)
            parser.add_argument('--duration', dest='duration', help='duration to record (seconds)', type=int, required=True)
            args = parser.parse_args()
            self.start = args.start
            self.duration = args.duration 

    def setup_logging(self):
        logging.basicConfig(level=logging.DEBUG)
        if os.getenv('LOGGING') == 'GC':
            client = google.cloud.logging.Client()
            client.setup_logging()

    def get_filename(self):     
        now = datetime.now()
        weekday = now.strftime('%w')
        date_string = now.strftime('%Y-%m-%d')
        # add a random token to make it harder to scrape the files
        token = secrets.token_urlsafe(4)
        return f'{self.CALL_SIGN}-{weekday}-{self.start}-{date_string}-{token}.mp3'

    def open_blob(self, filename):
        storage_client = storage.Client()
        bucket = storage_client.bucket(self.BUCKET_NAME)
        blob = bucket.blob(filename)
        return blob.open('wb')

    def log_progress(self, filename, elapsed_time):
        progress = min(round(elapsed_time / self.duration * 100), 100)
        if math.fmod(progress, 5) == 0 and progress > self.last_progress:
            logging.info(f'{filename} - {progress}% complete')
            self.last_progress = progress

    def save_streamed_response(self):
        start_time = time.time()
        filename = self.get_filename()
        file = self.open_blob(filename)
        chunk_size = 512 * 1024 # 0.5MB
        attempts = 1
        recording = True

        while recording:
            try:
                logging.info(f'Attempt #{attempts}')
                with requests.get(self.STREAM_URL, stream=True) as response:
                    response.raise_for_status()
                    logging.info(f'{filename} - starting ...')                       
                    for chunk in response.iter_content(chunk_size=chunk_size):
                        if chunk:
                            file.write(chunk)
                        else:
                            logging.info('No chunk to write')
                        
                        elapsed_time = time.time() - start_time
                        self.log_progress(filename, elapsed_time)         
                        if elapsed_time >= self.duration:
                            recording = False
                            break
            except Exception:                
                logging.exception('Exception occurred')
                attempts += 1
                if attempts <= self.MAX_ATTEMPTS:                    
                    time.sleep(attempts)
                    continue
                else:
                    recording = False
                    sys.exit(self.MAX_ATTEMPTS_CODE)

if __name__ == '__main__':    
    r = Recorder()
    r.save_streamed_response()
