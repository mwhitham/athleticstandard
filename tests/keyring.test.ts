import { afterEach, describe, expect, it } from "vitest";
import {
  MemorySecretStore,
  clearKey,
  describeKeyStatus,
  envGateways,
  resolveGateway,
  resolveKey,
  savedGateways,
  setKey,
  usePromptSecret,
  useSecretStore,
} from "../src/keyring.js";

const store = new MemorySecretStore();

afterEach(() => {
  useSecretStore(undefined);
  usePromptSecret(undefined);
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.VERCEL_AI_GATEWAY_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
});

describe("the password store, never the athlete file (D75)", () => {
  it("saves and clears a key in a fake store", async () => {
    useSecretStore(store);
    usePromptSecret(async () => "sk-test-vercel");
    await setKey("vercel");
    expect(await savedGateways()).toEqual(["vercel"]);
    expect(await resolveKey("vercel")).toBe("sk-test-vercel");
    expect(await clearKey("vercel")).toEqual(["vercel"]);
    expect(await savedGateways()).toEqual([]);
  });

  it("set with a passed secret does not prompt", async () => {
    const fresh = new MemorySecretStore();
    useSecretStore(fresh);
    await setKey("openrouter", "sk-or-test");
    expect(await resolveKey("openrouter")).toBe("sk-or-test");
  });

  it("reads a key from the environment for scripts", async () => {
    useSecretStore(new MemorySecretStore());
    process.env.AI_GATEWAY_API_KEY = "sk-env";
    expect(await resolveGateway()).toBe("vercel");
    expect(await resolveKey("vercel")).toBe("sk-env");
    expect(envGateways()).toEqual(["vercel"]);
  });

  it("refuses to guess when both gateways are available", async () => {
    const both = new MemorySecretStore();
    useSecretStore(both);
    await setKey("vercel", "a");
    await setKey("openrouter", "b");
    await expect(resolveGateway()).rejects.toThrow("--gateway");
    expect(await resolveGateway("openrouter")).toBe("openrouter");
  });

  it("status names the gateway, not the key", () => {
    const text = describeKeyStatus(["vercel"], []);
    expect(text).toContain("vercel");
    expect(text).not.toContain("sk-");
    expect(text).toContain("password store");
  });
});
