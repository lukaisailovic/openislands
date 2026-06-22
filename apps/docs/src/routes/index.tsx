import { createFileRoute } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { baseOptions } from "@/lib/layout.shared";
import { Home } from "@/components/home";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <HomeLayout {...baseOptions()}>
      <Home />
    </HomeLayout>
  );
}
