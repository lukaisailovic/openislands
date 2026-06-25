import { createFileRoute, notFound } from "@tanstack/react-router";
import { getLLMText, linkToMarkdownSiblings, markdownPathToSlugs, source } from "@/lib/source";

const MARKDOWN_FOOTER = `

---

*This is one page of the OpenIslands docs. Every page in one file: [/llms-full.txt](/llms-full.txt). Page index: [/llms.txt](/llms.txt). Links above point to \`.md\` siblings — append \`.md\` to any page URL for its raw markdown.*
`;

export const Route = createFileRoute("/{$}.md")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const slugs = markdownPathToSlugs(params._splat?.split("/") ?? []);
        const page = source.getPage(slugs);
        if (!page) throw notFound();

        const markdown = linkToMarkdownSiblings(await getLLMText(page)) + MARKDOWN_FOOTER;
        return new Response(markdown, {
          headers: {
            "Content-Type": "text/markdown",
          },
        });
      },
    },
  },
});
