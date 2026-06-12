import { Component, type ReactNode, lazy, Suspense, useMemo } from "react";
import { SkeletonLine } from "@cloudflare/kumo";
import { IslandErrorCard } from "../components/IslandErrorCard.js";
import type { IslandRenderer } from "./registry.js";
import { CustomPlaceholder } from "./CustomPlaceholder.js";
import type { IslandRenderProps } from "../types.js";

/**
 * Client wrapper for a custom island. The component lives in the user's project
 * and is bundled on demand by the runtime server (`/__custom/<type>.js`), so it
 * is imported lazily on the client only — never during SSR, where the bundle
 * route isn't reachable yet. A type with no component on disk (the import 404s)
 * falls back to the placeholder; a component that throws on import or render
 * shows the fail-loudly error card instead of crashing the page.
 */
function loadCustom(appId: string, type: string, version: number): IslandRenderer {
  return lazy(async () => {
    const mod = (await import(
      /* @vite-ignore */ `/__custom/${encodeURIComponent(appId)}/${type}.js?v=${version}`
    )) as {
      default?: IslandRenderer;
    };
    if (!mod.default) throw new Error(`custom island '${type}' has no default export`);
    return { default: mod.default };
  });
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <SkeletonLine minWidth={40} maxWidth={60} />
      <SkeletonLine />
      <SkeletonLine minWidth={50} maxWidth={70} />
    </div>
  );
}

class CustomErrorBoundary extends Component<
  { config: IslandRenderProps["config"]; children: ReactNode },
  { error: Error | null }
> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override render() {
    if (this.state.error) {
      return (
        <IslandErrorCard
          config={this.props.config}
          error={{ message: `Custom island failed: ${this.state.error.message}` }}
        />
      );
    }
    return this.props.children;
  }
}

export function makeCustomIsland(appId: string, type: string, version: number): IslandRenderer {
  function CustomIsland(props: IslandRenderProps) {
    if (typeof window === "undefined") return <LoadingSkeleton />;
    const Renderer = useMemo(() => loadCustom(appId, type, version), []);
    return (
      <CustomErrorBoundary config={props.config}>
        <Suspense fallback={<LoadingSkeleton />}>
          <Renderer {...props} />
        </Suspense>
      </CustomErrorBoundary>
    );
  }
  return CustomIsland;
}

export { CustomPlaceholder };
