import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import { remarkMdxMermaid } from "fumadocs-core/mdx-plugins";

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    // Required so page.data.getText("processed") works for llms.txt / *.md.
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
});

export default defineConfig({
  // Turns ```mermaid fenced blocks into <Mermaid chart="…" /> (our teal-themed
  // client component, registered in components/mdx.tsx). Authors write plain
  // ```mermaid fences; the .md/LLM output keeps them as fences too.
  mdxOptions: {
    remarkPlugins: [remarkMdxMermaid],
  },
});
