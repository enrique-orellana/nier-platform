import unittest

import app


class ImproveClipQualityCommandTests(unittest.TestCase):
    def test_quality_reencode_endpoint_is_removed(self):
        paths = {route.path for route in app.app.routes}
        self.assertNotIn("/api/clip/{job_id}/{clip_index}/quality", paths)
