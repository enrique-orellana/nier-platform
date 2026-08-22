import { z } from "zod";

const commonRequest = {
  jobId: z.string().min(1),
  clipIndex: z.number().int().min(0),
};

const genericRenderRequestSchema = z.object({
  ...commonRequest,
  props: z.object({
    videoUrl: z.string(),
    videoStartSeconds: z.number().min(0).optional(),
    durationInFrames: z.number().int().positive(),
    fps: z.number().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    videoFit: z.enum(["cover", "contain"]).optional(),
    subtitles: z.any().nullable().optional(),
    subtitleTracks: z.array(z.any()).optional(),
    activeSubtitleTrackId: z.string().nullable().optional(),
    layout: z.any().nullable().optional(),
    audio: z.any().nullable().optional(),
    hook: z.any().nullable().optional(),
    effects: z.any().nullable().optional(),
    versionId: z.string().min(1).optional(),
    manifestPath: z.string().min(1).optional(),
    manifestRevision: z.string().min(1).optional(),
  }),
});

const versionRenderRequestSchema = z.object({
  ...commonRequest,
  versionId: z.string().min(1),
  manifestRevision: z.string().min(1),
  manifest: z
    .record(z.string(), z.any())
    .refine((manifest) => Object.keys(manifest).length > 0, {
      message: "manifest must not be empty",
    }),
});

export const renderRequestSchema = z.union([
  versionRenderRequestSchema,
  genericRenderRequestSchema,
]);
