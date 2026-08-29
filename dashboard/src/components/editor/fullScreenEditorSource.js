import { isGeneratedRenderUrl } from "../../lib/videoUrls";

export const resolveLocalEditorSourceUrl = ({
  refreshedMasterVideoUrl,
  clip,
  projectManifest,
  preferVersionSource = false,
}) => {
  const versionSource = preferVersionSource
    ? projectManifest?.timeline?.source_video_url
    : null;
  return (
    versionSource ||
    [
      refreshedMasterVideoUrl,
      clip?.source_video_url,
      clip?.original_video_url,
      clip?.source_url,
      projectManifest?.timeline?.source_video_url,
      clip?.video_url,
    ].find((url) => url && !isGeneratedRenderUrl(url)) ||
    ""
  );
};
