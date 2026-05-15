import os
import sys
import unittest
from urllib.parse import parse_qs, urlparse

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.config import Settings


class TestRealtimeTranscriptionConfig(unittest.TestCase):
    def test_default_transcription_websocket_url_uses_transcription_intent(self):
        default_url = Settings.model_fields["OPENAI_TRANSCRIPTION_WS_URL"].default
        parsed = urlparse(default_url)
        query = parse_qs(parsed.query)

        self.assertEqual(parsed.scheme, "wss")
        self.assertEqual(parsed.netloc, "api.openai.com")
        self.assertEqual(parsed.path, "/v1/realtime")
        self.assertEqual(query.get("intent"), ["transcription"])
        self.assertNotIn("model", query)


if __name__ == "__main__":
    unittest.main()
