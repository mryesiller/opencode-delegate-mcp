/**
 * Shared constants for the opencode-delegate MCP server.
 */

export const SERVER_NAME = "opencode-delegate-mcp";
export const SERVER_VERSION = "0.2.3";

/** Maximum size (characters) of a tool text response before truncation. */
export const CHARACTER_LIMIT = 30_000;

/** Default per-delegation timeout in milliseconds (10 minutes). */
export const DEFAULT_TIMEOUT_MS = 600_000;

/** Default OpenCode binary name (resolved from PATH unless overridden in config). */
export const DEFAULT_OPENCODE_BIN = "opencode";
