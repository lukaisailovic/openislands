import type { LinkComponentProps } from "@cloudflare/kumo";
import { Link } from "@tanstack/react-router";
import { forwardRef } from "react";

/**
 * A destination that isn't a client route — an external URL or a server endpoint under `/api/`
 * (OAuth `Connect`, file downloads) — must do a real browser navigation. Routing it through the
 * SPA router renders the nearest `notFoundComponent` (the server route has no client component)
 * instead of letting the server handler respond/redirect.
 */
function needsBrowserNavigation(href: string): boolean {
  return href.startsWith("/api/") || /^[a-z][\w+.-]*:/i.test(href);
}

export const RouterLink = forwardRef<HTMLAnchorElement, LinkComponentProps>(({ href, to, ...rest }, ref) => {
  const target = href ?? to ?? "/";
  if (typeof target === "string" && needsBrowserNavigation(target)) {
    return <a ref={ref} href={target} {...rest} />;
  }
  return <Link ref={ref} to={target} {...rest} />;
});
RouterLink.displayName = "RouterLink";
