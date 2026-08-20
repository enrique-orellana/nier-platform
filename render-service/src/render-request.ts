import { z } from "zod";

export const renderRequestSchema = z.object({
  jobId: z.string().min(1),
  clipIndex: z.number().int().min(0),
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
    hook: z.any().nullable().optional(),
    effects: z.any().nullable().optional(),
    versionId: z.string().min(1).optional(),
    manifestPath: z.string().min(1).optional(),
    manifestRevision: z.string().min(1).optional(),
  }),
});
