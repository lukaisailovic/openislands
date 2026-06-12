import { Button, Dialog } from "@cloudflare/kumo";
import { ArrowsOutSimple, X } from "@phosphor-icons/react";
import type { ReactNode } from "react";

/**
 * The "see all" affordance for tabular islands: a quiet footer button that
 * opens a wide modal with the island's full data. Content mounts only when
 * the dialog opens.
 */
export function SeeAllDialog({
  label,
  title,
  width = "w-[min(92vw,72rem)]",
  children,
}: {
  label: string;
  title: string;
  /** dialog width class — tables want the full 72rem, feeds read better narrower */
  width?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root>
      <Dialog.Trigger
        render={
          <Button variant="ghost" size="sm" className="mt-2 self-start text-kumo-subtle">
            <ArrowsOutSimple size={14} />
            {label}
          </Button>
        }
      />
      <Dialog size="xl" className={`t-modal ${width} flex max-h-[85vh] flex-col p-6`}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <Dialog.Title className="text-base font-medium">{title}</Dialog.Title>
          <Dialog.Close
            aria-label="Close"
            render={(props) => (
              <Button {...props} variant="ghost" size="sm" shape="square" aria-label="Close">
                <X size={14} />
              </Button>
            )}
          />
        </div>
        <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 text-[14px]/[20px]">{children}</div>
      </Dialog>
    </Dialog.Root>
  );
}
