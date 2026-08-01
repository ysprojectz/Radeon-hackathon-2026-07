"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import mermaid from "mermaid";
import { ZoomIn, ZoomOut, RotateCcw, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Unique render ID counter — prevents mermaid internal ID collisions on hot reload
let _renderCounter = 0;

interface MermaidDiagramProps {
  chart: string;
  className?: string;
}

const BLOCKED_SVG_TAGS = ["script", "foreignObject", "iframe", "object", "embed", "link", "meta"];
const URL_ATTRS = new Set(["href", "xlink:href"]);

function sanitizeRenderedSvg(svgMarkup: string): string | null {
  if (typeof window === "undefined") return null;

  const parser = new DOMParser();
  const doc = parser.parseFromString(svgMarkup, "image/svg+xml");
  const root = doc.documentElement;

  if (!root || root.nodeName.toLowerCase() !== "svg") {
    return null;
  }

  for (const tagName of BLOCKED_SVG_TAGS) {
    doc.querySelectorAll(tagName).forEach((node) => node.remove());
  }

  doc.querySelectorAll("*").forEach((element) => {
    Array.from(element.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();

      if (name.startsWith("on")) {
        element.removeAttribute(attr.name);
        return;
      }

      if (URL_ATTRS.has(name) && /^javascript:/i.test(value)) {
        element.removeAttribute(attr.name);
      }
    });
  });

  return new XMLSerializer().serializeToString(root);
}

export function MermaidDiagram({ chart, className }: MermaidDiagramProps) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(0.75);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    let cancelled = false;

    async function render() {
      const id = `mermaid-diagram-${++_renderCounter}`;
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: resolvedTheme === "dark" ? "dark" : "default",
          securityLevel: "strict",
          flowchart: {
            htmlLabels: false,
            curve: "basis",
          },
        });

        const { svg: renderedSvg } = await mermaid.render(id, chart);
        const safeSvg = sanitizeRenderedSvg(renderedSvg);
        if (!cancelled) {
          if (!safeSvg) {
            setError("Diagram render blocked by SVG sanitizer");
            setSvg(null);
            return;
          }
          setSvg(safeSvg);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Diagram render error");
          setSvg(null);
        }
      }
    }

    render();
    return () => { cancelled = true; };
  }, [chart, resolvedTheme, mounted]);

  function handleDownload() {
    if (!svg) return;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = "claims-process-flow.svg";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!mounted) return null;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setZoomLevel((z) => Math.min(z + 0.15, 2.0))}
          className="h-8 gap-1.5 text-xs"
        >
          <ZoomIn className="h-3.5 w-3.5" />
          Zoom In
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setZoomLevel((z) => Math.max(z - 0.15, 0.3))}
          className="h-8 gap-1.5 text-xs"
        >
          <ZoomOut className="h-3.5 w-3.5" />
          Zoom Out
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setZoomLevel(0.75)}
          className="h-8 gap-1.5 text-xs"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDownload}
          disabled={!svg}
          className="h-8 gap-1.5 text-xs"
        >
          <Download className="h-3.5 w-3.5" />
          Download SVG
        </Button>
        <span className="ml-auto text-xs text-muted-foreground/60">
          {Math.round(zoomLevel * 100)}% zoom
        </span>
      </div>

      {/* Diagram viewport */}
      <div className="overflow-auto rounded-lg border border-border/40 bg-background/40 p-4 min-h-[400px]">
        {error ? (
          <div className="flex items-center justify-center h-40 text-sm text-destructive/70">
            Diagram render error: {error}
          </div>
        ) : !svg ? (
          <div className="flex items-center justify-center h-40 text-sm text-muted-foreground/50 animate-pulse">
            Rendering diagram…
          </div>
        ) : (
          <div
            style={{
              transform: `scale(${zoomLevel})`,
              transformOrigin: "top center",
              width: `${Math.round(100 / zoomLevel)}%`,
            }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}
      </div>
    </div>
  );
}
