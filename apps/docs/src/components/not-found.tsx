import { Link } from "@tanstack/react-router";

export function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-fd-muted-foreground">
        That page doesn&apos;t exist. Try the docs.
      </p>
      <Link
        to="/$"
        params={{ _splat: "introduction" }}
        className="rounded-lg bg-fd-primary px-3 py-2 text-sm font-medium text-fd-primary-foreground"
      >
        Go to Introduction
      </Link>
    </main>
  );
}
