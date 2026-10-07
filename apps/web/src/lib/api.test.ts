import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "./api";

describe("api", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("getRepos calls fetch with credentials", async () => {
    const mockFetch = vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response);

    await api.getRepos();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/repos"),
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("getRepos throws on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Forbidden" }),
    } as Response);

    await expect(api.getRepos()).rejects.toThrow();
  });
});
