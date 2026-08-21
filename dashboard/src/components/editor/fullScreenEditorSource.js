export const resolveLocalEditorSourceUrl = ({
  refreshedMasterVideoUrl,
  clip,
  projectManifest,
}) =>
  refreshedMasterVideoUrl ||
  clip?.video_url ||
  clip?.source_video_url ||
  clip?.source_url ||
  projectManifest?.timeline?.source_video_url ||
  "";
