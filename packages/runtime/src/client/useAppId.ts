import { createContext, useContext } from "react";

/**
 * The active app's id, provided by the `/$appId` layout route. A context (not a
 * route param read) so islands and dialogs stay renderable without a router —
 * unit tests and embedding both rely on that.
 */
export const AppIdContext = createContext("");

export function useAppId(): string {
  return useContext(AppIdContext);
}
