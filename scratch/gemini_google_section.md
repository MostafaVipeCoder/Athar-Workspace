## Google Service Account & Google Sheets — Best Practices & Known Pitfalls

### Root Cause of the Bug
`SyntaxError: Bad escaped character in JSON at position 1032`

This error appears when `service_account_key` stored in the `google_settings` table contains invalid
JSON escape sequences (e.g. `\z`, `\s`). This commonly happens when the Service Account JSON is
manually copy-pasted into a TEXT field without preserving the original formatting.

JSON spec only allows: `\" \\ \/ \b \f \n \r \t \uXXXX`. Any other escape like `\z` causes `SyntaxError`.

### Applied Fix (3-layer defense)

1. **Repair existing DB data**: Re-parse the valid row and re-save using
   `JSON.stringify(JSON.parse(existingKey))` to normalize any broken escapes.

2. **`safeParseServiceAccount()` in `src/lib/googleSheets.js`**: Tries `JSON.parse` first.
   On failure, strips invalid escape sequences via `/\\([^"\\\/bfnrtu])/g` regex fallback,
   then retries. Never throws — returns `null` on total failure.

3. **Sanitize before DB write in `EventDashboard.jsx`**: Before upsert to `google_settings`,
   runs `JSON.stringify(JSON.parse(input))` on the key to strip formatting and fix escapes.

### Diagnosing `invalid_grant: Invalid JWT Signature`
This is a DIFFERENT error — unrelated to JSON parsing:
- Happens when the Service Account key has been DELETED or REVOKED in Google Cloud Console.
- Verify by comparing `private_key_id` in DB against active keys:
  `GET https://www.googleapis.com/robot/v1/metadata/x509/{client_email}`
- If `private_key_id` is NOT in the returned object → key is expired/deleted → generate a new key.

### Rules to Avoid These Issues in the Future

**1. Store Service Account keys as JSONB not TEXT:**
```sql
ALTER TABLE google_settings ALTER COLUMN service_account_key TYPE JSONB
USING service_account_key::jsonb;
```
Supabase will reject malformed JSON before it ever reaches the table.

**2. Always normalize key before saving from UI:**
```js
const cleanKey = JSON.stringify(JSON.parse(rawPastedText));
```

**3. Always use `safeParseServiceAccount()` (googleSheets.js) when reading the key.**
Validate `private_key` and `client_email` exist before attempting JWT signing.

**4. Quick error triage for Google OAuth:**
| Error | Cause |
|---|---|
| `SyntaxError: Bad escaped character` | Broken JSON in DB — Google not involved |
| `Invalid JWT Signature` / `java.security.SignatureException` | Key revoked/deleted on Google Cloud |
| `Invalid grant` (no signature mention) | Wrong permissions or Domain-Wide Delegation issue |
| `unauthorized_client` | Service account not added to Google Workspace admin |

**5. When using `crypto.subtle.importKey` with PEM private keys (Web Crypto API):**
Normalize BEFORE calling `atob()`:
```js
const cleanPem = pem
  .replace(/-----BEGIN PRIVATE KEY-----/g, '')
  .replace(/-----END PRIVATE KEY-----/g, '')
  .replace(/\\n/g, '')       // escaped literal \n from JSON string
  .replace(/[\r\n\s]+/g, ''); // real whitespace
```
Failing to strip `\\n` (escaped newline from JSON) causes `atob()` to throw a `DOMException`
because base64 cannot contain backslash characters.
