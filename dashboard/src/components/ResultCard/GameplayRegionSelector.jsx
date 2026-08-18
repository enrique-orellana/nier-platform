import SourceRegionSelector from "./SourceRegionSelector";

export default function GameplayRegionSelector(props) {
  return (
    <SourceRegionSelector
      {...props}
      title="Select Gameplay Area"
      description="Draw the gameplay rectangle for the lower panel. It will be center-cropped to fill the mobile frame."
      selectionLabel="Gameplay Area"
      regionTestId="gameplay-region"
    />
  );
}
