import os
import sys
import types
import unittest
from unittest.mock import patch

import runtime_acceleration


class RuntimeAccelerationTests(unittest.TestCase):
    def test_auto_selects_cuda_and_gpu_whisper_precision(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(
            runtime_acceleration, "cuda_available", return_value=True
        ):
            self.assertEqual(runtime_acceleration.preferred_device(), "cuda")
            self.assertEqual(runtime_acceleration.whisper_runtime(), ("cuda", "float16"))

    def test_cpu_override_disables_cuda(self):
        with patch.dict(os.environ, {"OPENSHORTS_DEVICE": "cpu"}, clear=False), patch.object(
            runtime_acceleration, "cuda_available", return_value=True
        ):
            self.assertEqual(runtime_acceleration.preferred_device(), "cpu")
            self.assertEqual(runtime_acceleration.whisper_runtime(), ("cpu", "int8"))

    def test_cuda_falls_back_to_cpu_when_no_adapter_is_available(self):
        with patch.dict(os.environ, {"OPENSHORTS_DEVICE": "cuda"}, clear=False), patch.object(
            runtime_acceleration, "cuda_available", return_value=False
        ):
            self.assertEqual(runtime_acceleration.preferred_device(), "cpu")
            self.assertEqual(runtime_acceleration.whisper_runtime(), ("cpu", "int8"))

    def test_whisper_model_falls_back_to_cpu_if_cuda_backend_rejects_gpu(self):
        calls = []

        class FakeWhisperModel:
            def __init__(self, model_size, *, device, compute_type):
                calls.append((model_size, device, compute_type))
                if device == "cuda":
                    raise RuntimeError("CUDA libraries unavailable")

        fake_module = types.ModuleType("faster_whisper")
        fake_module.WhisperModel = FakeWhisperModel
        with patch.dict(sys.modules, {"faster_whisper": fake_module}), patch.object(
            runtime_acceleration, "whisper_runtime", return_value=("cuda", "float16")
        ):
            runtime_acceleration.build_whisper_model("large-v3")

        self.assertEqual(
            calls,
            [
                ("large-v3", "cuda", "float16"),
                ("large-v3", "cpu", "int8"),
            ],
        )
