from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class LinuxKubernetesDeploymentConfigTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = (ROOT / "k8s" / "openshorts.yaml").read_text(encoding="utf-8")

    def test_workdir_is_a_hinzky_local_pv(self):
        self.assertIn("storageClassName: openshorts-local", self.manifest)
        self.assertIn("path: /var/lib/openshorts/workdir", self.manifest)
        self.assertIn("type: DirectoryOrCreate", self.manifest)
        self.assertIn("values:\n                - hinzky", self.manifest)
        self.assertNotIn("/run/desktop/mnt/host", self.manifest)

    def test_backend_and_renderer_share_workdir_and_request_nvidia_gpu(self):
        backend = self.manifest.split("name: openshorts-backend", 1)[1].split(
            "name: openshorts-backend", 1
        )[0]
        renderer = self.manifest.split("name: openshorts-renderer", 1)[1].split(
            "name: openshorts-renderer", 1
        )[0]

        for deployment in (backend, renderer):
            self.assertIn("claimName: openshorts-workdir", deployment)
            self.assertIn("nvidia.com/gpu: \"1\"", deployment)
            self.assertIn("NVIDIA_VISIBLE_DEVICES", deployment)
            self.assertIn("NVIDIA_DRIVER_CAPABILITIES", deployment)

        self.assertNotIn("/dev/dxg", backend)
        self.assertNotIn("libdxcore.so", backend)
        self.assertNotIn("privileged: true", backend)
        self.assertNotIn("SYS_PTRACE", backend)

    def test_renderer_route_and_internal_url_are_declared(self):
        self.assertIn("RENDER_SERVICE_URL: http://openshorts-renderer.openshorts.svc.cluster.local:3100", self.manifest)
        self.assertIn("path: /render", self.manifest)
        self.assertIn("path: /output", self.manifest)

    def test_public_nip_io_hosts_cover_ui_api_and_renderer(self):
        self.assertIn("ingressClassName: public", self.manifest)
        public_hosts = (
            "openshorts.192.168.50.2.nip.io",
            "api.openshorts.192.168.50.2.nip.io",
            "renderer.openshorts.192.168.50.2.nip.io",
        )
        for host in public_hosts:
            self.assertIn(f"host: {host}", self.manifest)

        self.assertIn("name: openshorts-backend\n                port:\n                  number: 8000", self.manifest)
        self.assertIn("name: openshorts-renderer\n                port:\n                  number: 3100", self.manifest)
        self.assertNotIn("name: openshorts-postgres\n                port:", self.manifest)


if __name__ == "__main__":
    unittest.main()
