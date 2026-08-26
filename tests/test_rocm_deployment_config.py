from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class RocmDeploymentConfigTests(unittest.TestCase):
    def test_backend_image_uses_the_supported_rocm_pytorch_runtime(self):
        dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")

        self.assertIn(
            "rocm/pytorch:rocm7.2.1_ubuntu24.04_py3.12_pytorch_release_2.9.1",
            dockerfile,
        )
        self.assertIn("rocdxg-roct_${ROCDXG_VERSION}_amd64.deb", dockerfile)

    def test_native_linux_rocm_profile_has_no_wsl2_dxg_dependency(self):
        dockerfile = (ROOT / "Dockerfile.rocm-linux").read_text(encoding="utf-8").lower()

        self.assertIn("rocm/pytorch:rocm7.2.1_ubuntu24.04_py3.12_pytorch_release_2.9.1", dockerfile)
        self.assertIn("openshorts_gpu_runtime=rocm-linux", dockerfile)
        self.assertNotIn("/dev/dxg", dockerfile)
        self.assertNotIn("libdxcore.so", dockerfile)
        self.assertNotIn("rocdxg-roct", dockerfile)

    def test_requirements_do_not_replace_rocm_with_nvidia_torch_packages(self):
        requirements = (ROOT / "requirements.txt").read_text(encoding="utf-8")
        dependency_lines = [
            line.strip().lower()
            for line in requirements.splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        ]

        self.assertFalse(
            any(line.startswith("nvidia-") for line in dependency_lines),
            "NVIDIA CUDA wheels must not be installed in the ROCm image",
        )
        self.assertFalse(
            any(line.startswith("torch==") for line in dependency_lines),
            "A pip torch pin would overwrite the ROCm-provided torch build",
        )
        self.assertFalse(
            any(line.startswith("torchvision==") for line in dependency_lines),
            "A pip torchvision pin could mismatch the ROCm-provided torch build",
        )

if __name__ == "__main__":
    unittest.main()
