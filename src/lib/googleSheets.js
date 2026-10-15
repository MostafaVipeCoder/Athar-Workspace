import { supabase } from './supabase';

/**
 * Extracts the spreadsheet ID from any standard Google Sheets URL.
 * @param {string} url 
 * @returns {string|null}
 */
export const extractSpreadsheetId = (url) => {
    if (!url || typeof url !== 'string') return null;
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
};

/**
 * Safely parses Google Service Account credentials.
 * Handles malformed JSON strings, invalid JSON escapes (e.g. \z, \s),
 * double-stringified JSON, and raw objects.
 */
export function safeParseServiceAccount(rawKey) {
    if (!rawKey) return null;
    if (typeof rawKey === 'object') return rawKey;
    if (typeof rawKey !== 'string') return null;

    const str = rawKey.trim();

    try {
        const parsed = JSON.parse(str);
        return typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
    } catch {
        // Fallback: repair invalid JSON escape sequences
        // JSON specification only permits \" \\ \/ \b \f \n \r \t \uXXXX
        // Stripping stray backslashes recovers malformed PEM/escape strings
        try {
            const sanitized = str.replace(/\\([^"\\/bfnrtu])/g, '$1');
            const parsed = JSON.parse(sanitized);
            return typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
        } catch (recoveryError) {
            console.error('[Google Sheets] Failed to parse service account key:', recoveryError);
            return null;
        }
    }
}

/**
 * Converts PEM private key to CryptoKey via Web Crypto API.
 */
async function importPrivateKey(pem) {
    // Normalizes both escaped \\n and raw newlines from PEM format
    const cleanPem = pem
        .replace(/-----BEGIN PRIVATE KEY-----/g, '')
        .replace(/-----END PRIVATE KEY-----/g, '')
        .replace(/\\n/g, '')
        .replace(/[\r\n\s]+/g, '');

    const binaryDer = atob(cleanPem);
    const bytes = new Uint8Array(binaryDer.length);
    for (let i = 0; i < binaryDer.length; i++) {
        bytes[i] = binaryDer.charCodeAt(i);
    }

    return await crypto.subtle.importKey(
        'pkcs8',
        bytes.buffer,
        {
            name: 'RSASSA-PKCS1-v1_5',
            hash: { name: 'SHA-256' },
        },
        false,
        ['sign']
    );
}

function base64urlEncode(data) {
    let base64;
    if (typeof data === 'string') {
        base64 = btoa(unescape(encodeURIComponent(data)));
    } else {
        const bytes = new Uint8Array(data);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        base64 = btoa(binary);
    }
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Obtains a Google OAuth2 access token using service account credentials from google_settings.
 */
export async function getGoogleSheetsAccessToken(eventId = null) {
    try {
        let query = supabase.from('google_settings').select('*');
        if (eventId) {
            query = query.or(`event_id.eq.${eventId},event_id.is.null`).order('event_id', { ascending: false });
        } else {
            query = query.is('event_id', null);
        }

        const { data, error } = await query.limit(1).single();
        if (error || !data?.service_account_key) {
            console.warn('[Google Sheets] No service account key found in google_settings');
            return null;
        }

        const creds = safeParseServiceAccount(data.service_account_key);
        if (!creds?.client_email || !creds?.private_key) {
            console.warn('[Google Sheets] Invalid service account format');
            return null;
        }

        const now = Math.floor(Date.now() / 1000);
        const header = { alg: 'RS256', typ: 'JWT' };
        const claim = {
            iss: creds.client_email,
            scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive',
            aud: 'https://oauth2.googleapis.com/token',
            exp: now + 3600,
            iat: now
        };

        if (data.impersonate_email) {
            claim.sub = data.impersonate_email;
        }

        const encodedHeader = base64urlEncode(JSON.stringify(header));
        const encodedClaim = base64urlEncode(JSON.stringify(claim));
        const toSign = `${encodedHeader}.${encodedClaim}`;

        const cryptoKey = await importPrivateKey(creds.private_key);
        const signature = await crypto.subtle.sign(
            'RSASSA-PKCS1-v1_5',
            cryptoKey,
            new TextEncoder().encode(toSign)
        );

        const jwt = `${toSign}.${base64urlEncode(signature)}`;

        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                assertion: jwt
            })
        });

        const tokenData = await tokenRes.json();
        if (tokenData.access_token) {
            return tokenData.access_token;
        }

        console.error('[Google Sheets] Token request failed:', tokenData);
        return null;
    } catch (err) {
        console.error('[Google Sheets] Error getting access token:', err);
        return null;
    }
}

/**
 * Asynchronously appends a submitted response as a new row to a Google Sheet.
 * Non-blocking: errors are logged and will not interrupt the user experience.
 */
export async function appendFormResponseToSheet({
    sheetUrl,
    eventId,
    formName,
    fields = [],
    answers = {},
    source = 'direct',
    submittedAt = new Date().toISOString()
}) {
    const spreadsheetId = extractSpreadsheetId(sheetUrl);
    if (!spreadsheetId) {
        console.warn('[Google Sheets] Invalid Google Sheets URL:', sheetUrl);
        return { success: false, reason: 'invalid_url' };
    }

    try {
        const token = await getGoogleSheetsAccessToken(eventId);
        if (!token) {
            console.warn('[Google Sheets] Unable to authenticate with Google Sheets API');
            return { success: false, reason: 'no_token' };
        }

        const rowValues = [
            new Date(submittedAt).toLocaleString('en-US'),
            source
        ];

        if (fields.length > 0) {
            fields.forEach(f => {
                const val = answers[f.field_name];
                if (val === undefined || val === null) {
                    rowValues.push('');
                } else if (typeof val === 'object') {
                    rowValues.push(JSON.stringify(val));
                } else {
                    rowValues.push(String(val));
                }
            });
        } else {
            Object.keys(answers).forEach(key => {
                const val = answers[key];
                rowValues.push(typeof val === 'object' ? JSON.stringify(val) : String(val ?? ''));
            });
        }

        const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
        const res = await fetch(appendUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                values: [rowValues]
            })
        });

        const resData = await res.json();
        if (!res.ok) {
            console.error('[Google Sheets API Error]:', resData);
            return { success: false, error: resData };
        }

        console.log('[Google Sheets] Successfully appended row:', resData?.updates?.updatedRange);
        return { success: true, data: resData };
    } catch (e) {
        console.error('[Google Sheets] Background append exception:', e);
        return { success: false, error: e.message };
    }
}
