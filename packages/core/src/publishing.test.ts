import { describe, expect, it } from "vitest";
import { pageCacheTags, signWebhook, verifyWebhookSignature } from "./index";

describe("pageCacheTags", () => {
  it("tags pages by id and address", () => {
    expect(
      pageCacheTags({ id: "pg_1", siteId: "st_1", kind: "page", locale: "en", slug: "/a" }),
    ).toEqual(["builder:page:pg_1", "builder:slug:st_1:en:/a"]);
    expect(
      pageCacheTags({ id: "pg_2", siteId: "st_1", kind: "region", locale: "en", name: "hero" })[1],
    ).toBe("builder:region:st_1:en:hero");
  });
});

describe("webhook signatures", () => {
  const body = JSON.stringify({ id: "job_1" });

  it("verifies its own signature within the tolerance", async () => {
    const header = await signWebhook("whsec_a", body, 1_000);
    expect(header).toMatch(/^t=1000,v1=[0-9a-f]{64}$/);
    expect(await verifyWebhookSignature("whsec_a", header, body, { now: 1_100 })).toBe(true);
    expect(
      await verifyWebhookSignature(["whsec_old", "whsec_a"], header, body, { now: 1_100 }),
    ).toBe(true);
  });

  it("rejects tampering, wrong secrets, stale or missing headers", async () => {
    const header = await signWebhook("whsec_a", body, 1_000);
    expect(await verifyWebhookSignature("whsec_a", header, `${body} `, { now: 1_000 })).toBe(false);
    expect(await verifyWebhookSignature("whsec_b", header, body, { now: 1_000 })).toBe(false);
    expect(await verifyWebhookSignature("whsec_a", header, body, { now: 1_400 })).toBe(false);
    expect(await verifyWebhookSignature("whsec_a", null, body)).toBe(false);
    expect(await verifyWebhookSignature("whsec_a", "t=abc,v1=", body)).toBe(false);
  });
});
