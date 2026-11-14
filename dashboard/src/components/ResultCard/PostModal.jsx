import React from "react";
import {
  X,
  AlertCircle,
  Calendar,
  Clock,
  Video,
  Instagram,
  Youtube,
  CheckCircle,
  Loader2,
  Share2,
} from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Switch,
  Textarea,
} from "../ui";

export default function PostModal({
  showModal,
  setShowModal,
  postTitle,
  setPostTitle,
  postDescription,
  setPostDescription,
  isScheduling,
  setIsScheduling,
  scheduleDate,
  setScheduleDate,
  platforms,
  setPlatforms,
  postResult,
  posting,
  uploadPostKey,
  handlePost,
}) {
  return (
    <Dialog
      open={showModal}
      onOpenChange={(open) => !open && setShowModal(false)}
    >
      <DialogContent
        showClose={false}
        closeOnEscape={false}
        closeOnInteractOutside={false}
        overlayClassName="z-[100]"
        className="z-[100] max-h-[90vh] w-[calc(100%-2rem)] max-w-md overflow-y-auto"
      >
        <Button
          variant="ghost"
          size="icon"
          type="button"
          onClick={() => setShowModal(false)}
          aria-label="Close post dialog"
          className="absolute right-4 top-4"
        >
          <X className="size-4" />
        </Button>

        <DialogHeader className="text-left">
          <DialogTitle>Post / Schedule</DialogTitle>
          <DialogDescription>
            Prepare a clip for publishing or schedule it for later.
          </DialogDescription>
        </DialogHeader>

        {!uploadPostKey && (
          <div
            role="status"
            className="my-4 flex items-start gap-2 rounded-md border border-muted p-3 text-sm text-muted-foreground"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <p>Configure API Key in Settings first.</p>
          </div>
        )}

        <div className="space-y-4 py-4">
          {/* Title & Description */}
          <div>
            <Label htmlFor="post-title" className="mb-2 block">
              Video Title
            </Label>
            <Input
              id="post-title"
              type="text"
              value={postTitle}
              onChange={(e) => setPostTitle(e.target.value)}
              className="w-full"
              placeholder="Enter a catchy title..."
            />
          </div>

          <div>
            <Label htmlFor="post-caption" className="mb-2 block">
              Caption / Description
            </Label>
            <Textarea
              id="post-caption"
              value={postDescription}
              onChange={(e) => setPostDescription(e.target.value)}
              rows={4}
              className="w-full resize-none"
              placeholder="Write a caption for your post..."
            />
          </div>

          {/* Scheduling */}
          <Card className="shadow-none">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-4">
                <Label
                  htmlFor="schedule-post"
                  className="flex items-center gap-2"
                >
                  <Calendar className="size-4 text-muted-foreground" />
                  Schedule Post
                </Label>
                <Switch
                  id="schedule-post"
                  checked={isScheduling}
                  onCheckedChange={setIsScheduling}
                />
              </div>

              {isScheduling && (
                <div className="space-y-2">
                  <Label htmlFor="schedule-date">Select Date & Time</Label>
                  <div className="relative">
                    <Input
                      id="schedule-date"
                      type="datetime-local"
                      value={scheduleDate}
                      onChange={(e) => setScheduleDate(e.target.value)}
                      className="w-full [color-scheme:dark]"
                    />
                    <Clock className="pointer-events-none absolute right-3 top-2.5 size-4 text-muted-foreground" />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Platforms */}
          <div>
            <Label className="mb-2 block">Select Platforms</Label>
            <div className="grid grid-cols-1 gap-2">
              <label className="flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors hover:bg-accent">
                <Checkbox
                  checked={platforms.tiktok}
                  onCheckedChange={(checked) =>
                    setPlatforms({ ...platforms, tiktok: checked === true })
                  }
                />
                <div className="flex items-center gap-2 text-sm">
                  <Video className="size-4" /> TikTok
                </div>
              </label>
              <label className="flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors hover:bg-accent">
                <Checkbox
                  checked={platforms.instagram}
                  onCheckedChange={(checked) =>
                    setPlatforms({ ...platforms, instagram: checked === true })
                  }
                />
                <div className="flex items-center gap-2 text-sm">
                  <Instagram className="size-4" /> Instagram
                </div>
              </label>
              <label className="flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors hover:bg-accent">
                <Checkbox
                  checked={platforms.youtube}
                  onCheckedChange={(checked) =>
                    setPlatforms({ ...platforms, youtube: checked === true })
                  }
                />
                <div className="flex items-center gap-2 text-sm">
                  <Youtube className="size-4" /> YouTube Shorts
                </div>
              </label>
            </div>
          </div>
        </div>

        {postResult && (
          <div
            role={postResult.success ? "status" : "alert"}
            className={`mb-4 flex items-start gap-2 rounded-md border p-3 text-sm ${postResult.success ? "text-primary" : "border-destructive/30 bg-destructive/5 text-destructive"}`}
          >
            {postResult.success ? (
              <CheckCircle size={14} className="mt-0.5 shrink-0" />
            ) : (
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
            )}
            <div>{postResult.msg}</div>
          </div>
        )}

        <Button
          variant="default"
          onClick={handlePost}
          disabled={posting || !uploadPostKey}
          className="w-full"
        >
          {posting ? (
            <>
              <Loader2 size={16} className="animate-spin" />{" "}
              {isScheduling ? "Scheduling..." : "Publishing..."}
            </>
          ) : (
            <>
              <Share2 size={16} />{" "}
              {isScheduling ? "Schedule Post" : "Publish Now"}
            </>
          )}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
