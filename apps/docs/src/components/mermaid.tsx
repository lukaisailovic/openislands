"use client";

import { useEffect, useId, useState } from "react";

// A dark, brand-tuned Mermaid theme: deep teal-black node fills, the OpenIslands tide
// teal for borders/accents, and soft slate edges — so diagrams read as part of the
// runtime's own dark surface rather than the default Mermaid look.
const themeVariables = {
  background: "transparent",
  primaryColor: "#0f1b1a",
  primaryBorderColor: "#2dd4bf",
  primaryTextColor: "#d7efe9",
  secondaryColor: "#15201f",
  secondaryBorderColor: "#2a3b39",
  secondaryTextColor: "#c7d6d3",
  tertiaryColor: "#0c1413",
  tertiaryBorderColor: "#22302e",
  lineColor: "#5b6b69",
  textColor: "#c7d6d3",
  nodeTextColor: "#d7efe9",
  mainBkg: "#0f1b1a",
  clusterBkg: "#0c1413",
  clusterBorder: "#22302e",
  edgeLabelBackground: "#0c1413",
  fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  fontSize: "14px",
};

export function Mermaid({ chart }: { chart: string }) {
  const rawId = useId();
  const id = `mmd-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const [svg, setSvg] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { default: mermaid } = await import("mermaid");
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "loose",
        theme: "base",
        darkMode: true,
        themeVariables,
        flowchart: { curve: "basis", htmlLabels: true, padding: 16 },
        sequence: { useMaxWidth: true },
      });

      try {
        // remarkMdxMermaid can pass newlines escaped as the literal `\n`.
        const rendered = await mermaid.render(id, chart.replaceAll("\\n", "\n").trim());
        if (!cancelled) setSvg(rendered.svg);
      } catch {
        // A malformed diagram leaves the block empty rather than crashing the page.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  return (
    <div
      className="oi-mermaid not-prose my-6 flex justify-center"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export default Mermaid;
