import asyncio
import io

import app as app_module


class ImmediateProcess:
    returncode = 0
    stdout = io.BytesIO()

    def poll(self):
        return self.returncode


class FakeSemaphore:
    def __init__(self):
        self.released = 0

    def release(self):
        self.released += 1


class FakeQueue:
    def __init__(self):
        self.completed = 0

    def task_done(self):
        self.completed += 1


def test_run_job_prepares_command_before_logging(monkeypatch, tmp_path):
    job_id = "job-command-order"
    jobs = {
        job_id: {
            "status": "queued",
            "logs": [],
            "env": {},
            "output_dir": str(tmp_path),
            "cmd": ["python", "-u", "main.py"],
            "source_object": {"bucket": "youtube-downloads", "key": "videos/source.mp4"},
        }
    }
    monkeypatch.setattr(app_module, "jobs", jobs)
    monkeypatch.setattr(app_module, "_prepare_minio_job_command", lambda *_args: (["python", "-u", "main.py", "--input", "source.bin"], None))
    monkeypatch.setattr(app_module.subprocess, "Popen", lambda *_args, **_kwargs: ImmediateProcess())

    asyncio.run(app_module.run_job(job_id, jobs[job_id]))

    assert jobs[job_id]["status"] == "failed"
    assert "Execution error" not in "\n".join(jobs[job_id]["logs"])


def test_run_job_wrapper_marks_unexpected_errors_as_failed(monkeypatch):
    job_id = "job-wrapper-error"
    jobs = {job_id: {"status": "processing", "logs": []}}
    semaphore = FakeSemaphore()
    queue = FakeQueue()

    async def failing_run_job(*_args):
        raise RuntimeError("worker exploded")

    monkeypatch.setattr(app_module, "jobs", jobs)
    monkeypatch.setattr(app_module, "concurrency_semaphore", semaphore)
    monkeypatch.setattr(app_module, "job_queue", queue)
    monkeypatch.setattr(app_module, "run_job", failing_run_job)

    asyncio.run(app_module.run_job_wrapper(job_id))

    assert jobs[job_id]["status"] == "failed"
    assert jobs[job_id]["logs"] == ["Execution error: worker exploded"]
    assert semaphore.released == 1
    assert queue.completed == 1
