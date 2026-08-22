import { FileText, FolderOpen, History, Info, Sparkles } from "lucide-react";

export const LOCAL_EDITOR_FEATURES = [
  { id: "details", label: "Details", icon: Info },
  { id: "subtitles", label: "Subtitles", icon: FileText },
  { id: "viral-hook", label: "Viral Hook", icon: Sparkles },
  { id: "project", label: "Project", icon: FolderOpen },
  {
    id: "versions",
    label: "Versions",
    title: "Version History",
    icon: History,
  },
];
