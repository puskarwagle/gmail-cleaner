Build a TypeScript CLI called `gmail-cleaner` that connects to my personal Gmail account using the official Gmail API.

Goal:

I want to identify automated emails in my Inbox and eventually move them to Gmail Trash.

IMPORTANT SAFETY REQUIREMENTS:

1. NEVER permanently delete emails.
2. Use the Gmail API `gmail.modify` OAuth scope.
3. Moving emails to Trash is allowed.
4. Do NOT send emails.
5. Do NOT modify Gmail filters/settings.
6. Do NOT unsubscribe from anything yet.
7. The first operation must always be a dry-run/report.
8. Never automatically trash anything without an explicit `trash` command.
9. Never commit `credentials.json`, `token.json`, `.env`, or OAuth secrets.
10. Add confirmation before trashing.
11. Before trashing, display the number of messages and representative examples.
12. Keep an audit log containing message IDs, sender, subject, classification, and timestamp.

TECH STACK:

* TypeScript
* Bun runtime only (never npm/node/npx — `bun install`, `bun run dev -- …`, `bun test`, `bunx tsc --noEmit`)
* `googleapis`
* `@google-cloud/local-auth`
* Gmail API
* CLI interface today, structured so a web/mobile UI can reuse the core later
  (pure `src/core/` logic + `src/gmail/` data functions; thin `src/cli/` presentation)

AUTH:

Implement OAuth authentication using Google's installed/desktop application flow.

Use:

`https://www.googleapis.com/auth/gmail.modify`

Store the OAuth token locally in `token.json`.

The Google Cloud OAuth credentials should be loaded from:

`credentials.json`

GMAIL SCANNING:

Only scan messages currently in the Inbox.

Use Gmail API pagination correctly.

For each message retrieve enough metadata to classify it:

* From
* To
* Subject
* Date
* Message-ID
* List-Unsubscribe
* Precedence
* Auto-Submitted
* Reply-To
* Sender
* snippet

Do not unnecessarily download attachments.

CLASSIFICATION:

Create a deterministic classifier first.

Possible categories:

* automated_notification
* newsletter
* marketing
* job_alert
* github_notification
* social_notification
* receipt
* account_security
* human_personal
* uncertain

The classifier should return:

{
category,
confidence,
reasons[]
}

Examples of strong automated indicators:

* sender contains `no-reply`
* sender contains `noreply`
* sender contains `notifications`
* sender contains `mailer`
* `Auto-Submitted` header exists
* `Precedence: bulk`
* `List-Unsubscribe` header exists
* recurring notification-style subjects
* obvious GitHub/LinkedIn/Indeed/etc. notification senders

IMPORTANT:

Do NOT classify an email as trashable merely because it is automated.

For example:

* bank security alert → account_security
* password reset → account_security
* login alert → account_security
* 2FA/security code → account_security
* payment receipt → receipt
* personal email from a human → human_personal

Create a separate boolean:

`trashCandidate`

Only set it to true for clearly disposable categories.

Never make `account_security`, `human_personal`, or `uncertain` trash candidates.

CLI:

`bun run dev -- scan`

Scans the Inbox and creates:

`reports/latest.json`

Also print a readable summary such as:

Inbox scanned: 4,821

Automated:
GitHub notifications: 421
newsletters: 312
marketing: 205
job alerts: 87
social notifications: 64

Protected:
account/security: 23
receipts: 91
personal/human: 143
uncertain: 31

Potentially disposable: 1,089

Then show representative examples.

Add:

`npm run dev -- report`

Reads the latest report and displays the proposed actions.

Add:

`npm run dev -- trash`

Requirements:

* Require an existing report.
* Refuse to operate on an old report unless explicitly overridden.
* Show exactly how many messages will be moved.
* Show representative senders and subjects.
* Ask:

`Move these messages to Gmail Trash? Type YES to continue:`

Only proceed if the user types exactly `YES`.

Move messages to Trash using the Gmail API.

Never use Gmail's permanent deletion operation.

Afterward produce:

`reports/trash-YYYY-MM-DD-HH-mm.json`

containing every affected message ID and result.

Add:

`npm run dev -- undo`

This should NOT permanently restore arbitrary messages.

Instead, use the saved audit information to restore messages from Trash back to Inbox where possible.

Also support:

`--limit`

for testing.

Example:

`npm run dev -- scan --limit 100`

so I can test against 100 emails first.

TESTING:

Create unit tests for the classifier using fake Gmail headers.

Include tests for:

1. GitHub notification → github_notification / trash candidate
2. newsletter with List-Unsubscribe → newsletter / trash candidate
3. noreply security alert → account_security / NOT trash candidate
4. human email → human_personal / NOT trash candidate
5. ambiguous notification → uncertain / NOT trash candidate
6. receipt → receipt / NOT trash candidate

SECURITY:

`.gitignore` must contain:

credentials.json
token.json
.env
reports/

Do not print OAuth tokens.

Do not log message bodies.

Prefer headers/snippets for classification.

DOCUMENTATION:

Create a README explaining:

1. How to create a Google Cloud project
2. How to enable Gmail API
3. How to configure OAuth
4. Where to download `credentials.json`
5. How to run the first authentication
6. How dry-run works
7. How trashing works
8. How to revoke access
9. Security considerations

Do not add any functionality beyond the above without asking me first.
