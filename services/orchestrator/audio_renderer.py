from __future__ import annotations

import base64
import io
import math
import shutil
import struct
import subprocess
import tempfile
import wave
from pathlib import Path


def _generate_tone_wav(transcript: str) -> bytes:
    sample_rate = 8000
    duration_per_chunk = 0.18
    pause_duration = 0.05
    chunks = max(4, min(28, len(transcript.split())))
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        frames = bytearray()
        for index in range(chunks):
            frequency = 360 + (index % 5) * 60
            total_samples = int(sample_rate * duration_per_chunk)
            pause_samples = int(sample_rate * pause_duration)
            for sample_index in range(total_samples):
                amplitude = 9000 if sample_index < total_samples * 0.85 else 2000
                value = int(amplitude * math.sin(2 * math.pi * frequency * sample_index / sample_rate))
                frames.extend(struct.pack("<h", value))
            for _ in range(pause_samples):
                frames.extend(struct.pack("<h", 0))
        wav.writeframes(bytes(frames))
    return buffer.getvalue()


def render_audio_payload(transcript: str, ssml: str) -> dict:
    say_command = shutil.which("say")
    if say_command:
        tmp_dir = Path(tempfile.mkdtemp(prefix="akira-monitoring-audio-"))
        output_path = tmp_dir / "monitoring.aiff"
        try:
            subprocess.run([say_command, "-o", str(output_path), transcript], check=True, capture_output=True)
            audio_bytes = output_path.read_bytes()
            return {
                "mode": "audio-first",
                "status": "generated-voice",
                "mimeType": "audio/aiff",
                "encoding": "base64",
                "base64Data": base64.b64encode(audio_bytes).decode("ascii"),
                "transcript": transcript,
                "ssml": ssml,
            }
        except Exception:
            pass
        finally:
            try:
                if output_path.exists():
                    output_path.unlink()
                tmp_dir.rmdir()
            except Exception:
                pass

    wav_bytes = _generate_tone_wav(transcript)
    return {
        "mode": "audio-first",
        "status": "generated-tone",
        "mimeType": "audio/wav",
        "encoding": "base64",
        "base64Data": base64.b64encode(wav_bytes).decode("ascii"),
        "transcript": transcript,
        "ssml": ssml,
    }
