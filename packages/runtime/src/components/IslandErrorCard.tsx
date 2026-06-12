import { Banner, Text } from "@cloudflare/kumo";
import { WarningCircle } from "@phosphor-icons/react";
import type { IslandConfig, IslandQueryError } from "../types.js";

interface Props {
  config: IslandConfig;
  error: IslandQueryError;
}

/**
 * The fail-loudly, in-island error card. When an island's data can't be loaded
 * or its contract check fails, only THIS island shows the error — the rest of
 * the page keeps working. It names the dataset, the offending field, what the
 * island needs, and tells the user to ask their agent to fix it.
 */
export function IslandErrorCard({ config, error }: Props) {
  const dataset = error.dataset ?? config.dataset;
  const missing = error.missingFields ?? (error.field ? [error.field] : []);

  return (
    <Banner
      data-testid="island-error"
      data-island-type={config.type}
      variant="error"
      icon={<WarningCircle weight="fill" />}
      title={config.title ? `${config.title} — can't render` : "This island can't render"}
      description={
        <div className="flex flex-col gap-1">
          <span>
            <Text as="strong" bold className="text-inherit">
              {config.type}
            </Text>
            {dataset ? (
              <>
                {" "}
                needs dataset{" "}
                <Text as="code" variant="mono" className="text-inherit">
                  {dataset}
                </Text>
              </>
            ) : null}
          </span>
          {missing.length > 0 ? (
            <span>
              Missing field{missing.length > 1 ? "s" : ""}:{" "}
              {missing.map((f, i) => (
                <span key={f}>
                  {i > 0 ? ", " : null}
                  <Text as="code" variant="mono" className="text-inherit">
                    {f}
                  </Text>
                </span>
              ))}
            </span>
          ) : null}
          <span>{error.message}</span>
          <Text variant="secondary" size="xs" className="mt-1">
            Ask your agent to fix the manifest or the data.
          </Text>
        </div>
      }
    />
  );
}
