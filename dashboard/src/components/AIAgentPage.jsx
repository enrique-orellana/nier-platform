import {
  Bot,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Smartphone,
  Upload,
  Users,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
} from "./ui";

const installCommand = "git clone https://github.com/mutonby/skill-autoshorts";

const workflowSteps = [
  {
    title: "1. Drop your videos",
    description:
      "Put your long-form vertical footage in the watched folder. The skill picks one video per run.",
    Icon: Upload,
  },
  {
    title: "2. AI clippers work",
    description:
      "Whisper transcribes, Gemini 3 Flash spots viral beats, FFmpeg cuts each clip and adds a hook overlay.",
    Icon: Users,
  },
  {
    title: "3. You validate, it ships",
    description:
      "Approve the candidates you like and the skill auto-publishes them to TikTok, Reels and YouTube Shorts via Upload-Post.",
    Icon: CheckCircle2,
  },
];

const workflowHighlights = [
  "Daily batch — picks one long video per run",
  "Whisper transcription with word-level timing",
  "Gemini 3 Flash multimodal moment detection",
  "Auto-publish to TikTok, Reels & YouTube Shorts",
];

export default function AIAgentPage() {
  return (
    <div className="h-full overflow-y-auto custom-scrollbar animate-[fadeIn_0.3s_ease-out]">
      <main className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-7 px-5 py-8 md:px-8 md:py-10">
        <header className="space-y-3">
          <Badge
            variant="outline"
            className="gap-1.5 rounded-md border-primary/25 bg-primary/10 px-2 py-1 font-medium text-primary"
          >
            <Bot className="size-3.5" /> Autonomous skill
          </Badge>
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
              Your Personal Clipping Team
            </h1>
            <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground md:text-base">
              Drop your videos in a folder and a team of AI clippers picks the
              viral moments, edits them, and queues them for your approval —
              like having a 24/7 short-form editing crew on autopilot.
            </p>
          </div>
        </header>

        <Card className="border-amber-500/30 bg-amber-500/5 shadow-none">
          <CardContent className="flex items-start gap-3 p-4">
            <Smartphone className="mt-0.5 size-5 shrink-0 text-amber-400" />
            <div className="space-y-1 text-sm">
              <p className="font-medium text-amber-300">
                Upload videos already in vertical (9:16) mobile format.
              </p>
              <p className="leading-relaxed text-amber-100/80">
                The agent does not reframe horizontal footage. Make sure every
                source video is shot or pre-cropped to mobile/portrait format
                before dropping it into the input folder.
              </p>
            </div>
          </CardContent>
        </Card>

        <section
          aria-label="How the clipping workflow works"
          className="grid gap-4 md:grid-cols-3"
        >
          {workflowSteps.map(({ title, description, Icon }) => (
            <Card key={title} className="h-full">
              <CardHeader className="gap-4 space-y-0 pb-3">
                <div className="flex size-10 items-center justify-center rounded-md border bg-muted text-primary">
                  <Icon className="size-4" />
                </div>
                <CardTitle className="text-base">{title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="leading-relaxed">
                  {description}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </section>

        <Card>
          <CardHeader className="gap-4 space-y-0 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <CardTitle>skill-autoshorts</CardTitle>
              <CardDescription className="max-w-2xl leading-relaxed">
                The Claude Code skill that powers this workflow. Install it once
                and trigger it whenever you want a fresh batch of clips.
              </CardDescription>
            </div>
            <Button variant="outline" asChild>
              <a
                href="https://github.com/mutonby/skill-autoshorts"
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0"
              >
                View on GitHub <ExternalLink className="size-4" />
              </a>
            </Button>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/50 p-2 pl-3">
              <code className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                {installCommand}
              </code>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Copy install command"
                title="Copy install command"
                onClick={() => navigator.clipboard.writeText(installCommand)}
              >
                <Copy className="size-4" />
              </Button>
            </div>

            <Separator />

            <ul className="grid gap-3 text-sm sm:grid-cols-2">
              {workflowHighlights.map((highlight) => (
                <li
                  key={highlight}
                  className="flex items-start gap-2 text-muted-foreground"
                >
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>{highlight}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
