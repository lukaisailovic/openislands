import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RouterLink } from "../src/components/RouterLink.js";

describe("RouterLink", () => {
  it("renders a real anchor for server /api routes so the browser hits the handler, not the SPA router", () => {
    const { container } = render(
      <RouterLink href="/api/connectors/whoop/auth/start?app=health">Connect</RouterLink>,
    );
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/api/connectors/whoop/auth/start?app=health",
    );
  });

  it("renders a real anchor for external URLs", () => {
    const { container } = render(<RouterLink href="https://example.com/docs">Docs</RouterLink>);
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.com/docs");
  });
});
