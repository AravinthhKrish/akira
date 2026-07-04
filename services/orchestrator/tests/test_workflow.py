import unittest
import sys
from pathlib import Path

CURRENT_DIR = Path(__file__).resolve().parent
SERVICE_DIR = CURRENT_DIR.parent
if str(SERVICE_DIR) not in sys.path:
    sys.path.append(str(SERVICE_DIR))

from worker_client import WorkerClient


class WorkerClientTests(unittest.TestCase):
    def test_citation_validation_drops_uncited_lines(self):
        client = WorkerClient(None)
        script = {
            "episodeTitle": "Demo",
            "summary": "Summary",
            "scriptSections": [
                {
                    "heading": "Intro",
                    "lines": [
                        {"text": "Allowed", "citations": ["src_1"]},
                        {"text": "Dropped", "citations": ["missing"]},
                    ],
                }
            ],
        }
        validated = client.execute(
            "citation_validator",
            {
                "script": script,
                "sources": [{"id": "src_1", "title": "Source"}],
            },
        )
        self.assertEqual(len(validated["scriptSections"][0]["lines"]), 1)
        self.assertEqual(validated["validation"]["droppedLines"], 1)


if __name__ == "__main__":
    unittest.main()
