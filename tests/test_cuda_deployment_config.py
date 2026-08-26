from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class CudaDeploymentConfigTests(unittest.TestCase):
    def test_cuda_backend_uses_the_pinned_pytorch_runtime_and_nvidia_capabilities(self):
        dockerfile = (ROOT / "Dockerfile.cuda").read_text(encoding="utf-8")

        self.assertIn("pytorch/pytorch:2.9.1-cuda12.6-cudnn9-runtime", dockerfile)
        self.assertIn("OPENSHORTS_GPU_RUNTIME=cuda", dockerfile)
        self.assertIn("NVIDIA_VISIBLE_DEVICES=all", dockerfile)
        self.assertIn("NVIDIA_DRIVER_CAPABILITIES=compute,utility,video", dockerfile)
        self.assertIn("ARG OPENSHORTS_DEVICE=auto", dockerfile)
        self.assertIn("OPENSHORTS_DEVICE=${OPENSHORTS_DEVICE}", dockerfile)

    def test_cuda_backend_has_no_wsl2_dxg_dependencies(self):
        dockerfile = (ROOT / "Dockerfile.cuda").read_text(encoding="utf-8").lower()

        self.assertNotIn("/dev/dxg", dockerfile)
        self.assertNotIn("libdxcore.so", dockerfile)


if __name__ == "__main__":
    unittest.main()
