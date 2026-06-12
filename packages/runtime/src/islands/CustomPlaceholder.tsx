import { Cube } from "@phosphor-icons/react";
import { IslandEmpty } from "../components/EmptyState.js";
import type { IslandRenderProps } from "../types.js";

export function CustomPlaceholder({ config }: IslandRenderProps) {
  return (
    <IslandEmpty
      icon={<Cube size={28} weight="duotone" className="text-kumo-subtle" />}
      title="Custom island"
      description="Register a renderer in components/custom/ to draw this."
      contents={
        <code className="rounded bg-kumo-recessed px-1.5 py-0.5 text-xs text-kumo-subtle">
          {config.type as string}
        </code>
      }
    />
  );
}
