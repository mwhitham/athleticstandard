/**
 * The gateway key lives in the computer's password store, never in the athlete
 * file (D75). Agents read that file.
 *
 * Keychain on a Mac, Credential Manager on Windows, the secret service on Linux.
 * The OS encrypts it and unlocks it when they are logged in. We do not invent our
 * own lock, and we do not write a plaintext file if the store is missing.
 */
import { spawnSync } from "node:child_process";

export const KEYRING_SERVICE = "athleticstandard";

export type GatewayName = "vercel" | "openrouter";

export const GATEWAYS: readonly GatewayName[] = ["vercel", "openrouter"];

export function isGatewayName(value: string): value is GatewayName {
  return (GATEWAYS as readonly string[]).includes(value);
}

/** Raised when the store cannot do what was asked, with the remedy in the message. */
export class KeyRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyRefusal";
  }
}

export interface SecretStore {
  get(service: string, account: string): Promise<string | undefined>;
  set(service: string, account: string, password: string): Promise<void>;
  delete(service: string, account: string): Promise<void>;
}

/** In-memory store for tests. Never used as a fallback in a real run. */
export class MemorySecretStore implements SecretStore {
  private readonly map = new Map<string, string>();

  async get(service: string, account: string): Promise<string | undefined> {
    return this.map.get(`${service}:${account}`);
  }

  async set(service: string, account: string, password: string): Promise<void> {
    this.map.set(`${service}:${account}`, password);
  }

  async delete(service: string, account: string): Promise<void> {
    this.map.delete(`${service}:${account}`);
  }
}

let storeOverride: SecretStore | undefined;
let promptOverride: ((question: string) => Promise<string>) | undefined;

/** Tests inject a fake store so they never touch the real password store. */
export function useSecretStore(store: SecretStore | undefined): void {
  storeOverride = store;
}

/** Tests inject the pasted key so they do not wait on a terminal. */
export function usePromptSecret(fn: ((question: string) => Promise<string>) | undefined): void {
  promptOverride = fn;
}

export function secretStore(): SecretStore {
  return storeOverride ?? osSecretStore();
}

/**
 * Hidden input for `ath key set`.
 *
 * Echo is off so the key does not linger on the screen. Tests replace this.
 */
export async function promptSecret(question: string): Promise<string> {
  if (promptOverride) return promptOverride(question);
  if (!process.stdin.isTTY) {
    throw new KeyRefusal(
      `there is no terminal to paste a key into. Run this somewhere you can type, ` +
        `or set AI_GATEWAY_API_KEY / OPENROUTER_API_KEY in the environment.`,
    );
  }

  process.stdout.write(question);
  const stdin = process.stdin;
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  let value = "";
  try {
    await new Promise<void>((resolve, reject) => {
      const onData = (chunk: Buffer | string) => {
        const s = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        for (const ch of s) {
          if (ch === "\n" || ch === "\r" || ch === "\u0004") {
            cleanup();
            process.stdout.write("\n");
            resolve();
            return;
          }
          if (ch === "\u0003") {
            cleanup();
            process.stdout.write("\n");
            reject(new KeyRefusal("nothing was saved."));
            return;
          }
          if (ch === "\u007f" || ch === "\b") {
            value = value.slice(0, -1);
            continue;
          }
          if (ch >= " ") value += ch;
        }
      };
      const cleanup = () => stdin.off("data", onData);
      stdin.on("data", onData);
    });
  } finally {
    stdin.setRawMode(wasRaw ?? false);
    stdin.pause();
  }
  return value;
}

export async function setKey(gateway: GatewayName, secret?: string): Promise<void> {
  const value = (secret ?? (await promptSecret(`Paste your ${gateway} key: `))).trim();
  if (value === "") {
    throw new KeyRefusal(`no key was entered, so nothing was saved.`);
  }
  try {
    await secretStore().set(KEYRING_SERVICE, gateway, value);
  } catch (e) {
    if (e instanceof KeyRefusal) throw e;
    throw new KeyRefusal(
      `could not save the key in the password store: ${(e as Error).message}. ` +
        `We will not write it to a file.`,
    );
  }
}

export async function clearKey(gateway?: GatewayName): Promise<GatewayName[]> {
  const targets = gateway ? [gateway] : [...GATEWAYS];
  const cleared: GatewayName[] = [];
  for (const name of targets) {
    const existing = await secretStore().get(KEYRING_SERVICE, name);
    if (existing === undefined) continue;
    await secretStore().delete(KEYRING_SERVICE, name);
    cleared.push(name);
  }
  return cleared;
}

export async function savedGateways(): Promise<GatewayName[]> {
  const found: GatewayName[] = [];
  for (const name of GATEWAYS) {
    if ((await secretStore().get(KEYRING_SERVICE, name)) !== undefined) found.push(name);
  }
  return found;
}

export function envVarFor(gateway: GatewayName): string {
  return gateway === "vercel" ? "AI_GATEWAY_API_KEY" : "OPENROUTER_API_KEY";
}

/** A key already in the environment, for scripts. */
export function envKey(gateway: GatewayName): string | undefined {
  if (gateway === "vercel") {
    return firstEnv("AI_GATEWAY_API_KEY", "VERCEL_AI_GATEWAY_API_KEY");
  }
  return firstEnv("OPENROUTER_API_KEY");
}

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function envGateways(): GatewayName[] {
  return GATEWAYS.filter((name) => envKey(name) !== undefined);
}

/**
 * Which gateway to use, or a refusal when both are present and none was named.
 *
 * Env vars win for scripts. The saved store is the path for a person. When both
 * gateways are available and `--gateway` was not passed, we stop rather than guess.
 */
export async function resolveGateway(requested?: GatewayName): Promise<GatewayName | undefined> {
  if (requested) {
    const key = envKey(requested) ?? (await secretStore().get(KEYRING_SERVICE, requested));
    return key ? requested : undefined;
  }

  const available: GatewayName[] = [];
  for (const name of GATEWAYS) {
    if (envKey(name) ?? (await secretStore().get(KEYRING_SERVICE, name))) available.push(name);
  }
  if (available.length === 0) return undefined;
  if (available.length === 1) return available[0];
  throw new KeyRefusal(
    `both vercel and openrouter keys are available. Pass --gateway vercel or --gateway openrouter.`,
  );
}

export async function resolveKey(gateway: GatewayName): Promise<string | undefined> {
  return envKey(gateway) ?? (await secretStore().get(KEYRING_SERVICE, gateway));
}

export function describeKeyStatus(saved: GatewayName[], fromEnv: GatewayName[]): string {
  const lines = [
    `A gateway key is only for calling a model from a bare terminal.`,
    `Inside Claude Code, Cursor, or Codex you do not need one.`,
    `The key never goes in the athlete file.`,
    ``,
  ];
  if (saved.length === 0 && fromEnv.length === 0) {
    lines.push(`No gateway key is saved.`);
    lines.push(`Run \`ath key set vercel\` or \`ath key set openrouter\`, or set`);
    lines.push(`${envVarFor("vercel")} / ${envVarFor("openrouter")} in the environment.`);
    return lines.join("\n");
  }
  if (saved.length > 0) lines.push(`Saved in the password store: ${saved.join(", ")}.`);
  if (fromEnv.length > 0) {
    lines.push(
      `Set in the environment: ${fromEnv.map((g) => `${g} (${envVarFor(g)})`).join(", ")}.`,
    );
  }
  lines.push(`The key itself is not printed.`);
  return lines.join("\n");
}

function osSecretStore(): SecretStore {
  if (process.platform === "darwin") return darwinStore();
  if (process.platform === "win32") return windowsStore();
  return linuxStore();
}

function missingStore(): KeyRefusal {
  return new KeyRefusal(
    `this computer has no password store we can use, so the key was not saved. ` +
      `Install the secret service (secret-tool) or set ${envVarFor("vercel")} / ` +
      `${envVarFor("openrouter")} in the environment. We will not write the key to a file.`,
  );
}

function which(cmd: string): boolean {
  const finder = process.platform === "win32" ? "where" : "which";
  return spawnSync(finder, [cmd], { encoding: "utf8" }).status === 0;
}

function darwinStore(): SecretStore {
  return {
    async get(_service, account) {
      const res = spawnSync(
        "security",
        ["find-generic-password", "-s", KEYRING_SERVICE, "-a", account, "-w"],
        { encoding: "utf8" },
      );
      if (res.status !== 0) return undefined;
      const value = res.stdout.trim();
      return value === "" ? undefined : value;
    },
    async set(_service, account, password) {
      const res = spawnSync(
        "security",
        ["add-generic-password", "-U", "-s", KEYRING_SERVICE, "-a", account, "-w", password],
        { encoding: "utf8" },
      );
      if (res.status !== 0) {
        throw new KeyRefusal(
          `Keychain refused to save the key: ${(res.stderr || res.stdout).trim() || "unknown error"}.`,
        );
      }
    },
    async delete(_service, account) {
      spawnSync("security", ["delete-generic-password", "-s", KEYRING_SERVICE, "-a", account], {
        encoding: "utf8",
      });
    },
  };
}

function linuxStore(): SecretStore {
  if (!which("secret-tool")) {
    return {
      async get() {
        return undefined;
      },
      async set() {
        throw missingStore();
      },
      async delete() {
        /* nothing saved */
      },
    };
  }
  return {
    async get(_service, account) {
      const res = spawnSync(
        "secret-tool",
        ["lookup", "service", KEYRING_SERVICE, "account", account],
        { encoding: "utf8" },
      );
      if (res.status !== 0) return undefined;
      const value = res.stdout.replace(/\n$/, "");
      return value === "" ? undefined : value;
    },
    async set(_service, account, password) {
      const res = spawnSync(
        "secret-tool",
        ["store", "--label", `Athletic Standard (${account})`, "service", KEYRING_SERVICE, "account", account],
        { encoding: "utf8", input: `${password}\n` },
      );
      if (res.status !== 0) {
        throw new KeyRefusal(
          `the secret service refused to save the key: ${(res.stderr || res.stdout).trim() || "unknown error"}.`,
        );
      }
    },
    async delete(_service, account) {
      spawnSync("secret-tool", ["clear", "service", KEYRING_SERVICE, "account", account], {
        encoding: "utf8",
      });
    },
  };
}

function windowsStore(): SecretStore {
  if (!which("powershell")) {
    return {
      async get() {
        return undefined;
      },
      async set() {
        throw missingStore();
      },
      async delete() {
        /* nothing saved */
      },
    };
  }
  return {
    async get(_service, account) {
      const res = runPowershell("get", account);
      if (res.status !== 0) return undefined;
      const value = res.stdout.trim();
      return value === "" ? undefined : value;
    },
    async set(_service, account, password) {
      const res = runPowershell("set", account, password);
      if (res.status !== 0) {
        throw new KeyRefusal(
          `Credential Manager refused to save the key: ${(res.stderr || res.stdout).trim() || "unknown error"}.`,
        );
      }
    },
    async delete(_service, account) {
      runPowershell("delete", account);
    },
  };
}

/**
 * Windows Credential Manager, via a small CredWrite/CredRead helper.
 *
 * The secret is passed in an env var so it never appears on the command line.
 */
function runPowershell(op: "get" | "set" | "delete", account: string, password = "") {
  const target = `${KEYRING_SERVICE}/${account}`;
  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class AthCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags;
    public uint Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist;
    public uint AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CredWrite([In] ref CREDENTIAL userCredential, uint flags);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CredRead(string target, uint type, uint reserved, out IntPtr credentialPtr);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CredDelete(string target, uint type, uint reserved);
  [DllImport("advapi32.dll")]
  public static extern void CredFree(IntPtr cred);
}
"@
$op = $env:ATH_KEYRING_OP
$target = $env:ATH_KEYRING_TARGET
if ($op -eq 'get') {
  $ptr = [IntPtr]::Zero
  if (-not [AthCred]::CredRead($target, 1, 0, [ref]$ptr)) { exit 1 }
  $cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][AthCred+CREDENTIAL])
  $bytes = New-Object byte[] $cred.CredentialBlobSize
  [System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
  [AthCred]::CredFree($ptr)
  [Console]::Write([System.Text.Encoding]::Unicode.GetString($bytes))
} elseif ($op -eq 'set') {
  $secret = $env:ATH_KEYRING_SECRET
  $bytes = [System.Text.Encoding]::Unicode.GetBytes($secret)
  $ptr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
  [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)
  $cred = New-Object AthCred+CREDENTIAL
  $cred.Type = 1
  $cred.TargetName = $target
  $cred.UserName = 'athleticstandard'
  $cred.CredentialBlobSize = $bytes.Length
  $cred.CredentialBlob = $ptr
  $cred.Persist = 2
  $ok = [AthCred]::CredWrite([ref]$cred, 0)
  [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
  if (-not $ok) { exit 1 }
} elseif ($op -eq 'delete') {
  [AthCred]::CredDelete($target, 1, 0) | Out-Null
}
`;
  return spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      ATH_KEYRING_OP: op,
      ATH_KEYRING_TARGET: target,
      ATH_KEYRING_SECRET: password,
    },
  });
}
