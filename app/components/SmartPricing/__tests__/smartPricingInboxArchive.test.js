// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../services/smartPricingApi", () => ({
  deleteSmartPricingInboxPlan: vi.fn(),
  getSmartPricingInboxPlans: vi.fn(),
  getSmartPricingInboxSummary: vi.fn(),
  patchSmartPricingInboxPlan: vi.fn(),
  saveSmartPricingInboxPlans: vi.fn(),
}));

import {
  patchSmartPricingInboxPlan,
  saveSmartPricingInboxPlans,
} from "../../../services/smartPricingApi";
import { setInboxPlansArchived } from "../smartPricingInboxPersistence";
import { readInboxPlans, writeInboxPlans } from "../smartPricingConstants";

const SHOP = "demo.myshopify.com";
const AT = "2026-10-22T10:00:00.000Z";
const ENTRY = {
  id: "archived_1",
  kind: "archived",
  title: "Test archived",
  at: AT,
};

function timeout() {
  return Object.assign(new Error("timeout of 60000ms exceeded"), {
    code: "ECONNABORTED",
  });
}

describe("setInboxPlansArchived", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    writeInboxPlans(
      SHOP,
      [
        { id: "SP-1", status: "completed", archived: false },
        { id: "SP-other", status: "running", archived: false },
      ],
      { persist: false },
    );
  });

  it("patches each plan row alone instead of saving the whole inbox", async () => {
    patchSmartPricingInboxPlan.mockResolvedValue({
      plan: {
        id: "SP-1",
        status: "completed",
        archived: true,
        archived_at: AT,
      },
      revision: "r2",
    });

    await setInboxPlansArchived(SHOP, [{ id: "SP-1" }], {
      archived: true,
      archivedAt: AT,
      entry: ENTRY,
    });

    expect(patchSmartPricingInboxPlan).toHaveBeenCalledWith(SHOP, "SP-1", {
      archived: true,
      archived_at: AT,
      append_activity: [ENTRY],
    });
    expect(saveSmartPricingInboxPlans).not.toHaveBeenCalled();
    const local = readInboxPlans(SHOP);
    expect(local.find((plan) => plan.id === "SP-1").archived).toBe(true);
    expect(local.find((plan) => plan.id === "SP-other").archived).toBe(false);
  });

  it("leaves the browser copy unarchived when the server never confirms", async () => {
    // The reported bug: a slow connection timed the save out, but the copy here
    // already read Archived, so a reload brought the server's Finished back.
    patchSmartPricingInboxPlan.mockRejectedValue(timeout());

    await expect(
      setInboxPlansArchived(SHOP, [{ id: "SP-1" }], {
        archived: true,
        archivedAt: AT,
        entry: ENTRY,
      }),
    ).rejects.toThrow(/timeout/);

    expect(patchSmartPricingInboxPlan).toHaveBeenCalledTimes(2);
    expect(
      readInboxPlans(SHOP).find((plan) => plan.id === "SP-1").archived,
    ).toBe(false);
  });

  it("retries a timed-out patch once", async () => {
    patchSmartPricingInboxPlan
      .mockRejectedValueOnce(timeout())
      .mockResolvedValueOnce({
        plan: { id: "SP-1", archived: true, archived_at: AT },
        revision: "r2",
      });

    await setInboxPlansArchived(SHOP, [{ id: "SP-1" }], {
      archived: true,
      archivedAt: AT,
    });

    expect(
      readInboxPlans(SHOP).find((plan) => plan.id === "SP-1").archived,
    ).toBe(true);
  });

  it("does not retry a refusal", async () => {
    patchSmartPricingInboxPlan.mockRejectedValue(
      Object.assign(new Error("Forbidden"), {
        response: { status: 403, data: {} },
      }),
    );

    await expect(
      setInboxPlansArchived(SHOP, [{ id: "SP-1" }], {
        archived: true,
        archivedAt: AT,
      }),
    ).rejects.toThrow("Forbidden");
    expect(patchSmartPricingInboxPlan).toHaveBeenCalledTimes(1);
  });

  it("falls back to the whole-inbox save for a plan the server never had", async () => {
    patchSmartPricingInboxPlan.mockRejectedValue(
      Object.assign(new Error("Request failed"), {
        response: { status: 400, data: { errors: ["Plan not found"] } },
      }),
    );
    saveSmartPricingInboxPlans.mockResolvedValue({ plans: [], revision: "r3" });

    await setInboxPlansArchived(SHOP, [{ id: "SP-1" }], {
      archived: true,
      archivedAt: AT,
      entry: ENTRY,
    });

    const saved = saveSmartPricingInboxPlans.mock.calls[0][1];
    const plan = saved.find((row) => row.id === "SP-1");
    expect(plan.archived).toBe(true);
    expect(plan.metadata.activity_log[0].id).toBe("archived_1");
  });
});
