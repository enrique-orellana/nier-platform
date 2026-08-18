import SourceRegionSelector from "./SourceRegionSelector";

export default function WebcamRegionSelector(props) {
  return (
    <SourceRegionSelector
      {...props}
      title="Select Webcam Area"
      description="Draw the webcam box used for the upper panel."
      selectionLabel="Webcam Area"
      regionTestId="webcam-region"
    />
  );
}
