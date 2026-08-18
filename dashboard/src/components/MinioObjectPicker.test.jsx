import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MinioObjectPicker from "./MinioObjectPicker";

describe("MinioObjectPicker", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads and selects an object from the source bucket", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        bucket: "youtube-downloads",
        objects: [
          {
            key: "videos/source.bin",
            name: "source.bin",
            size: 12,
            last_modified: "2026-08-13T00:00:00Z",
          },
        ],
      }),
    });
    const onSelect = vi.fn();

    render(<MinioObjectPicker selected={null} onSelect={onSelect} />);

    expect(await screen.findByText("source.bin")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /select source\.bin/i }),
    );

    expect(onSelect).toHaveBeenCalledWith({
      bucket: "youtube-downloads",
      key: "videos/source.bin",
      name: "source.bin",
      size: 12,
      last_modified: "2026-08-13T00:00:00Z",
    });
  });

  it("shows an error and retry action when MinIO is unavailable", async () => {
    fetch.mockRejectedValueOnce(new Error("offline"));

    render(<MinioObjectPicker selected={null} onSelect={vi.fn()} />);

    expect(
      await screen.findByText(/could not load minio objects/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("reloads objects when the user searches", async () => {
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ bucket: "youtube-downloads", objects: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ bucket: "youtube-downloads", objects: [] }),
      });

    render(<MinioObjectPicker selected={null} onSelect={vi.fn()} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "source" },
    });
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("search=source"),
        expect.anything(),
      ),
    );
  });
});
