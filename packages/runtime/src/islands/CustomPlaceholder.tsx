import { Cube } from "@phosphor-icons/react";
import { EmptyState } from "../components/EmptyState.js";
import type { IslandRenderProps } from "../types.js";

export function CustomPlaceholder({ config }: IslandRenderProps) {
  return (
    <EmptyState
      icon={<Cube size={24} weight="duotone" />}
      title="Custom island"
      detail={
        <code className="rounded bg-kumo-recessed px-1.5 py-0.5 text-xs text-kumo-subtle">
          {config.type as string}
        </code>
      }
      description="Register a renderer in components/custom/ to draw this."
    />
  );
}
