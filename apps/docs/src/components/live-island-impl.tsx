"use client";

import { type CSSProperties, Suspense } from "react";
import { IslandCard, resolveRenderer, type Column, type SourceInfo } from "@openislands/runtime/islands";
import { DEFAULT_HEIGHT, type LiveIslandData, type LiveIslandProps } from "./live-island";

type ColumnType = Column["type"];

/**
 * Bucket a DuckDB-style type name (what docs authors write — `bigint`, `double`,
 * `varchar`, `timestamp`) into the runtime's coarse {@link ColumnType}, matching how
 * the compiler classifies real query columns. Unrecognized names read as text,
 * mirroring the compiler's own fallback.
 */
function columnTypeFrom(name: string): ColumnType {
  const type = name.toLowerCase();
  if (type === "boolean" || type === "bool") return "boolean";
  if (type.startsWith("date") || type.startsWith("time")) return "date";
  if (/(int|float|double|decimal|numeric|real)/.test(type)) return "number";
  return "string";
}

function sourceFrom(data: LiveIslandData | undefined): SourceInfo | null {
  if (!data) return null;
  const columns: Column[] = data.columns.map(({ name, type }) => ({
    name,
    type: columnTypeFrom(type),
  }));
  return { name: data.dataset, kind: "file", columns };
}

/**
 * Renders a real OpenIslands island by resolving the same renderer the runtime uses.
 * Framed (the default), it wraps that renderer in the runtime's own {@link IslandCard}
 * — header, title, and a source button that lists the sample dataset's columns — so an
 * island in the docs is the very tile a user sees in their app.
 */
export default function LiveIslandImpl({
  type,
  config,
  data,
  height = DEFAULT_HEIGHT,
  framed = true,
}: LiveIslandProps) {
  const Renderer = resolveRenderer(type);
  const style = { minHeight: `${height}px` } as CSSProperties;
  const island = (
    <Suspense fallback={<div style={style} />}>
      <Renderer config={{ ...config, type }} data={data as never} />
    </Suspense>
  );

  if (!framed) {
    return (
      <div className="oi-island-bare not-prose" style={style}>
        {island}
      </div>
    );
  }

  // IslandCard is `h-full` so it fills a dashboard grid cell. In the docs there is no
  // such cell, so without an explicit `height: auto` it stretches to the full content
  // column. Auto lets the tile size to its content (header + the island's own height),
  // exactly as a tile reads in a real dashboard.
  return (
    <IslandCard
      className="not-prose my-4"
      style={{ ...style, height: "auto" }}
      title={config.title as string | undefined}
      source={sourceFrom(data)}
    >
      {island}
    </IslandCard>
  );
}
