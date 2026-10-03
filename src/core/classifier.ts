import type { Category, Classification, EmailMeta } from "./types.ts";

/**
 * Deterministic rule-based classifier.
 *
 * Pure function: (meta) -> { category, confidence, reasons } + trashCandidate.
 * No network, no filesystem, no console. Safe to reuse from CLI, web UI, mobile.
 *
 * Safety invariants (must never break):
 * - `account_security`, `human_personal`, `uncertain` are NEVER trash candidates.
 * - `receipt` is NEVER a trash candidate (money trail).
 * - Being automated alone does NOT make an email trashable.
 */

const TRASHABLE: ReadonlySet<Category> = new Set([
  "automated_notification",
  "newsletter",
  "marketing",
  "job_alert",
  "github_notification",
  "social_notification",
]);

export function isTrashableCategory(category: Category): boolean {
  return TRASHABLE.has(category);
}

export function classify(meta: EmailMeta): Classification & { trashCandidate: boolean } {
  const from = (meta.from ?? "").toLowerCase();
  const subject = (meta.subject ?? "").toLowerCase();
  const snippet = (meta.snippet ?? "").toLowerCase();
  const combined = `${from} ${subject} ${snippet}`;
  const reasons: string[] = [];

  const has = (re: RegExp, text = combined) => re.test(text);
  const header = (v?: string) => (v ?? "").trim();

  const listUnsub = header(meta.listUnsubscribe);
  const precedence = header(meta.precedence).toLowerCase();
  const autoSubmitted = header(meta.autoSubmitted).toLowerCase();

  // ---- 1. Protected: account security / receipts FIRST (highest precedence) ----
  // These win even if the sender looks automated (e.g. noreply@bank.com).
  if (
    has(/password\s*reset|reset\s*(your\s*)?password|verify\s*(your\s*)?(email|account|identity)|two[\s-]?factor|2fa|otp\b|one[\s-]?time\s*(passcode|password|code)|security\s*(code|alert|notice|warning)|unusual\s*(sign|log)[-\s]?in|suspicious\s*(activity|login|sign)|login\s*(alert|attempt|verification)|confirm\s*(your\s*)?(login|sign[\s-]?in)|account\s*(locked|suspended|compromised|recovery)/) ||
    has(/@.*bank|chase|wellsfargo|bankofamerica|citibank|capitalone|paypal|stripe/) &&
      has(/secur|verif|alert|code|login/)
  ) {
    reasons.push("subject/snippet matches security pattern (reset/2FA/login alert/verify)");
    return finish("account_security", 0.9, reasons);
  }

  if (
    has(/receipt|invoice|payment\s*(received|confirmed|successful)|order\s*(confirmation|receipt|shipped|#)|your\s*(order|payment|subscription\s*(receipt|invoice))|transaction\s*(receipt|alert|confirmation)|billing\s*statement|payslip|salary\s*slip/) ||
    has(/receipt|invoice/) && has(/paid|\$\s?\d|usd|inr|rs\.?\s?\d|order/)
  ) {
    reasons.push("subject/snippet matches receipt/payment pattern");
    return finish("receipt", 0.85, reasons);
  }

  // ---- 2. Strong sender-based automated families ----
  if (has(/github|notifications@github|github\.com/) && has(/github|pull request|\bpr\b|issue|commit|workflow|action run|mention|review requested|assigned/)) {
    reasons.push("sender/subject matches GitHub notification pattern");
    if (listUnsub) reasons.push("has List-Unsubscribe header");
    return finish("github_notification", listUnsub ? 0.95 : 0.9, reasons);
  }

  if (has(/linkedin|twitter|x\.com|facebook|instagram|tiktok|youtube|reddit|quora|medium\.com|producthunt|dribbble|behance/) &&
      has(/notification|mention|comment|like|follow|connection|invitation|digest|trending|recommended|you have|new follower|tagged/)) {
    reasons.push("sender/subject matches social notification pattern");
    return finish("social_notification", 0.85, reasons);
  }

  if (has(/indeed|linkedin.*job|naukri|glassdoor|monster|ziprecruiter|simplyhired|wellfound|angellist|hired|dice\.com|job\s*alert|new\s*jobs?|hiring/) &&
      has(/job|hiring|opening|role|position|apply|opportunit|alert|new jobs/)) {
    reasons.push("sender/subject matches job alert pattern");
    return finish("job_alert", 0.85, reasons);
  }

  // ---- 3. Newsletter / marketing (List-Unsubscribe is the key signal) ----
  if (
    has(/newsletter|digest|weekly|daily\s*(brief|roundup|update)|unsubscribe/) ||
    (listUnsub.length > 0 && has(/news|blog|update|digest|weekly|monthly|roundup|bulletin|edition/))
  ) {
    if (listUnsub) reasons.push("has List-Unsubscribe header");
    reasons.push("subject/sender matches newsletter pattern");
    return finish("newsletter", listUnsub ? 0.9 : 0.7, reasons);
  }

  if (
    has(/sale|discount|deal|offer|promo|coupon|clearance|limited\s*time|shop\s*now|% off|save\s*\d|marketing|advertisement|buy\s*now|free\s*shipping/) ||
    (precedence === "bulk" && has(/offer|sale|promo|deal|shop|store/))
  ) {
    if (precedence === "bulk") reasons.push("Precedence: bulk");
    if (listUnsub) reasons.push("has List-Unsubscribe header");
    reasons.push("subject/sender matches marketing pattern");
    return finish("marketing", 0.8, reasons);
  }

  // ---- 4. Generic automated signals ----
  const automatedSignals: string[] = [];
  if (has(/no[\s._-]?reply|noreply|donotreply|do-not-reply/)) automatedSignals.push("sender contains noreply/no-reply");
  if (has(/notification|notifier|notify|alerts?@/)) automatedSignals.push("sender contains notification/alert");
  if (has(/mailer|mailing|postmaster|daemon|bounce/)) automatedSignals.push("sender contains mailer/daemon");
  if (autoSubmitted && autoSubmitted !== "no") automatedSignals.push(`Auto-Submitted: ${meta.autoSubmitted}`);
  if (precedence === "bulk" || precedence === "list" || precedence === "junk") automatedSignals.push(`Precedence: ${meta.precedence}`);
  if (listUnsub) automatedSignals.push("has List-Unsubscribe header");

  // Conservative: a single automation signal is ambiguous (seed-prompt test 5).
  // Require two corroborating signals before calling it automated_notification.
  if (automatedSignals.length >= 2) {
    reasons.push(...automatedSignals);
    return finish("automated_notification", 0.8, reasons);
  }
  if (automatedSignals.length === 1) {
    reasons.push(...automatedSignals, "only one automation signal — ambiguous");
    return finish("uncertain", 0.5, reasons);
  }

  // ---- 5. Human vs uncertain ----
  // No automation signals at all + looks like a person writing to you.
  if (!listUnsub && !autoSubmitted && precedence !== "bulk") {
    // Very rough human heuristic: personal phrasing, no bulk markers.
    if (has(/^(re|fwd?):\s?/ ) || has(/\b(hi|hey|hello|thanks|thank you|regards|cheers|let me know|can you|could you|please|attached)\b/)) {
      reasons.push("no automation headers; conversational phrasing");
      return finish("human_personal", 0.65, reasons);
    }
    reasons.push("no automation signals matched; defaulting to uncertain, not human");
    return finish("uncertain", 0.5, reasons);
  }

  reasons.push("no rule matched");
  return finish("uncertain", 0.4, reasons);
}

function finish(
  category: Category,
  confidence: number,
  reasons: string[],
): Classification & { trashCandidate: boolean } {
  return {
    category,
    confidence: Math.min(1, Math.max(0, confidence)),
    reasons,
    trashCandidate: isTrashableCategory(category),
  };
}
