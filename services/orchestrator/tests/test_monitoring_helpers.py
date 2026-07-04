import base64
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

CURRENT_DIR = Path(__file__).resolve().parent
SERVICE_DIR = CURRENT_DIR.parent
if str(SERVICE_DIR) not in sys.path:
    sys.path.append(str(SERVICE_DIR))

from audio_renderer import render_audio_payload
from log_reader import MonitoringLogReader


class MonitoringHelperTests(unittest.TestCase):
    def test_audio_renderer_returns_playable_payload(self):
        payload = render_audio_payload("System monitoring podcast update.", "<speak>System monitoring podcast update.</speak>")
        self.assertEqual(payload["mode"], "audio-first")
        self.assertTrue(payload["status"].startswith("generated-"))
        self.assertTrue(payload["base64Data"])
        decoded = base64.b64decode(payload["base64Data"])
        self.assertGreater(len(decoded), 10)

    def test_log_reader_reads_local_records_within_window(self):
        with tempfile.TemporaryDirectory(prefix="akira-log-reader-") as tmp_dir:
            log_dir = Path(tmp_dir)
            inside = datetime.now(timezone.utc)
            outside = inside - timedelta(minutes=45)
            (log_dir / "orchestrator.jsonl").write_text(
                "\n".join(
                    [
                        f'{{"dateTime":"{outside.isoformat()}","serviceName":"orchestrator","logLevel":"INFO"}}',
                        f'{{"dateTime":"{inside.isoformat()}","serviceName":"orchestrator","logLevel":"ERROR"}}',
                    ]
                ),
                encoding="utf-8",
            )
            reader = MonitoringLogReader(log_dir=log_dir)
            source, records = reader.read(inside - timedelta(minutes=15), inside + timedelta(seconds=1))
            self.assertEqual(source, "local")
            self.assertEqual(len(records), 1)
            self.assertEqual(records[0]["logLevel"], "ERROR")


if __name__ == "__main__":
    unittest.main()
