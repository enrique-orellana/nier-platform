import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ClipMetadataPanel from "./ClipMetadataPanel";

const clip = {
  start: 12,
  end: 51,
  video_title_for_youtube_short: "La foto que según él parece Juan Guarnizo",
  video_description_for_tiktok:
    "Una chica de Internet tiene una foto de cuerpo entero y le pide ayuda.",
  output_width: 1080,
  output_height: 1920,
  output_fps: 30,
  source_context: {
    who: ["Streamer"],
    what: "Launch event",
    where: "Rome",
    source_summary: "Streamer discusses a launch event in Rome.",
  },
};

describe("ClipMetadataPanel", () => {
  it("renders generated publishing metadata with boxed hashtags", () => {
    render(<ClipMetadataPanel clip={clip} />);

    expect(
      screen.getByRole("heading", { name: clip.video_title_for_youtube_short }),
    ).toBeInTheDocument();
    expect(screen.getByText("39s")).toBeInTheDocument();
    const hashtags = screen.getByRole("group", { name: "Hashtags" });
    expect(hashtags).toHaveTextContent("#shorts");
    expect(hashtags).toHaveTextContent("#viral");
    expect(screen.getByText("YouTube Title")).toBeInTheDocument();
    expect(
      screen.getByText(clip.video_title_for_youtube_short, { selector: "p" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(clip.video_description_for_tiktok),
    ).toBeInTheDocument();
    expect(screen.getByText("Timeline 01")).toBeInTheDocument();
    expect(screen.getByText("Project video")).toBeInTheDocument();
    expect(screen.getByText("9:16")).toBeInTheDocument();
    expect(screen.getByText("1080 × 1920")).toBeInTheDocument();
    expect(screen.getByText("30 fps")).toBeInTheDocument();
    expect(screen.getByText("0 cues")).toBeInTheDocument();
  });

  it("omits itself when no generated metadata is available", () => {
    const { container } = render(<ClipMetadataPanel clip={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it("replaces default hashtags using title, caption, and edited subtitles", async () => {
    const onHashtagsChange = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ hashtags: ["#gaming", "#historia", "#viral"] }),
      }),
    );

    render(
      <ClipMetadataPanel
        clip={clip}
        subtitleCues={[{ text: "Texto editado" }]}
        onHashtagsChange={onHashtagsChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /generate hashtags/i }));

    await waitFor(() =>
      expect(onHashtagsChange).toHaveBeenCalledWith([
        "#gaming",
        "#historia",
        "#viral",
      ]),
    );
    expect(screen.getByRole("group", { name: "Hashtags" })).toHaveTextContent(
      "#gaming",
    );
    expect(screen.queryByText("#shorts")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      "/api/local-editor/hashtags",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          title: clip.video_title_for_youtube_short,
          caption: clip.video_description_for_tiktok,
          subtitle_text: "Texto editado",
          source_context: clip.source_context,
        }),
      }),
    );
  });

  it("preserves existing hashtags and shows an inline error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ detail: "Provider unavailable" }),
      }),
    );

    render(<ClipMetadataPanel clip={clip} />);
    fireEvent.click(screen.getByRole("button", { name: /generate hashtags/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Provider unavailable",
      ),
    );
    expect(screen.getByRole("group", { name: "Hashtags" })).toHaveTextContent(
      "#shorts",
    );
  });
});
