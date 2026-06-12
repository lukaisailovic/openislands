import { Empty, type EmptyProps, cn } from "@cloudflare/kumo";
import { Database } from "@phosphor-icons/react";

/** Kumo's Empty, restyled to sit flush inside an island card. */
export function IslandEmpty({ className, ...props }: EmptyProps) {
  return (
    <Empty
      size="sm"
      {...props}
      className={cn("min-h-40 grow justify-center border-0 bg-transparent", className)}
    />
  );
}

/** The shared empty state for data-bound islands whose dataset returned no rows. */
export function NoData() {
  return (
    <IslandEmpty
      icon={<Database size={28} weight="duotone" className="text-kumo-subtle" />}
      title="No data yet"
      description="This dataset returned no rows."
    />
  );
}
