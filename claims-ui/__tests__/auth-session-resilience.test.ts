import { fetchCurrentUser, TransientAuthCheckError } from "@/lib/auth";

const mockFetch = jest.fn();

describe("fetchCurrentUser", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    Object.defineProperty(window, "fetch", {
      configurable: true,
      writable: true,
      value: mockFetch,
    });
  });

  test("returns the current user when the session cookie is accepted", async () => {
    const user = {
      id: "user-1",
      email: "admin@claims-engine.local",
      full_name: "System Admin",
      role: "ADMIN",
      market_region: "UAE",
      is_active: true,
      is_api_key: false,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValueOnce(user),
    });

    await expect(fetchCurrentUser({ strict: true })).resolves.toEqual(user);
    expect(mockFetch).toHaveBeenCalledWith("/api/v1/proxy/auth/me", {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
  });

  test("throws a transient error for edge rate limits in strict mode", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: jest.fn(),
    });

    await expect(fetchCurrentUser({ strict: true })).rejects.toMatchObject({
      name: "TransientAuthCheckError",
      status: 429,
    } satisfies Partial<TransientAuthCheckError>);
  });

  test("keeps non-strict callers backward compatible on edge rate limits", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: jest.fn(),
    });

    await expect(fetchCurrentUser()).resolves.toBeNull();
  });

  test("returns null for a real unauthenticated response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: jest.fn(),
    });

    await expect(fetchCurrentUser({ strict: true })).resolves.toBeNull();
  });
});
