import { describe, expect, it } from "vitest";
import {
  getHookBoxStyle,
  getHookCardBorderRadius,
  getHookCardOverlap,
  getHookCardStackStyle,
  getHookPositionCoordinates,
  getHookPositionStyle,
  getHookTextLines,
  normalizeHookBoxStyle,
} from "./hookVisual";

describe("hook pixel positioning", () => {
  it("resolves preset and custom hook center points in output pixels", () => {
    expect(getHookPositionCoordinates({ position: "top" }, 1080, 1920)).toEqual(
      {
        x: 540,
        y: 154,
      },
    );
    expect(
      getHookPositionCoordinates({ position: "center" }, 1080, 1920),
    ).toEqual({ x: 540, y: 960 });
    expect(
      getHookPositionCoordinates({ position: "bottom" }, 1080, 1920),
    ).toEqual({ x: 540, y: 1574 });
    expect(
      getHookPositionCoordinates(
        { position: "custom", positionX: 700, positionY: 420 },
        1080,
        1920,
      ),
    ).toEqual({ x: 700, y: 420 });
  });

  it("rounds and clamps custom coordinates to the render canvas", () => {
    expect(
      getHookPositionCoordinates(
        { position: "custom", positionX: 1200.8, positionY: -10 },
        1080,
        1920,
      ),
    ).toEqual({ x: 1080, y: 0 });
  });

  it("resolves the streamer stack top preset at the facecam boundary", () => {
    expect(
      getHookPositionCoordinates(
        {
          position: "top",
          layoutFormat: "streamer_stack",
          facecamSize: "large",
        },
        1080,
        1920,
      ),
    ).toEqual({ x: 540, y: 883 });
  });

  it("converts custom output pixels to a centered CSS anchor", () => {
    expect(
      getHookPositionStyle(
        { position: "custom", positionX: 270, positionY: 480 },
        "standard",
        "medium",
        540,
        960,
      ),
    ).toEqual({
      left: "50%",
      top: "50%",
      bottom: "auto",
      transform: "translate(-50%, -50%)",
    });
  });

  it("preserves explicit line breaks in hook text", () => {
    expect(getHookBoxStyle({ fontSize: 48 }).whiteSpace).toBe("pre-wrap");
  });

  it("defaults missing and unknown box styles to rounded", () => {
    expect(normalizeHookBoxStyle()).toBe("rounded");
    expect(normalizeHookBoxStyle("not-a-style")).toBe("rounded");
    expect(normalizeHookBoxStyle("headline_cards")).toBe("headline_cards");
  });

  it("keeps configured visual properties while using headline card geometry", () => {
    expect(
      getHookBoxStyle({
        boxStyle: "headline_cards",
        color: "#123456",
        background: "#fedcba",
        fontFamily: "Impact",
        fontSize: 52,
      }),
    ).toMatchObject({
      color: "#123456",
      backgroundColor: "#fedcba",
      fontFamily: "Impact",
      borderRadius: "4px",
      boxShadow: "none",
      padding: "6px 12px",
    });
    expect(getHookCardStackStyle("headline_cards")).toMatchObject({
      gap: "0px",
    });
    expect(getHookCardBorderRadius("headline_cards", 0, 2)).toBe(
      "4px 4px 0px 0px",
    );
    expect(getHookCardBorderRadius("headline_cards", 1, 2)).toBe(
      "0px 0px 4px 4px",
    );
    expect(getHookCardOverlap("rounded")).toBe(0);
    expect(getHookCardOverlap("headline_cards")).toBe(2);
    expect(getHookCardOverlap("headline_cards", 1080)).toBe(6);
  });

  it("uses non-empty explicit lines for headline cards", () => {
    expect(
      getHookTextLines(" First line \n\nSecond line ", "headline_cards"),
    ).toEqual([" First line ", "Second line "]);
    expect(getHookTextLines("First line\nSecond line", "rounded")).toEqual([
      "First line\nSecond line",
    ]);
  });
});
