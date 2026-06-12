import type { LinkComponentProps } from "@cloudflare/kumo";
import { Link } from "@tanstack/react-router";
import { forwardRef } from "react";

export const RouterLink = forwardRef<HTMLAnchorElement, LinkComponentProps>(
  ({ href, to, ...rest }, ref) => <Link ref={ref} to={href ?? to ?? "/"} {...rest} />,
);
RouterLink.displayName = "RouterLink";
