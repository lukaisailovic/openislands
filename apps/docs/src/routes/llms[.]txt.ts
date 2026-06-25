import { linkToMarkdownSiblings, source } from "@/lib/source";
import { createFileRoute } from "@tanstack/react-router";
import { llms } from "fumadocs-core/source";

// llms.txt is the agent's entry point, so it points straight at the markdown: links
// below are rewritten to .md, and the note tells an agent the .md suffix works for any
// page it constructs itself (per the llms.txt convention of highlighting markdown).
const MARKDOWN_NOTE = `> These docs are markdown-first for agents. Each link below points to a page's raw \`.md\` — append \`.md\` to any page URL yourself, too. For every page concatenated into one file, fetch [/llms-full.txt](/llms-full.txt).

`;

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET() {
        return new Response(MARKDOWN_NOTE + linkToMarkdownSiblings(llms(source).index()));
      },
    },
  },
});
