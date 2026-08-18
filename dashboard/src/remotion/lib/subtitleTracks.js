export function makeSubtitleTracks(
  originalCaptions,
  translatedCaptions,
  language,
) {
  const tracks = [
    {
      id: "original",
      language: "en",
      label: "Original",
      origin: "original",
      captions: originalCaptions,
    },
  ];

  if (translatedCaptions) {
    tracks.push({
      id: language,
      language,
      label: language,
      sourceTrackId: "original",
      origin: "translation",
      captions: translatedCaptions,
    });
  }

  return tracks;
}

export function selectSubtitleTrack(tracks, id) {
  const selected = tracks.find(
    (track) => track.id === id || track.language === id,
  );
  if (!selected) throw new Error(`Subtitle track not found: ${id}`);
  return selected;
}
