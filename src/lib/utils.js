export const formatDate = (dateString, options = {}) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const locale = options.locale || 'en-US';
    
    return date.toLocaleDateString(locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        ...options
    });
};

export const formatTime = (input, lang = 'en') => {
    if (!input) return '';

    const isAr = lang === 'ar';
    const amLabel = isAr ? 'ص' : 'AM';
    const pmLabel = isAr ? 'م' : 'PM';

    // Handle potential numeric input (Excel time as fraction of day)
    if (typeof input === 'number') {
        const totalMinutes = Math.round(input * 24 * 60);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const h12 = hours % 12 || 12;
        const ampm = hours >= 12 ? pmLabel : amLabel;
        return `${h12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
    }

    // Case 1: Simple "HH:mm" or "HH:mm:ss" string (e.g. from manual input or simple API)
    if (typeof input === 'string' && input.match(/^\d{1,2}:\d{2}(:\d{2})?$/)) {
        const [hours, minutes] = input.split(':');
        const h = parseInt(hours, 10);
        const ampm = h >= 12 ? pmLabel : amLabel;
        const h12 = h % 12 || 12;
        return `${h12}:${minutes} ${ampm}`;
    }

    // Case 2: Full Date string (ISO) or Date object
    const date = new Date(input);
    if (!isNaN(date.getTime())) {
        return date.toLocaleTimeString(isAr ? 'ar-EG' : 'en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    }

    // Fallback: return as is if parsing fails
    return input;
};

/**
 * Extracts Google Drive file ID from any Google Drive URL format.
 * Returns null if the URL is not a Google Drive link or ID can't be extracted.
 */
export const extractGoogleDriveId = (url) => {
    if (!url) return null;
    
    // If it's just an ID-like string (e.g. 1-XyZb_...)
    if (url.match(/^[-\w]{25,50}$/)) return url;

    // Standard patterns
    const patterns = [
        /\/file\/d\/([-\w]{25,})/,
        /\/d\/([-\w]{25,})/,
        /googleusercontent\.com\/d\/([-\w]{25,})/,
        /drive\.usercontent\.google\.com\/download.*[?&]id=([-\w]{25,})/,
        /[?&]id=([-\w]{25,})/,
        /uc\?id=([-\w]{25,})/,
        /open\?id=([-\w]{25,})/,
        /drive\.google\.com\/uc\?export=view&id=([-\w]{25,})/
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match?.[1]) return match[1];
    }

    // Try a more aggressive search for anything looking like a Drive ID if it's a Drive URL
    if (
        url.includes('drive.google.com') ||
        url.includes('docs.google.com') ||
        url.includes('googleusercontent.com') ||
        url.includes('drive.usercontent.google.com')
    ) {
        const parts = url.split(/[/?&=]/);
        const likelyId = parts.find(part => part.match(/^[-\w]{25,50}$/));
        if (likelyId) return likelyId;
    }

    return null;
};

/**
 * Returns an array of potential direct link formats for a Google Drive ID.
 * Ordered by reliability (lh3 is best for no-consent/large files).
 */
export const getGoogleDriveFallbackUrls = (url) => {
    if (!url) return [];
    
    const isGoogleDriveLikeUrl =
        url.includes('drive.google.com') ||
        url.includes('docs.google.com') ||
        url.includes('googleusercontent.com') ||
        url.includes('drive.usercontent.google.com') ||
        url.match(/^[-\w]{25,50}$/);

    // If it's already a non-Google direct URL, just return it
    if (!isGoogleDriveLikeUrl) {
        return [url];
    }

    const id = extractGoogleDriveId(url);
    if (!id) return [url];

    // Priority order (trimmed to 4 best — reduces network spam for restricted files):
    // 1. lh3 CDN at 400px — fastest, no consent page for shared files
    // 2. lh3 CDN at 200px — smaller size fallback
    // 3. drive.google.com thumbnail API — proxy-based, reliable
    // 4. drive.usercontent.com — newer Google CDN subdomain
    return [
        `https://lh3.googleusercontent.com/d/${id}=s400`,              // CDN 400px
        `https://lh3.googleusercontent.com/d/${id}=s200`,              // CDN 200px
        `https://drive.google.com/thumbnail?id=${id}&sz=w400`,         // Thumbnail API
        `https://drive.usercontent.com/download?id=${id}`,             // UserContent CDN
    ];
};

/**
 * Returns a high-quality direct URL for full-size images (backgrounds, headers, covers).
 * Separate from getGoogleDriveFallbackUrls which is optimized for small logos.
 */
export const getGoogleDriveFullSizeUrls = (url) => {
    if (!url) return [];
    
    const isGoogleDriveLikeUrl =
        url.includes('drive.google.com') ||
        url.includes('docs.google.com') ||
        url.includes('googleusercontent.com') ||
        url.includes('drive.usercontent.google.com') ||
        url.match(/^[-\w]{25,50}$/);

    // If it's already a non-Google direct URL, just return it
    if (!isGoogleDriveLikeUrl) {
        return [url];
    }

    const id = extractGoogleDriveId(url);
    if (!id) return [url];

    return [
        `https://drive.google.com/thumbnail?id=${id}&sz=w1600`,        // Large thumbnail - no consent page
        `https://lh3.googleusercontent.com/d/${id}=w1600`,             // CDN large
        `https://lh3.googleusercontent.com/d/${id}`,                   // CDN original
        `https://drive.google.com/uc?export=view&id=${id}`,            // Classic full export
    ];
};


/**
 * Converts a Google Drive sharing URL to a direct image URL.
 * Uses full-size format suitable for backgrounds, headers, and cover images.
 */
export const getGoogleDriveDirectLink = (url) => {
    const fallbacks = getGoogleDriveFullSizeUrls(url);
    return fallbacks.length > 0 ? fallbacks[0] : url;
};

export const exportToCSV = (data, filename = 'export.csv') => {
    if (!data || !data.length) return;

    // Get headers from first object
    const headers = Object.keys(data[0]);

    // Create CSV content
    const csvContent = [
        headers.join(','),
        ...data.map(row => headers.map(header => {
            const cell = row[header] === null || row[header] === undefined ? '' : row[header];
            // Escape quotes and wrap in quotes if contains comma or newline
            const escaped = ('' + cell).replace(/"/g, '""');
            return `"${escaped}"`;
        }).join(','))
    ].join('\n');

    // Add BOM for Excel UTF-8 support
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');

    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
};
