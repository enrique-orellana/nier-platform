export const resolveLocalEditorSourceUrl = ({
  refreshedMasterVideoUrl,
  clip,
  projectManifest,
  preferVersionSource = false,
}) =>
  (preferVersionSource ? projectManifest?.timeline?.source_video_url : null) ||
  refreshedMasterVideoUrl ||
  clip?.source_video_url ||
  clip?.original_video_url ||
  clip?.source_url ||
  projectManifest?.timeline?.source_video_url ||
  clip?.video_url ||
  "";
