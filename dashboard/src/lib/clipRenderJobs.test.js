import { describe, expect, it } from "vitest";

import { activeClipRenderJobs } from "./clipRenderJobs";

describe("activeClipRenderJobs", () => {
  it("rehydrates queued and processing clip renders", () => {
    expect(
      activeClipRenderJobs([
        { clip_index: 0, job_id: "queued-job", status: "queued" },
        { clip_index: 1, job_id: "processing-job", status: "processing" },
        { clip_index: 2, job_id: "rendering-job", status: "rendering" },
      ]),
    ).toEqual({
      0: "queued-job",
      1: "processing-job",
      2: "rendering-job",
    });
  });

  it("ignores terminal and malformed records", () => {
    expect(
      activeClipRenderJobs([
        { clip_index: 0, job_id: "completed-job", status: "completed" },
        { clip_index: 1, job_id: "failed-job", status: "failed" },
        { clip_index: "2", job_id: "bad-index", status: "processing" },
        { clip_index: 3, status: "processing" },
      ]),
    ).toEqual({});
  });
});
