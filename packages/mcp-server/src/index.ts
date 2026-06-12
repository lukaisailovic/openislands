#!/usr/bin/env node
/**
 * @openislands/mcp entry — boots the server over stdio.
 * Project root: argv[2], or $OPENISLANDS_PROJECT, or cwd.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

const projectRoot = process.argv[2] ?? process.env.OPENISLANDS_PROJECT ?? process.cwd();
const server = createServer(projectRoot);
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`openislands MCP server ready · project: ${projectRoot}`);
