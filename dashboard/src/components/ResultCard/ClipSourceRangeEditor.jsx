import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Separator,
} from "../ui";

const MINIMUM_RANGE_SECONDS = 1;

function numericValue(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatTime(value) {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function parseTime(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parts = text.split(":");
  if (parts.length > 3) return null;
  const numbers = parts.map((part) => Number(part));
  if (
    numbers.some((part) => !Number.isFinite(part) || part < 0) ||
    numbers.slice(1).some((part) => part >= 60)
  ) {
    return null;
  }
  if (parts.length === 3) {
    return numbers[0] * 3600 + numbers[1] * 60 + numbers[2];
  }
  if (parts.length === 2) return numbers[0] * 60 + numbers[1];
  return numbers[0];
}

export default function ClipSourceRangeEditor({
  isOpen,
  clip,
  masterDuration,
  onSave,
  onClose,
}) {
  const initialStart = numericValue(clip?.start, 0);
  const initialEnd = numericValue(
    clip?.end,
    initialStart + MINIMUM_RANGE_SECONDS,
  );
  const maximum = Math.max(
    numericValue(masterDuration, 0),
    initialEnd,
    initialStart + MINIMUM_RANGE_SECONDS,
  );
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(
    Math.min(
      maximum,
      Math.max(initialEnd, initialStart + MINIMUM_RANGE_SECONDS),
    ),
  );
  const [startInput, setStartInput] = useState(formatTime(initialStart));
  const [endInput, setEndInput] = useState(formatTime(initialEnd));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setStart(initialStart);
    setEnd(
      Math.min(
        maximum,
        Math.max(initialEnd, initialStart + MINIMUM_RANGE_SECONDS),
      ),
    );
    setStartInput(formatTime(initialStart));
    setEndInput(
      formatTime(
        Math.min(
          maximum,
          Math.max(initialEnd, initialStart + MINIMUM_RANGE_SECONDS),
        ),
      ),
    );
    setError("");
  }, [isOpen, initialStart, initialEnd, maximum]);

  const duration = useMemo(
    () => Math.max(MINIMUM_RANGE_SECONDS, end - start),
    [end, start],
  );

  if (!isOpen) return null;

  const handleStartChange = (value) => {
    const next = Math.max(
      0,
      Math.min(Number(value), end - MINIMUM_RANGE_SECONDS),
    );
    setStart(next);
    setStartInput(formatTime(next));
    setError("");
  };

  const handleEndChange = (value) => {
    const next = Math.min(
      maximum,
      Math.max(Number(value), start + MINIMUM_RANGE_SECONDS),
    );
    setEnd(next);
    setEndInput(formatTime(next));
    setError("");
  };

  const handleTimeInput = (kind, value) => {
    if (kind === "start") setStartInput(value);
    else setEndInput(value);

    const parsed = parseTime(value);
    if (parsed === null) return;
    if (kind === "start") {
      setStart(Math.max(0, Math.min(parsed, end - MINIMUM_RANGE_SECONDS)));
    } else {
      setEnd(
        Math.min(maximum, Math.max(parsed, start + MINIMUM_RANGE_SECONDS)),
      );
    }
    setError("");
  };

  const handleTimeBlur = (kind) => {
    const input = kind === "start" ? startInput : endInput;
    const parsed = parseTime(input);
    if (parsed === null) {
      setError("Enter a valid time as MM:SS.");
      return;
    }
    if (kind === "start") {
      const next = Math.max(0, Math.min(parsed, end - MINIMUM_RANGE_SECONDS));
      setStart(next);
      setStartInput(formatTime(next));
    } else {
      const next = Math.min(
        maximum,
        Math.max(parsed, start + MINIMUM_RANGE_SECONDS),
      );
      setEnd(next);
      setEndInput(formatTime(next));
    }
    setError("");
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError("");
    try {
      const parsedStart = parseTime(startInput);
      const parsedEnd = parseTime(endInput);
      if (parsedStart === null || parsedEnd === null) {
        throw new Error("Enter a valid time as MM:SS.");
      }
      const boundedEnd = Math.min(
        maximum,
        Math.max(MINIMUM_RANGE_SECONDS, parsedEnd),
      );
      const nextStart = Math.max(
        0,
        Math.min(parsedStart, boundedEnd - MINIMUM_RANGE_SECONDS),
      );
      const nextEnd = Math.max(nextStart + MINIMUM_RANGE_SECONDS, boundedEnd);
      setStart(nextStart);
      setEnd(nextEnd);
      setStartInput(formatTime(nextStart));
      setEndInput(formatTime(nextEnd));
      const saved = await onSave({ start: nextStart, end: nextEnd });
      if (saved === false) throw new Error("Could not save clip range.");
      onClose();
    } catch (saveError) {
      setError(saveError.message || "Could not save clip range.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showClose={false}
        closeOnEscape={false}
        closeOnInteractOutside={false}
        className="w-[calc(100%-2rem)] max-w-xl"
      >
        <DialogHeader className="text-left">
          <div>
            <DialogTitle className="text-lg">Adjust clip range</DialogTitle>
            <DialogDescription>
              Extend or compact the clip before rendering.
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="space-y-5 py-4">
          <label className="block text-sm">
            <span className="flex items-center justify-between gap-3">
              <span>Start</span>
              <Input
                type="text"
                value={startInput}
                onChange={(event) =>
                  handleTimeInput("start", event.target.value)
                }
                onBlur={() => handleTimeBlur("start")}
                aria-label="Start time"
                placeholder="MM:SS"
                inputMode="numeric"
                className="w-24 text-right font-mono"
              />
            </span>
            <Input
              type="range"
              min="0"
              max={maximum}
              step="0.1"
              value={start}
              onChange={(event) =>
                handleStartChange(Number(event.target.value))
              }
              data-testid="clip-range-start"
              className="mt-3 h-2 w-full cursor-pointer accent-primary"
            />
          </label>

          <label className="block text-sm">
            <span className="flex items-center justify-between gap-3">
              <span>End</span>
              <Input
                type="text"
                value={endInput}
                onChange={(event) => handleTimeInput("end", event.target.value)}
                onBlur={() => handleTimeBlur("end")}
                aria-label="End time"
                placeholder="MM:SS"
                inputMode="numeric"
                className="w-24 text-right font-mono"
              />
            </span>
            <Input
              type="range"
              min="0"
              max={maximum}
              step="0.1"
              value={end}
              onChange={(event) => handleEndChange(Number(event.target.value))}
              data-testid="clip-range-end"
              className="mt-3 h-2 w-full cursor-pointer accent-primary"
            />
          </label>
        </div>

        <div className="rounded-md border bg-muted/50 px-3 py-2 text-sm font-mono text-muted-foreground">
          Start {formatTime(start)} · End {formatTime(end)} · Duration{" "}
          {formatTime(duration)} · Master {formatTime(maximum)}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <Separator className="my-4" />
        <DialogFooter>
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="default"
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            aria-label="Save clip range"
          >
            {isSaving ? "Saving…" : "Save clip range"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
