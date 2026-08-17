import os
import unittest
from unittest.mock import patch

import runtime_acceleration


class RuntimeAccelerationTests(unittest.TestCase):
    def test_auto_selects_cuda_for_accelerated_inference(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(
            runtime_acceleration, "cuda_available", return_value=True
        ):
            self.assertEqual(runtime_acceleration.preferred_device(), "cuda")

    def test_cpu_override_disables_cuda(self):
        with patch.dict(os.environ, {"OPENSHORTS_DEVICE": "cpu"}, clear=False), patch.object(
            runtime_acceleration, "cuda_available", return_value=True
        ):
            self.assertEqual(runtime_acceleration.preferred_device(), "cpu")

    def test_cuda_falls_back_to_cpu_when_no_adapter_is_available(self):
        with patch.dict(os.environ, {"OPENSHORTS_DEVICE": "cuda"}, clear=False), patch.object(
            runtime_acceleration, "cuda_available", return_value=False
        ):
            self.assertEqual(runtime_acceleration.preferred_device(), "cpu")
