/**
 * Persistent, runtime-editable configuration for the delegate server.
 *
 * The config lives at `$XDG_CONFIG_HOME/opencode-delegate/config.json`
 * (falling back to `~/.config/opencode-delegate/config.json`) and can be
 * overridden with the `OPENCODE_DELEGATE_CONFIG` environment variable.
 *
 * It is read fresh on every tool call so that both the installer and the
 * `set_delegate_config` tool can change the active model/provider dynamically
 * without a server restart.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { z } from "zod";
import { DEFAULT_OPENCODE_BIN, DEFAULT_TIMEOUT_MS } from "./constants.js";

/** A reusable named preset (e.g. "tests", "cheap") the caller can select. */
export const ProfileSchema = z
  .object({
    model: z.string().min(1).optional().describe("provider/model id, e.g. 'minimax-coding-plan/MiniMax-M2.5-highspeed'"),
    agent: z.string().min(1).optional().describe("OpenCode agent name to run this profile with"),
    variant: z.string().min(1).optional().describe("Provider reasoning effort variant, e.g. 'high' | 'minimal'"),
    autoApprove: z.boolean().optional().describe("Auto-approve tool permissions for this profile"),
  })
  .strict();

export type Profile = z.infer<typeof ProfileSchema>;

export const ConfigSchema = z
  .object({
    /** Path or name of the OpenCode binary. */
    opencodeBin: z.string().min(1).default(DEFAULT_OPENCODE_BIN),
    /** Default provider/model used when a delegation does not specify one. */
    defaultModel: z.string().min(1).optional(),
    /** Default OpenCode agent for delegations. */
    defaultAgent: z.string().min(1).optional(),
    /** Default reasoning-effort variant. */
    defaultVariant: z.string().min(1).optional(),
    /** Auto-approve tool permissions so headless delegations don't block. */
    autoApprove: z.boolean().default(true),
    /** Per-delegation timeout in milliseconds. */
    timeoutMs: z.number().int().positive().default(DEFAULT_TIMEOUT_MS),
    /** Default working directory for delegations when the caller omits one. */
    defaultDirectory: z.string().min(1).optional(),
    /** Named presets selectable via the `profile` argument. */
    profiles: z.record(z.string(), ProfileSchema).default({}),
  })
  .strict();

export type DelegateConfig = z.infer<typeof ConfigSchema>;

export function getConfigPath(): string {
  const override = process.env.OPENCODE_DELEGATE_CONFIG;
  if (override && override.trim().length > 0) return override;
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "opencode-delegate", "config.json");
}

/** Load config from disk, returning schema defaults when the file is absent. */
export function loadConfig(): DelegateConfig {
  const path = getConfigPath();
  if (!existsSync(path)) {
    return ConfigSchema.parse({});
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(
      `Delegate config at ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return ConfigSchema.parse(raw);
}

/** Write a full config object to disk (pretty-printed), creating dirs as needed. */
export function saveConfig(config: DelegateConfig): DelegateConfig {
  const validated = ConfigSchema.parse(config);
  const path = getConfigPath();
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(validated, null, 2) + "\n", "utf8");
  return validated;
}

/** Shallow-merge a partial update into the on-disk config and persist it. */
export function updateConfig(patch: Partial<DelegateConfig>): DelegateConfig {
  const current = loadConfig();
  const merged: DelegateConfig = {
    ...current,
    ...patch,
    // Merge profiles rather than replacing the whole map.
    profiles: { ...current.profiles, ...(patch.profiles ?? {}) },
  };
  return saveConfig(merged);
}
