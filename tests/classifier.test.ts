import { describe, expect, test } from "bun:test";
import { classify } from "../src/core/classifier.ts";
import type { EmailMeta } from "../src/core/types.ts";

const base: EmailMeta = {
  id: "x",
  from: "",
  to: "me@example.com",
  subject: "",
  date: "",
};

describe("classifier (seed-prompt § TESTING)", () => {
  test("1. GitHub notification → github_notification / trash candidate", () => {
    const r = classify({
      ...base,
      from: "notifications@github.com",
      subject: "[my-repo] Pull request #42 opened",
      listUnsubscribe: "<https://github.com/unsubscribe>",
    });
    expect(r.category).toBe("github_notification");
    expect(r.trashCandidate).toBe(true);
  });

  test("2. newsletter with List-Unsubscribe → newsletter / trash candidate", () => {
    const r = classify({
      ...base,
      from: "TLDR Newsletter <dan@tldrnewsletter.com>",
      subject: "TLDR Daily Update 2026-10-03",
      listUnsubscribe: "<mailto:unsub@tldrnewsletter.com>",
    });
    expect(r.category).toBe("newsletter");
    expect(r.trashCandidate).toBe(true);
  });

  test("3. noreply security alert → account_security / NOT trash candidate", () => {
    const r = classify({
      ...base,
      from: "noreply@mybank.com",
      subject: "Security alert: new sign-in to your account",
      autoSubmitted: "auto-generated",
    });
    expect(r.category).toBe("account_security");
    expect(r.trashCandidate).toBe(false);
  });

  test("4. human email → human_personal / NOT trash candidate", () => {
    const r = classify({
      ...base,
      from: "Priya Sharma <priya@example.com>",
      subject: "Re: weekend plan",
      snippet: "Hey! Thanks for sending that over, can you let me know what time works?",
    });
    expect(r.category).toBe("human_personal");
    expect(r.trashCandidate).toBe(false);
  });

  test("5. ambiguous notification → uncertain / NOT trash candidate", () => {
    const r = classify({
      ...base,
      from: "notifications@example.com",
      subject: "Update available",
    });
    expect(r.category).toBe("uncertain");
    expect(r.trashCandidate).toBe(false);
  });

  test("6. receipt → receipt / NOT trash candidate", () => {
    const r = classify({
      ...base,
      from: "receipts@store.com",
      subject: "Your payment receipt — Order #1234 paid $49.00",
    });
    expect(r.category).toBe("receipt");
    expect(r.trashCandidate).toBe(false);
  });

  test("safety: account_security never trashable even with bulk headers", () => {
    const r = classify({
      ...base,
      from: "no-reply@bank.com",
      subject: "Your one-time security code is 482 913",
      precedence: "bulk",
      listUnsubscribe: "<https://bank.com/unsub>",
    });
    expect(r.category).toBe("account_security");
    expect(r.trashCandidate).toBe(false);
  });
});
