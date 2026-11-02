import threading
import time
from concurrent.futures import ThreadPoolExecutor
from multiprocessing import get_context

import pytest

from analysis_job_lock import analysis_job_lock


def _cross_process_lock_worker(lock_directory, result_queue):
    import os

    from analysis_job_lock import analysis_job_lock

    os.environ["AI_ANALYSIS_CONCURRENCY"] = "1"
    os.environ["LOCAL_AUDIO_ANALYSIS_LOCK_DIR"] = str(lock_directory)
    with analysis_job_lock():
        start = time.monotonic()
        time.sleep(0.1)
        result_queue.put((start, time.monotonic()))


def test_analysis_lock_serializes_jobs_across_threads(monkeypatch, tmp_path):
    monkeypatch.setenv("AI_ANALYSIS_CONCURRENCY", "1")
    monkeypatch.setenv("LOCAL_AUDIO_ANALYSIS_LOCK_DIR", str(tmp_path))
    active = 0
    maximum = 0
    guard = threading.Lock()

    def job():
        nonlocal active, maximum
        with analysis_job_lock():
            with guard:
                active += 1
                maximum = max(maximum, active)
            time.sleep(0.02)
            with guard:
                active -= 1

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda _: job(), range(8)))

    assert maximum == 1


def test_analysis_lock_serializes_jobs_across_processes(tmp_path):
    context = get_context("spawn")
    result_queue = context.Queue()
    processes = [
        context.Process(
            target=_cross_process_lock_worker, args=(tmp_path, result_queue)
        )
        for _ in range(2)
    ]
    for process in processes:
        process.start()
    intervals = [result_queue.get(timeout=10) for _ in processes]
    for process in processes:
        process.join(timeout=10)

    assert all(process.exitcode == 0 for process in processes)
    intervals.sort()
    assert intervals[0][1] <= intervals[1][0]


def test_analysis_lock_allows_reentrant_pipeline_calls(monkeypatch, tmp_path):
    monkeypatch.setenv("AI_ANALYSIS_CONCURRENCY", "1")
    monkeypatch.setenv("LOCAL_AUDIO_ANALYSIS_LOCK_DIR", str(tmp_path))

    with analysis_job_lock():
        with analysis_job_lock():
            assert True


def test_analysis_lock_rejects_invalid_concurrency(monkeypatch, tmp_path):
    monkeypatch.setenv("AI_ANALYSIS_CONCURRENCY", "0")
    monkeypatch.setenv("LOCAL_AUDIO_ANALYSIS_LOCK_DIR", str(tmp_path))

    with pytest.raises(ValueError, match="AI_ANALYSIS_CONCURRENCY"):
        with analysis_job_lock():
            pass
