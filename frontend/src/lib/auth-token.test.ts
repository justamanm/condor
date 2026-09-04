// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TOKEN_KEY, USER_KEY, authFetch } from "./auth-token";

describe("authFetch", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size; },
    } satisfies Storage;
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renews an expired local session and retries the failed request", async () => {
    localStorage.setItem(TOKEN_KEY, "expired-token");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ mode: "local" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        token: "fresh-token",
        user: { id: 1, username: "local", first_name: "Local", role: "admin" },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const response = await authFetch("/api/v1/servers");

    expect(response.status).toBe(200);
    expect(localStorage.getItem(TOKEN_KEY)).toBe("fresh-token");
    expect(localStorage.getItem(USER_KEY)).toContain('"id":1');
    const retryHeaders = new Headers(fetchMock.mock.calls[3][1]?.headers);
    expect(retryHeaders.get("Authorization")).toBe("Bearer fresh-token");
  });

  it("does not bypass login when the install is not in local mode", async () => {
    localStorage.setItem(TOKEN_KEY, "expired-token");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ mode: "telegram" }), { status: 200 }));

    const response = await authFetch("/api/v1/servers");

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(TOKEN_KEY)).toBe("expired-token");
  });
});
