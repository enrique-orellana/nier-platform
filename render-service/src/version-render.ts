export function outputFileNameForVersion(
  clipIndex: number,
  versionId: string | undefined,
  timestamp: number
): string {
  return versionId
    ? `version_${clipIndex}_${versionId}_${timestamp}.mp4`
    : `remotion_${clipIndex}_${timestamp}.mp4`;
}
