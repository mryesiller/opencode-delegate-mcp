#!/usr/bin/env node
/**
 * opencode-delegate-mcp
 *
 * An MCP server that lets a primary coding agent (Claude Code, Codex, …)
 * delegate high-volume "grunt work" to cheaper models via the OpenCode CLI.
 *
 * Transport: stdio (local subprocess launched by the host agent).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { OpenCodeBackend } from "./backend.js";
import { registerTools } from "./tools.js";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  // `--help` / `--version` for quick CLI sanity checks (used by the installer).
  const arg = process.argv[2];
  if (arg === "--version" || arg === "-v") {
    process.stdout.write(`${SERVER_NAME} ${SERVER_VERSION}\n`);
    return;
  }
  if (arg === "--help" || arg === "-h") {
    process.stdout.write(
      `${SERVER_NAME} ${SERVER_VERSION}\n\n` +
        "An MCP (stdio) server that delegates coding grunt work to cheaper models via OpenCode.\n\n" +
        "Tools: delegate_task, delegate_tests, list_models, get_delegate_config, set_delegate_config\n\n" +
        "Run this as an MCP server (it speaks JSON-RPC over stdio); it is not meant to be used interactively.\n",
    );
    return;
  }

  const backend = new OpenCodeBackend();

  // Warn (to stderr) if the configured opencode binary isn't runnable, but do
  // not exit — the server is still useful for config/list operations and the
  // user may fix PATH afterwards.
  try {
    const config = loadConfig();
    const available = await backend.isAvailable(config.opencodeBin);
    if (!available) {
      console.error(
        `[${SERVER_NAME}] Warning: '${config.opencodeBin}' not found or not runnable. ` +
          "Install OpenCode (https://opencode.ai) or set opencode_bin via set_delegate_config.",
      );
    }
  } catch (err) {
    console.error(`[${SERVER_NAME}] Warning: failed to read config: ${err instanceof Error ? err.message : String(err)}`);
  }

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerTools(server, backend);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[${SERVER_NAME}] v${SERVER_VERSION} running via stdio`);
}

main().catch((err) => {
  console.error(`[${SERVER_NAME}] fatal:`, err);
  process.exit(1);
});
