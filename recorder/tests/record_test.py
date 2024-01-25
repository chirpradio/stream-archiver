import unittest
from unittest.mock import MagicMock, patch
from record import Recorder
from random import randbytes
from requests import Response

class recorderTests(unittest.TestCase):
    def setUp(self):
        mode = 'unittest'
        test_param = {
            'start': 1,
            'duration': 1
        }     
        self.recorder = Recorder(mode, test_param)
        self.recorder.open_blob = MagicMock()
        self.mock_time_sleep = patch('time.sleep')

    def infinite_stream(self, chunk_size, decode_content):
        while True:
            yield randbytes(chunk_size)   

    def interrupted_stream(self, chunk_size, decode_content):
        n = 0
        while True:
            if n == 2:
                raise ConnectionResetError
            else:
                yield randbytes(chunk_size)
                n += 1

    def get_response(self, status_code):
        mock_response = Response()
        mock_response.raw = MagicMock()
        mock_response.raw.stream = self.infinite_stream
        mock_response.status_code = status_code 
        return mock_response   

    @patch('requests.get')
    def test_requests_stream(self, mock_get):
        mock_response = self.get_response(200)        
        mock_get.return_value = mock_response

        self.recorder.save_streamed_response()        
        mock_get.assert_called_with(self.recorder.STREAM_URL, stream=True)

    @patch('requests.get')
    def test_max_attempts(self, mock_get):
        mock_get.return_value = self.get_response(429)      
        
        with self.assertRaises(SystemExit) as context:
            self.recorder.save_streamed_response()   
        self.assertEqual(mock_get.call_count, self.recorder.MAX_ATTEMPTS)         
        self.assertEqual(context.exception.code, 1)

    @patch('requests.get')
    def test_retries_on_reset(self, mock_get):
        mock_response = self.get_response(200)
        mock_response.raw.stream = self.interrupted_stream
        mock_get.return_value = mock_response

        self.recorder.save_streamed_response()
        self.assertEqual(mock_get.call_count, 2)



if __name__ == '__main__':
    unittest.main()