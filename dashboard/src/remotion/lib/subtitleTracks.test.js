import { describe, expect, it } from "vitest";
import { makeSubtitleTracks, selectSubtitleTrack } from "./subtitleTracks";

describe("subtitle tracks", () => {
  it("keeps original and translated tracks independently selectable", () => {
    const tracks = makeSubtitleTracks(
      [{ text: "Hello", startMs: 0, endMs: 500 }],
      [{ text: "Hola", startMs: 0, endMs: 500 }],
      "es",
    );

    expect(tracks.map((track) => track.language)).toEqual(["en", "es"]);
    expect(selectSubtitleTrack(tracks, "en").id).toBe("original");
    expect(selectSubtitleTrack(tracks, "es").id).toBe("es");
  });
});
