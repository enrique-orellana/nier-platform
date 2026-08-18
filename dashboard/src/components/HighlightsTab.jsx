import React from "react";
import HighlightProjectList from "./HighlightProjectList";

export default function HighlightsTab({ getAiHeaders, aiProvider }) {
  return (
    <HighlightProjectList getAiHeaders={getAiHeaders} aiProvider={aiProvider} />
  );
}
