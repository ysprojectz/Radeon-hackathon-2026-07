import { bulkHITLDecision } from "@/lib/api";
import { getNextQueueIndex, isEditableShortcutTarget } from "@/lib/hitl-workflow";

describe("HITL workflow helpers", () => {
  test("ignores keyboard shortcuts from editable fields", () => {
    expect(isEditableShortcutTarget(document.createElement("input"))).toBe(true);
    expect(isEditableShortcutTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableShortcutTarget(document.createElement("select"))).toBe(true);

    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    expect(isEditableShortcutTarget(editor)).toBe(true);

    expect(isEditableShortcutTarget(document.createElement("button"))).toBe(false);
  });

  test("moves through queue indexes without wrapping", () => {
    expect(getNextQueueIndex(0, 3, "next")).toBe(1);
    expect(getNextQueueIndex(1, 3, "previous")).toBe(0);
    expect(getNextQueueIndex(2, 3, "next")).toBe(2);
    expect(getNextQueueIndex(0, 3, "previous")).toBe(0);
    expect(getNextQueueIndex(-1, 0, "next")).toBe(-1);
  });
});

describe("bulkHITLDecision", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test("posts claim ids and supported final decision to the bulk endpoint", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: "ok", updated_count: 2 }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(bulkHITLDecision(["CLM-1", "CLM-2"], "SETTLED")).resolves.toEqual({
      message: "ok",
      updated_count: 2,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/proxy/claims/bulk-decision",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ claim_ids: ["CLM-1", "CLM-2"], decision: "SETTLED" }),
      }),
    );
  });
});
