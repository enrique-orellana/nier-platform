import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ClipMetadataPanel from "./ClipMetadataPanel";

const clip = {
  start: 12,
  end: 51,
  video_title_for_youtube_short: "La foto que según él parece Juan Guarnizo",
  video_description_for_tiktok:
    "Una chica de Internet tiene una foto de cuerpo entero y le pide ayuda.",
  video_description_for_instagram:
    "Rubius encuentra una mejora decisiva en Meltopia.",
  viral_hook_text: "ESTO LO CAMBIA TODO",
  output_width: 1080,
  output_height: 1920,
  output_fps: 30,
  source_context: {
    who: ["Streamer"],
    what: "Launch event",
    where: "Rome",
    source_summary: "Streamer discusses a launch event in Rome.",
  },
  source_metadata: {
    platform: "youtube",
    title: "Rubius juega Meltopia y desbloquea mejoras",
    channel: "Rubius",
    description: "Partida de Meltopia con mejoras del arma.",
    categories: ["Gaming"],
    tags: ["Meltopia", "Rubius"],
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
          source_metadata: clip.source_metadata,
          source_context: clip.source_context,
        }),
      }),
    );
  });

  it("regenerates clip information with the live clip context", async () => {
    const onClipInfoChange = vi.fn();
    const nextInfo = {
      video_title_for_youtube_short:
        "Rubius compra el upgrade final del arma en Meltopia",
      video_description_for_tiktok:
        "Rubius llega justo al dinero y compra el último upgrade del arma 🔥💸",
      video_description_for_instagram:
        "Rubius desbloquea la mejora final del arma en Meltopia 😭🔥",
      viral_hook_text: "ESTO LO CAMBIA TODO",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => nextInfo,
      }),
    );

    render(
      <ClipMetadataPanel
        clip={clip}
        subtitleCues={[{ text: "Texto editado" }]}
        trimStartSeconds={120}
        trimEndSeconds={158}
        sourceMetadata={clip.source_metadata}
        onClipInfoChange={onClipInfoChange}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /regenerate clip information/i }),
    );

    await waitFor(() =>
      expect(onClipInfoChange).toHaveBeenCalledWith(nextInfo),
    );
    expect(
      screen.getByRole("heading", {
        name: nextInfo.video_title_for_youtube_short,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(nextInfo.video_description_for_tiktok),
    ).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      "/api/local-editor/clip-info",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          subtitle_text: "Texto editado",
          trim_start_seconds: 120,
          trim_end_seconds: 158,
          source_metadata: clip.source_metadata,
          source_context: clip.source_context,
        }),
      }),
    );
  });

  it("preserves clip information and shows an inline error when regeneration fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ detail: "Provider unavailable" }),
      }),
    );

    render(<ClipMetadataPanel clip={clip} />);
    fireEvent.click(
      screen.getByRole("button", { name: /regenerate clip information/i }),
    );

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Provider unavailable",
      ),
    );
    expect(
      screen.getByRole("heading", {
        name: clip.video_title_for_youtube_short,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(clip.video_description_for_tiktok),
    ).toBeInTheDocument();
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

  it("syncs displayed clip information when the clip prop changes", async () => {
    const { rerender } = render(<ClipMetadataPanel clip={clip} />);
    const nextClip = {
      ...clip,
      video_title_for_youtube_short: "Nuevo título del clip",
      video_description_for_tiktok: "Nueva descripción del clip",
    };

    rerender(<ClipMetadataPanel clip={nextClip} />);

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Nuevo título del clip" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Nueva descripción del clip")).toBeInTheDocument();
  });
});
