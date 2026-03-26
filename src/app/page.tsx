"use client";

import { ExternalLink, Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type GenerationStatus = "DRAFT" | "GENERATING" | "READY" | "ERROR";

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [status, setStatus] = useState<GenerationStatus>("DRAFT");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progressStep, setProgressStep] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);
  const previewWrapRef = useRef<HTMLDivElement>(null);

  const canSubmit = useMemo(
    () => prompt.trim().length >= 3 && !isSubmitting,
    [prompt, isSubmitting],
  );

  useEffect(() => {
    if (!versionId) return;
    if (status === "READY" || status === "ERROR") return;

    let cancelled = false;
    const interval = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/versions/${versionId}`, {
          method: "GET",
          headers: { accept: "application/json" },
        });
        if (!res.ok) return;

        const json = await res.json();
        if (cancelled) return;

        const nextStatus = json.projectStatus as GenerationStatus;
        if (json.step) setProgressStep(json.step as string);
        if (typeof json.percent === "number") setProgressPercent(json.percent as number);
        setStatus(nextStatus);
        if (nextStatus === "READY" || nextStatus === "ERROR") {
          window.clearInterval(interval);
        }
      } catch {
        // best-effort polling
      }
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [versionId, status]);

  useEffect(() => {
    function onFullscreenChange() {
      setIsPreviewFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  async function onSubmit() {
    setIsSubmitting(true);
    setError(null);
    setProgressStep(null);
    setProgressPercent(0);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Generation failed.");
        setStatus("ERROR");
        return;
      }

      setProjectId(json.projectId);
      setVersionId(json.versionId);
      setStatus(json.status as GenerationStatus);
    } catch {
      setError("Network error starting generation.");
      setStatus("ERROR");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function togglePreviewFullscreen() {
    const el = previewWrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    try {
      await el.requestFullscreen();
    } catch {
      // User denied or API unsupported — ignore
    }
  }

  function openPreviewInNewTab() {
    if (!versionId) return;
    window.open(
      `/preview/${versionId}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 text-zinc-900">
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-10 md:px-6">
        <header className="flex flex-col gap-2">
          <div className="text-sm font-medium text-zinc-500">
            WebsitePls (MVP demo)
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Prompt → generated website preview
          </h1>
          <p className="max-w-2xl text-zinc-600">
            Type what you want, then wait for the HTML to be generated.
          </p>
        </header>

        <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <label className="block text-sm font-medium text-zinc-700">
              Prompt
            </label>
            <textarea
              className="mt-2 min-h-44 w-full resize-y rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-mono text-sm leading-relaxed outline-none focus:border-zinc-400"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder='Example: "Create a portfolio website for a photographer with a gallery, pricing, and a contact form."'
            />

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50"
                onClick={onSubmit}
                disabled={!canSubmit}
              >
                {isSubmitting ? "Generating..." : "Generate"}
              </button>

              <div className="text-sm text-zinc-600">
                {status === "DRAFT" && "Ready."}
                {status === "GENERATING" && (progressStep ?? "Starting…")}
                {status === "READY" && "Done — preview below."}
                {status === "ERROR" && "Something went wrong."}
              </div>
            </div>

            {status === "GENERATING" && (
              <div className="mt-4">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className="h-full rounded-full bg-zinc-900 transition-all duration-700 ease-out"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}

            {error ? (
              <div className="mt-4 text-sm text-red-700">{error}</div>
            ) : null}

            {projectId ? (
              <div className="mt-3 text-xs text-zinc-500">
                projectId: <span className="font-mono">{projectId}</span>
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-zinc-700">Preview</div>
                <div className="text-xs text-zinc-500">
                  {status === "READY" && versionId
                    ? `versionId: ${versionId}`
                    : "Waiting for generation…"}
                </div>
              </div>
              {status === "READY" && versionId ? (
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    title={
                      isPreviewFullscreen
                        ? "Exit full screen"
                        : "Full screen"
                    }
                    aria-label={
                      isPreviewFullscreen
                        ? "Exit full screen"
                        : "Full screen"
                    }
                    className="inline-flex rounded-lg border border-zinc-200 bg-white p-2 text-zinc-800 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50"
                    onClick={() => void togglePreviewFullscreen()}
                  >
                    {isPreviewFullscreen ? (
                      <Minimize2 className="h-5 w-5 shrink-0" aria-hidden />
                    ) : (
                      <Maximize2 className="h-5 w-5 shrink-0" aria-hidden />
                    )}
                  </button>
                  <button
                    type="button"
                    title="Open in new tab"
                    aria-label="Open in new tab"
                    className="inline-flex rounded-lg border border-zinc-200 bg-white p-2 text-zinc-800 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50"
                    onClick={openPreviewInNewTab}
                  >
                    <ExternalLink className="h-5 w-5 shrink-0" aria-hidden />
                  </button>
                </div>
              ) : null}
            </div>

            <div className="mt-4">
              {status === "READY" && versionId ? (
                <div
                  ref={previewWrapRef}
                  className={
                    isPreviewFullscreen
                      ? "flex min-h-0 w-full flex-col overflow-hidden bg-white [:fullscreen]:min-h-dvh [:fullscreen]:w-dvw"
                      : "h-[640px] overflow-hidden rounded-lg border border-zinc-200 bg-white"
                  }
                >
                  <iframe
                    title="Generated site preview"
                    src={`/preview/${versionId}`}
                    className={
                      isPreviewFullscreen
                        ? "min-h-0 w-full flex-1 border-0 bg-white"
                        : "h-full min-h-[640px] w-full border-0 bg-white"
                    }
                    sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
                  />
                </div>
              ) : (
                <div className="flex h-[640px] w-full flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center text-sm text-zinc-600">
                  {status === "GENERATING" ? (
                    <>
                      <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900" />
                      <p>{progressStep ?? "Starting…"}</p>
                    </>
                  ) : (
                    <p>Enter a prompt and click Generate.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
