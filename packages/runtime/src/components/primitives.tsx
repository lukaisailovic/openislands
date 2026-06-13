import { Button, Dialog, LayerCard, Text, Tooltip, cn } from "@cloudflare/kumo";
import { Database, X } from "@phosphor-icons/react";
import type { CSSProperties, ReactNode } from "react";
import type { Column } from "../types.js";

export interface SourceInfo {
  name: string;
  path?: string;
  kind: "file" | "sql";
  description?: string;
  columns?: Column[];
}

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
          <Text variant="secondary" size="sm" className="min-w-0 truncate">
            {title}
          </Text>
          {source ? <SourceButton source={source} /> : null}
        </LayerCard.Secondary>
      ) : null}
      <LayerCard.Primary className="flex min-w-0 flex-1 flex-col pr-4">{children}</LayerCard.Primary>
    </LayerCard>
  );
}

function SourceButton({ source }: { source: SourceInfo }) {
  return (
    <Dialog.Root>
      <Tooltip
        content={`Source: ${source.name}`}
        render={
          <Dialog.Trigger
            render={
              <Button
                variant="ghost"
                size="sm"
                shape="square"
                aria-label={`Source: ${source.name}`}
              >
                <Database size={14} />
              </Button>
            }
          />
        }
      />
      <Dialog size="sm" className="t-modal p-6">
        <div className="mb-1 flex items-start justify-between gap-4">
          <Dialog.Title className="text-base font-medium">{source.name}</Dialog.Title>
          <Dialog.Close
            aria-label="Close"
            render={(props) => (
              <Button {...props} variant="ghost" size="sm" shape="square" aria-label="Close">
                <X size={14} />
              </Button>
            )}
          />
        </div>
        {source.description ? (
          <Dialog.Description className="text-sm text-kumo-subtle">
            {source.description}
          </Dialog.Description>
        ) : null}
        <dl className="mt-4 flex flex-col gap-3 text-sm">
          {source.path ? (
            <div>
              <dt className="text-kumo-subtle">
                {source.kind === "sql" ? "SQL transform" : "File"}
              </dt>
              <dd className="mt-0.5">
                <Text as="code" variant="mono" size="sm" className="break-all">
                  {source.path}
                </Text>
              </dd>
            </div>
          ) : null}
          {source.columns && source.columns.length > 0 ? (
            <div>
              <dt className="text-kumo-subtle">Columns</dt>
              <dd className="mt-1 flex flex-col gap-0.5">
                {source.columns.map((column) => (
                  <div key={column.name} className="flex items-baseline justify-between gap-4">
                    <Text as="code" variant="mono" size="sm">
                      {column.name}
                    </Text>
                    <Text variant="secondary" size="xs">
                      {column.type}
                    </Text>
                  </div>
                ))}
              </dd>
            </div>
          ) : null}
        </dl>
      </Dialog>
    </Dialog.Root>
  );
}
