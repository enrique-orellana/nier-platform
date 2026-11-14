import React from "react";
import { ExternalLink, Eye, EyeOff } from "lucide-react";

import { buildVisibleProviders } from "../lib/lmStudio";
import { codexStatusLabel } from "../lib/openaiCodex";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  NativeSelect,
  Separator,
} from "./ui";

export default function AISettingsPanel({
  aiProvider,
  setAiProvider,
  apiKey,
  setApiKey,
  aiBaseUrl,
  setAiBaseUrl,
  aiQualityPreset,
  setAiQualityPreset,
  aiTextModel,
  setAiTextModel,
  aiAnalyzeModel,
  setAiAnalyzeModel,
  aiVisionModel,
  setAiVisionModel,
  aiImageModel,
  setAiImageModel,
  aiTextEffort = "auto",
  setAiTextEffort = () => {},
  aiAnalyzeEffort = "auto",
  setAiAnalyzeEffort = () => {},
  aiVisionEffort = "auto",
  setAiVisionEffort = () => {},
  lmStudioAvailable,
  lmStudioModels,
  codexStatus = { connected: false, pending: false, requiresReconnect: false },
  codexPending = null,
  codexError = "",
  codexModels = { models: [], defaultModel: "" },
  codexModelsLoading = false,
  codexModelsError = "",
  onConnectCodex = () => {},
  onDisconnectCodex = () => {},
  onRefreshCodexModels = () => {},
}) {
  const providerOptions = buildVisibleProviders({ lmStudioAvailable });
  const [apiKeyVisible, setApiKeyVisible] = React.useState(false);
  const isCodex = aiProvider === "openai-codex";
  const isOpenRouter = aiProvider === "openrouter";
  const textOptions =
    aiProvider === "lmstudio" ? lmStudioModels.textModels : null;
  const visionOptions =
    aiProvider === "lmstudio" ? lmStudioModels.visionModels : null;
  const codexTextOptions = codexModels.models || [];
  const codexVisionOptions = codexTextOptions.some(
    (model) => model.supportsVision,
  )
    ? codexTextOptions.filter((model) => model.supportsVision)
    : codexTextOptions;
  const apiKeyField = (
    <div className="min-w-0 space-y-2">
      <Label
        htmlFor="ai-provider-api-key"
        className="block text-sm font-medium text-foreground"
      >
        {isCodex || isOpenRouter
          ? "OpenRouter API key"
          : aiProvider === "gemini"
            ? "Gemini API key"
            : "API / Access key"}
      </Label>
      <div className="relative">
        <Input
          id="ai-provider-api-key"
          type={apiKeyVisible ? "text" : "password"}
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={
            isCodex || isOpenRouter
              ? "sk-or-v1-..."
              : aiProvider === "gemini"
                ? "AIza..."
                : "Optional"
          }
          autoComplete="off"
          className="pr-11"
        />
        <Button
          variant="ghost"
          size="icon"
          type="button"
          aria-label={apiKeyVisible ? "Hide API key" : "Show API key"}
          onClick={() => setApiKeyVisible((visible) => !visible)}
          className="absolute right-1 top-1/2 size-7 -translate-y-1/2 text-muted-foreground"
        >
          {apiKeyVisible ? <EyeOff /> : <Eye />}
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Saved in this browser and sent only when a request needs it.
      </p>
      {(aiProvider === "gemini" || isOpenRouter || isCodex) && (
        <Button asChild variant="link" size="sm" className="mt-1 h-auto p-0">
          <a
            href={
              aiProvider === "gemini"
                ? "https://aistudio.google.com/app/apikey"
                : "https://openrouter.ai/keys"
            }
            target="_blank"
            rel="noopener noreferrer"
          >
            Get an API key <ExternalLink className="size-3.5" />
          </a>
        </Button>
      )}
    </div>
  );
  const baseUrlField = (
    <Label className="block min-w-0">
      <span className="mb-2 block text-sm font-medium text-foreground">
        Base URL
      </span>
      <Input
        type="text"
        value={
          isOpenRouter ? aiBaseUrl || "https://openrouter.ai/api/v1" : aiBaseUrl
        }
        onChange={(e) => setAiBaseUrl(e.target.value)}
        readOnly={isOpenRouter}
        placeholder={
          isOpenRouter
            ? "https://openrouter.ai/api/v1"
            : "http://localhost:11434"
        }
      />
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {isOpenRouter
          ? "Configured automatically. Only the API key is required."
          : "Enter the reachable endpoint for your cluster or host."}
      </p>
      {aiProvider === "lmstudio" && !aiBaseUrl.trim() && (
        <p className="mt-2 text-xs text-amber-400">
          Base URL required for local models.
        </p>
      )}
    </Label>
  );
  const qualityPresetField = (
    <Label className="block min-w-0">
      <span className="mb-2 block text-sm font-medium text-foreground">
        Quality preset
      </span>
      <NativeSelect
        value={aiQualityPreset}
        onChange={(e) => setAiQualityPreset(e.target.value)}
      >
        <option value="lite">Lite</option>
        <option value="balanced">Balanced</option>
        <option value="best">Best</option>
        <option value="custom">Custom</option>
      </NativeSelect>
    </Label>
  );
  const codexModelDisabled = !codexStatus.connected || codexModelsLoading;

  const renderCodexModelSelect = (label, value, onChange, options) => (
    <Label className="block" key={label}>
      <span className="mb-2 block text-sm font-medium text-foreground">
        {label}
      </span>
      <NativeSelect
        aria-label={label}
        value={value}
        onChange={(e) => {
          setAiQualityPreset("custom");
          onChange(e.target.value);
        }}
        disabled={codexModelDisabled}
      >
        <option value="auto">Auto (Codex default)</option>
        {options.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label}
          </option>
        ))}
      </NativeSelect>
    </Label>
  );

  const renderCodexEffortSelect = (label, modelId, value, onChange) => {
    const selectedModelId =
      modelId === "auto" || modelId === "default"
        ? codexModels.defaultModel
        : modelId;
    const model = codexTextOptions.find(
      (entry) => entry.id === selectedModelId,
    );
    const efforts = model?.efforts || [];
    return (
      <Label className="block" key={label}>
        <span className="mb-2 block text-sm font-medium text-foreground">
          {label}
        </span>
        <NativeSelect
          aria-label={label}
          value={value}
          onChange={(e) => {
            setAiQualityPreset("custom");
            onChange(e.target.value);
          }}
          disabled={codexModelDisabled || efforts.length === 0}
        >
          <option value="auto">Auto (model default)</option>
          {efforts.map((effort) => (
            <option
              key={effort.id}
              value={effort.id}
              title={effort.description}
            >
              {effort.label}
            </option>
          ))}
        </NativeSelect>
      </Label>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle>AI provider and models</CardTitle>
            <CardDescription>
              Set the service and credentials, then choose a model for each AI
              task.
            </CardDescription>
          </div>
          <Badge variant="outline">Optional</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-4" aria-label="Provider configuration">
          <Label className="block max-w-2xl">
            <span className="mb-2 block text-sm font-medium text-foreground">
              Provider
            </span>
            <NativeSelect
              value={aiProvider}
              onChange={(e) => setAiProvider(e.target.value)}
            >
              {providerOptions.includes("gemini") && (
                <option value="gemini">Gemini (Cloud)</option>
              )}
              {providerOptions.includes("openrouter") && (
                <option value="openrouter">OpenRouter</option>
              )}
              {providerOptions.includes("lmstudio") && (
                <option value="lmstudio">LM Studio (Local)</option>
              )}
              {providerOptions.includes("openai-codex") && (
                <option value="openai-codex">OpenAI Codex (ChatGPT)</option>
              )}
            </NativeSelect>
          </Label>
          {isCodex && (
            <div className="rounded-lg border border-border bg-muted/20 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    ChatGPT connection
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {codexStatusLabel(codexStatus)}.
                    </span>{" "}
                    {codexStatus.connected
                      ? "Your ChatGPT account is linked for Codex requests."
                      : codexStatus.pending
                        ? "Finish the verification below to connect your account."
                        : codexStatus.requiresReconnect
                          ? "Reconnect your account to use its available models."
                          : "Connect your account to use its available models."}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  aria-label={
                    codexStatus.connected
                      ? "Disconnect ChatGPT account"
                      : codexStatus.pending
                        ? "Cancel connection"
                        : codexStatus.requiresReconnect
                          ? "Reconnect ChatGPT account"
                          : "Connect ChatGPT account"
                  }
                  className="shrink-0"
                  onClick={
                    codexStatus.connected || codexStatus.pending
                      ? onDisconnectCodex
                      : onConnectCodex
                  }
                >
                  {codexStatus.connected
                    ? "Disconnect"
                    : codexStatus.pending
                      ? "Cancel"
                      : codexStatus.requiresReconnect
                        ? "Reconnect"
                        : "Connect"}
                </Button>
              </div>
              {(codexPending?.userCode ||
                codexPending?.verificationUrl ||
                codexError) && (
                <div className="mt-3 space-y-2 border-t border-border pt-3">
                  {codexPending?.userCode && (
                    <p className="text-xs text-muted-foreground">
                      Enter this code at the verification page:{" "}
                      <code className="text-foreground">
                        {codexPending.userCode}
                      </code>
                    </p>
                  )}
                  {codexPending?.verificationUrl && (
                    <a
                      href={codexPending.verificationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-xs text-primary hover:underline"
                    >
                      Open ChatGPT verification page
                    </a>
                  )}
                  {codexError && (
                    <p className="text-xs text-destructive">{codexError}</p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            {apiKeyField}
            {isCodex ? qualityPresetField : baseUrlField}
            {!isCodex && qualityPresetField}
          </div>
        </section>

        <Separator />

        <section className="space-y-4">
          <div className="space-y-1.5">
            <h3 className="text-base font-semibold text-foreground">Models</h3>
            <p className="text-sm text-muted-foreground">
              Pick the model used for each AI task. Presets can update these
              choices together.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {isCodex ? (
              <>
                <div className="md:col-span-2 flex items-center justify-between gap-3 -mb-2">
                  <p className="text-xs text-muted-foreground">
                    {codexModelsLoading
                      ? "Loading models available to this ChatGPT account..."
                      : codexModelsError
                        ? codexModelsError
                        : codexTextOptions.length
                          ? `${codexTextOptions.length} account model${codexTextOptions.length === 1 ? "" : "s"} available`
                          : codexStatus.connected
                            ? "No account models discovered yet."
                            : "Connect ChatGPT to load account models."}
                  </p>
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={onRefreshCodexModels}
                    disabled={!codexStatus.connected || codexModelsLoading}
                    className="text-xs text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
                  >
                    {codexModelsLoading ? "Refreshing..." : "Refresh models"}
                  </Button>
                </div>
                {renderCodexModelSelect(
                  "Text Model",
                  aiTextModel,
                  setAiTextModel,
                  codexTextOptions,
                )}
                {renderCodexEffortSelect(
                  "Text Effort",
                  aiTextModel,
                  aiTextEffort,
                  setAiTextEffort,
                )}
                {renderCodexModelSelect(
                  "Clip Analysis Model",
                  aiAnalyzeModel,
                  setAiAnalyzeModel,
                  codexTextOptions,
                )}
                {renderCodexEffortSelect(
                  "Clip Analysis Effort",
                  aiAnalyzeModel,
                  aiAnalyzeEffort,
                  setAiAnalyzeEffort,
                )}
                {renderCodexModelSelect(
                  "Vision Model",
                  aiVisionModel,
                  setAiVisionModel,
                  codexVisionOptions,
                )}
                {renderCodexEffortSelect(
                  "Vision Effort",
                  aiVisionModel,
                  aiVisionEffort,
                  setAiVisionEffort,
                )}
              </>
            ) : isOpenRouter ? (
              <>
                {[
                  ["Text Model", aiTextModel],
                  ["Clip Analysis Model", aiAnalyzeModel],
                  ["Vision Model", aiVisionModel],
                ].map(([label, value]) => (
                  <Label className="block" key={label}>
                    <span className="mb-2 block text-sm font-medium text-foreground">
                      {label}
                    </span>
                    <Input
                      aria-label={label}
                      value={value || "openai/gpt-4o-mini"}
                      readOnly
                    />
                  </Label>
                ))}
              </>
            ) : !textOptions ? (
              <>
                <Label className="block">
                  <span className="mb-2 block text-sm font-medium text-foreground">
                    Text Model
                  </span>
                  <NativeSelect
                    value={aiTextModel}
                    onChange={(e) => {
                      setAiQualityPreset("custom");
                      setAiTextModel(e.target.value);
                    }}
                  >
                    <option value="auto">Auto (recommended)</option>
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                  </NativeSelect>
                </Label>
                <Label className="block">
                  <span className="mb-2 block text-sm font-medium text-foreground">
                    Clip Analysis Model
                  </span>
                  <NativeSelect
                    value={aiAnalyzeModel}
                    onChange={(e) => {
                      setAiQualityPreset("custom");
                      setAiAnalyzeModel(e.target.value);
                    }}
                  >
                    <option value="auto">Auto (recommended)</option>
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                  </NativeSelect>
                </Label>
                <Label className="block">
                  <span className="mb-2 block text-sm font-medium text-foreground">
                    Vision Model
                  </span>
                  <NativeSelect
                    aria-label="Vision Model"
                    value={aiVisionModel}
                    onChange={(e) => {
                      setAiQualityPreset("custom");
                      setAiVisionModel(e.target.value);
                    }}
                  >
                    <option value="auto">Auto (recommended)</option>
                    <option value="gemini-3.1-flash-image-preview">
                      Gemini 3.1 Flash Image Preview
                    </option>
                  </NativeSelect>
                </Label>
                <Label className="block">
                  <span className="mb-2 block text-sm font-medium text-foreground">
                    Image Generation Model
                  </span>
                  <NativeSelect
                    value={aiImageModel}
                    onChange={(e) => {
                      setAiQualityPreset("custom");
                      setAiImageModel(e.target.value);
                    }}
                  >
                    <option value="">None (skip image generation)</option>
                    <option value="gemini-2.5-flash-image">
                      Gemini 2.5 Flash Image
                    </option>
                  </NativeSelect>
                </Label>
              </>
            ) : (
              <>
                <Label className="block">
                  <span className="mb-2 block text-sm font-medium text-foreground">
                    Text Model
                  </span>
                  <NativeSelect
                    value={aiTextModel}
                    onChange={(e) => {
                      setAiQualityPreset("custom");
                      setAiTextModel(e.target.value);
                    }}
                  >
                    {textOptions.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </NativeSelect>
                </Label>
                <Label className="block">
                  <span className="mb-2 block text-sm font-medium text-foreground">
                    Clip Analysis Model
                  </span>
                  <NativeSelect
                    value={aiAnalyzeModel}
                    onChange={(e) => {
                      setAiQualityPreset("custom");
                      setAiAnalyzeModel(e.target.value);
                    }}
                  >
                    {textOptions.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </NativeSelect>
                </Label>
                <Label className="block">
                  <span className="mb-2 block text-sm font-medium text-foreground">
                    Vision Model
                  </span>
                  <NativeSelect
                    aria-label="Vision Model"
                    value={aiVisionModel}
                    onChange={(e) => {
                      setAiQualityPreset("custom");
                      setAiVisionModel(e.target.value);
                    }}
                    disabled={
                      aiProvider === "lmstudio" && visionOptions.length === 0
                    }
                  >
                    {visionOptions.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </NativeSelect>
                </Label>
                <Label className="block">
                  <span className="mb-2 block text-sm font-medium text-foreground">
                    Image Generation Model
                  </span>
                  <NativeSelect
                    value={aiImageModel}
                    onChange={(e) => {
                      setAiQualityPreset("custom");
                      setAiImageModel(e.target.value);
                    }}
                  >
                    <option value="">None (skip image generation)</option>
                  </NativeSelect>
                </Label>
              </>
            )}
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
