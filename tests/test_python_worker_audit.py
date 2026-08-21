import json

from audit_capture import AuditBodyPolicy, AuditEmitter
import python_worker


def test_child_audit_lines_are_forwarded_as_protocol_events():
    forwarded = []
    line = json.dumps({
        "type": "audit",
        "audit": {
            "phase": "start",
            "event_id": "event-1",
            "category": "stage",
            "name": "transcription.request",
        },
    })

    assert python_worker.forward_child_output_line("job-1", line, forwarded.append)
    assert forwarded == [json.loads(line) | {"id": "job-1"}]


def test_audit_emitter_records_ordered_video_processing_stages():
    events = []
    emitter = AuditEmitter(allowlist=["openrouter.ai"], emit=events.append)

    for name in (
        "source.download",
        "transcription.request",
        "ai.analysis",
        "clip.render",
        "artifact.upload",
        "scratch.cleanup",
    ):
        with emitter.stage(name):
            pass

    assert [event["audit"]["name"] for event in events if event["audit"]["phase"] == "start"] == [
        "source.download",
        "transcription.request",
        "ai.analysis",
        "clip.render",
        "artifact.upload",
        "scratch.cleanup",
    ]
    assert all(event["audit"]["phase"] == phase for event, phase in zip(events, ["start", "finish"] * 6))


def test_audit_emitter_uses_metadata_only_for_binary_transfers():
    events = []
    emitter = AuditEmitter(allowlist=["openrouter.ai"], emit=events.append)
    event_id = emitter.start_request(
        name="source.download",
        url="https://openrouter.ai/video.mp4",
        method="GET",
        request_body=None,
        binary=True,
    )
    emitter.finish_request(event_id, response_body=b"video-bytes", status_code=200, binary=True)

    assert events[0]["audit"]["capture_mode"] == "metadata_only"
    assert events[1]["audit"]["response_body"] == ""
