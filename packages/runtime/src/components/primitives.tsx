import { LayerCard, Text, cn } from "@cloudflare/kumo";
import type { CSSProperties, ReactNode } from "react";
import { SourceButton, type SourceInfo } from "./SourceDialog.js";

export type { SourceInfo };

export function IslandCard({
  title,
  source,
  style,
  className,
  children,
}: {
  title?: ReactNode;
  source?: SourceInfo | null;
  style?: CSSProperties;
  className?: string;
  children: ReactNode;
}) {
  const hasHeader = Boolean(title) || Boolean(source);
  return (
    <LayerCard style={style} className={cn("flex h-full min-w-0 flex-col", className)}>
      {hasHeader ? (
        <LayerCard.Secondary className="flex items-center justify-between gap-2">
          <Text variant="secondary" size="sm" DANGEROUS_className="min-w-0 truncate">
            {title}
          </Text>
          {source ? <SourceButton source={source} /> : null}
        </LayerCard.Secondary>
      ) : null}
      <LayerCard.Primary className="flex min-w-0 flex-1 flex-col pr-4">{children}</LayerCard.Primary>
    </LayerCard>
  );
}
