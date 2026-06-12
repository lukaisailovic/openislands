import { Text } from "@cloudflare/kumo";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  detail?: ReactNode;
}

export function EmptyState({ icon, title, description, detail }: EmptyStateProps) {
  return (
    <div className="flex min-h-40 grow flex-col items-center justify-center gap-3 px-6 py-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-kumo-hairline bg-kumo-tint text-kumo-subtle">
        {icon}
      </div>
      <div className="flex flex-col items-center gap-1">
        <Text size="sm" as="p" className="font-medium text-kumo-strong">
          {title}
        </Text>
        {detail}
        {description ? (
          <Text variant="secondary" size="sm" as="p" className="max-w-60 text-balance">
            {description}
          </Text>
        ) : null}
      </div>
    </div>
  );
}

/** The shared empty state for chart islands whose dataset returned no rows. */
export function ChartEmpty({ icon }: { icon: ReactNode }) {
  return (
    <EmptyState icon={icon} title="No data yet" description="This dataset returned no rows." />
  );
}
