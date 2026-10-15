export function safeParseServiceAccount(rawKey) {
    if (!rawKey) return null;
    if (typeof rawKey === 'object') return rawKey;
    if (typeof rawKey !== 'string') return null;

    let str = rawKey.trim();

    try {
        const parsed = JSON.parse(str);
        return typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
    } catch {
        // Fallback: repair invalid JSON escape sequences
        // JSON only permits \" \\ \/ \b \f \n \r \t \uXXXX
        // Any other escape like \z or \s causes SyntaxError: Bad escaped character in JSON
        try {
            const sanitized = str.replace(/\\([^"\\\/bfnrtu])/g, '$1');
            const parsed = JSON.parse(sanitized);
            return typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
        } catch (err2) {
            console.error('[Google Sheets] safeParseServiceAccount recovery failed:', err2);
            return null;
        }
    }
}

const badJson = '{"client_email": "test@test.com", "private_key": "abc\\n\\zdef\\spqe"}';
console.log('Parsed recovered badJson:', safeParseServiceAccount(badJson));
