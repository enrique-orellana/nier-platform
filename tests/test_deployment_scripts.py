from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class DeploymentScriptTests(unittest.TestCase):
    def test_remote_scripts_define_linux_gpu_profiles_and_defaults(self):
        for name in ("deploy-remote.ps1", "deploy-remote.sh"):
            script = (ROOT / "scripts" / name).read_text(encoding="utf-8").lower()
            for profile in ("cuda", "rocm-linux", "rocm-wsl", "cpu"):
                self.assertIn(profile, script, name)
            self.assertIn("open shorts_gpu_runtime".replace(" ", ""), script, name)
            self.assertIn("hinzky", script, name)
            self.assertIn("/var/lib/openshorts/workdir", script, name)
            self.assertIn("dockerfile.cuda", script, name)
            self.assertIn("dockerfile.rocm-linux", script, name)

    def test_local_scripts_preserve_windows_rocm_default_and_allow_profiles(self):
        for name in ("deploy-local.ps1", "deploy-local.sh"):
            script = (ROOT / "scripts" / name).read_text(encoding="utf-8").lower()
            self.assertIn("openshorts_gpu_runtime", script, name)
            self.assertIn("rocm-wsl", script, name)
            self.assertIn("dockerfile", script, name)

    def test_scripts_configure_renderer_acceleration(self):
        for name in ("deploy-remote.ps1", "deploy-remote.sh", "deploy-local.ps1", "deploy-local.sh"):
            script = (ROOT / "scripts" / name).read_text(encoding="utf-8")
            self.assertIn("RENDER_ACCELERATOR", script, name)
            self.assertIn("RENDER_HARDWARE_ACCELERATION", script, name)

    def test_remote_scripts_apply_the_postgres_statefulset_bundle(self):
        for name in ("deploy-remote.ps1", "deploy-remote.sh"):
            script = (ROOT / "scripts" / name).read_text(encoding="utf-8")
            self.assertIn("openshorts-postgres.yaml", script, name)

    def test_postgres_rollout_checks_target_the_statefulset(self):
        for name in ("deploy-local.ps1", "deploy-local.sh", "deploy-remote.ps1", "deploy-remote.sh"):
            script = (ROOT / "scripts" / name).read_text(encoding="utf-8")
            self.assertIn("statefulset/openshorts-postgres", script, name)


if __name__ == "__main__":
    unittest.main()
