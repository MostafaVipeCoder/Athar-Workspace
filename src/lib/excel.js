import * as XLSX from 'xlsx';

/**
 * Formats any date value from Excel into a 'YYYY-MM-DD' string.
 * Handles: JS Date objects, Excel serial numbers, and existing YYYY-MM-DD strings.
 * @param {Date|number|string} value
 * @returns {string|null}
 */
const formatDateToISO = (value) => {
    if (!value && value !== 0) return null;

    // Case 1: JS Date object (when cellDates:true is used in XLSX.read)
    if (value instanceof Date) {
        if (isNaN(value.getTime())) return null;
        const year = value.getUTCFullYear();
        const month = String(value.getUTCMonth() + 1).padStart(2, '0');
        const day = String(value.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // Case 2: Excel Serial Number as an integer (e.g., 45672)
    if (typeof value === 'number') {
        return convertExcelSerial(value);
    }

    // Case 3: String value
    if (typeof value === 'string') {
        const trimmed = value.trim();

        // Case 3a: Already YYYY-MM-DD format
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
            return trimmed;
        }

        // Case 3b: Numeric string = Excel Serial Number (e.g., "45672")
        if (/^\d+(\.\d+)?$/.test(trimmed)) {
            return convertExcelSerial(parseFloat(trimmed));
        }

        // Case 3c: Human-readable date string (e.g., "January 1, 2026" or "01/01/2026")
        const parsed = new Date(trimmed);
        if (!isNaN(parsed.getTime())) {
            const year = parsed.getFullYear();
            const month = String(parsed.getMonth() + 1).padStart(2, '0');
            const day = String(parsed.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }
    }

    console.warn(`[Excel Parser] Could not parse date value: "${value}" (type: ${typeof value}). Sending as-is.`);
    return String(value);
};

/**
 * Converts an Excel serial date number to a YYYY-MM-DD string.
 * Excel's epoch is January 1, 1900, with a known leap-year bug offset.
 * @param {number} serial
 * @returns {string|null}
 */
const convertExcelSerial = (serial) => {
    if (!serial && serial !== 0) return null;
    // Excel serial 1 = Jan 1, 1900. Unix epoch = Jan 1, 1970.
    // Offset = 25569 days between the two epochs (accounting for Excel's leap year bug).
    const utcMs = (serial - 25569) * 86400 * 1000;
    const date = new Date(utcMs);
    if (isNaN(date.getTime())) return null;
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

/**
 * Generates an Excel template for the agenda.
 * Includes two sheets: "Days" and "Agenda Slots".
 */
export const generateAgendaTemplate = () => {
    // 1. Days Sheet Data
    const daysData = [
        ['Day Name', 'Date (YYYY-MM-DD)'],
        ['Day 1', '2026-01-01']
    ];

    // 2. Agenda Slots Sheet Data
    const slotsData = [
        ['Day Name', 'Slot Title', 'Start Time (HH:mm)', 'End Time (HH:mm)', 'Presenter Name', 'Show Presenter (TRUE/FALSE)'],
        ['Day 1', 'Sample Slot', '09:00', '10:00', 'Presenter Name', 'TRUE']
    ];

    // 3. Experts Sheet Data
    const expertsData = [
        ['Name', 'Title', 'Company', 'Bio', 'LinkedIn URL', 'photo'],
        ['Example Expert', 'CEO', 'Athar', 'A short bio about the expert', 'https://linkedin.com/in/example', 'https://example.com/photo.jpg']
    ];

    // 4. Companies Sheet Data
    const companiesData = [
        ['Company Name', 'Founder', 'Role in the Startup', 'Governorate', 'Industry', 'Logo'],
        ['Example Company', 'Founder Name', 'CEO', 'القاهرة', 'Tech', 'https://example.com/logo.jpg']
    ];

    const wb = XLSX.utils.book_new();

    // Create Sheets
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(daysData), 'Days');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(slotsData), 'Agenda Slots');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(expertsData), 'Experts');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(companiesData), 'Companies');

    // Write file
    XLSX.writeFile(wb, 'Event_Data_Template.xlsx');
};

/**
 * Core parsing logic that converts a Workbook object into structured event data.
 */
export const parseWorkbook = (workbook) => {
    const sheetNames = workbook.SheetNames;
    const findSheet = (name) => {
        const exact = workbook.Sheets[name];
        if (exact) return exact;
        const lowerName = name.toLowerCase().replace(/\s/g, '');
        const found = sheetNames.find(sn => sn.toLowerCase().replace(/\s/g, '') === lowerName);
        return found ? workbook.Sheets[found] : null;
    };

    // Helper to validate columns
    const validateColumns = (sheet, sheetName, required) => {
        const firstRow = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] || [];
        const missing = required.filter(req => {
            const hasExistent = firstRow.some(col => col.toLowerCase().replace(/\s/g, '') === req.toLowerCase().replace(/\s/g, ''));
            return !hasExistent;
        });
        if (missing.length > 0) {
            const err = new Error(`Sheet "${sheetName}" is missing columns: ${missing.join(', ')}`);
            err.type = 'MISSING_COLUMNS';
            err.sheetName = sheetName;
            err.missing = missing;
            err.found = firstRow;
            throw err;
        }
    };

    // Parse Days
    const daysSheet = findSheet('Days');
    const days = [];
    if (daysSheet) {
        validateColumns(daysSheet, 'Days', ['Day Name', 'Date']);
        const daysRaw = XLSX.utils.sheet_to_json(daysSheet);

        const parsedDays = daysRaw.map(row => ({
            day_name: row['Day Name'] || row['Name'] || row['day'],
            day_date: formatDateToISO(row['Date (YYYY-MM-DD)'] || row['Date'] || row['date'])
        })).filter(d => d.day_name && d.day_date);
        
        days.push(...parsedDays);
    }

    // Parse Slots
    const slotsSheet = findSheet('Agenda Slots') || findSheet('Slots') || findSheet('Agenda');
    const slots = [];
    if (slotsSheet) {
        validateColumns(slotsSheet, 'Agenda Slots', ['Day Name', 'Slot Title', 'Start Time', 'End Time']);
        const slotsRaw = XLSX.utils.sheet_to_json(slotsSheet);

        const parsedSlots = slotsRaw.map(row => ({
            day_name: row['Day Name'],
            slot_title: row['Slot Title'] || row['Title'],
            start_time: row['Start Time (HH:mm)'] || row['Start Time'] || row['Start'],
            end_time: row['End Time (HH:mm)'] || row['End Time'] || row['End'],
            presenter_name: row['Presenter Name'] || row['Presenter'] || '',
            show_presenter: String(row['Show Presenter (TRUE/FALSE)'] || row['Show Presenter'] || 'TRUE').toUpperCase() === 'TRUE'
        })).filter(s => s.day_name && s.slot_title);
        
        slots.push(...parsedSlots);
    }

    // Parse Experts
    const expertsSheet = findSheet('Experts');
    let experts = [];
    if (expertsSheet) {
        validateColumns(expertsSheet, 'Experts', ['Name']);
        experts = XLSX.utils.sheet_to_json(expertsSheet).map(row => {
            const rowNormalized = {};
            for (const key in row) {
                if (key) rowNormalized[key.toLowerCase().trim()] = row[key];
            }
            
            const get = (...keys) => {
                for (const k of keys) {
                    const normalizedK = k.toLowerCase().trim();
                    if (rowNormalized[normalizedK] !== undefined && rowNormalized[normalizedK] !== null && String(rowNormalized[normalizedK]).trim() !== '') {
                        return String(rowNormalized[normalizedK]).trim();
                    }
                }
                return '';
            };

            return {
                name: get('Name', 'Full Name', 'الاسم', 'اسم الخبير'),
                title: get('Title', 'Position', 'المسمى الوظيفي', 'التخصص'),
                company: get('Company', 'Working at', 'Organization', 'Work', 'المؤسسة', 'الجهة'),
                location: get('Location', 'City', 'Gov.', 'المقر', 'المدينة', 'المحافظة'),
                bio: get('Bio', 'Description', 'About', 'الوصف', 'نبذة'),
                linkedin_url: get('LinkedIn URL', 'LinkedIn', 'لينكد إن'),
                photo_url: get('photo', 'Photo URL', 'Image', 'الصورة')
            };
        }).filter(e => e.name);
    }

    // Parse Companies
    const companiesSheet = findSheet('Companies') || findSheet('Startups');
    let companies = [];
    if (companiesSheet) {
        validateColumns(companiesSheet, 'Companies', ['Company Name']);
        companies = XLSX.utils.sheet_to_json(companiesSheet).map(row => {
            // Flexible column name matching — covers English, Arabic, typos, and variations
            const rowNormalized = {};
            for (const key in row) {
                if (key) rowNormalized[key.toLowerCase().trim()] = row[key];
            }
            
            const get = (...keys) => {
                for (const k of keys) {
                    const normalizedK = k.toLowerCase().trim();
                    if (rowNormalized[normalizedK] !== undefined && rowNormalized[normalizedK] !== null && String(rowNormalized[normalizedK]).trim() !== '') {
                        return String(rowNormalized[normalizedK]).trim();
                    }
                }
                return '';
            };

            return {
                name: get('Company Name', 'Name', 'Startup Name', 'اسم الشركة', 'الشركة'),
                founder: get('Founder', 'CEO', 'المؤسس'),
                role: get('Role in the Startup', 'Role in Startup', 'Role', 'الدور'),
                location: get('Governorate', 'Gov.', 'Location', 'City', 'المحافظة', 'المدينة'),
                governorate: get('Governorate', 'Gov.', 'Location', 'City', 'المحافظة', 'المدينة'),
                industry: get('Industry', 'Sector', 'القطاع', 'الفئة'),
                description: get('Describtion', 'Description', 'Bio', 'About', 'الوصف', 'وصف الشركة', 'نبذة', 'عن الشركة'),
                website_url: get('Link', 'Links', 'Website', 'URL', 'Website URL', 'الموقع', 'رابط', 'روابط')?.toString() || '',
                // Also store as links array for multi-link support
                links: (() => {
                    const raw = get('Link', 'Links', 'Website', 'URL', 'Website URL', 'الموقع', 'رابط', 'روابط');
                    if (!raw) return [];
                    const rawStr = raw.toString();
                    
                    // Improved splitting: handle spaces, commas, newlines, and semicolons
                    const parts = rawStr.split(/[\s,\n;]+/).map(u => u.trim()).filter(u => u.length > 3 && (u.startsWith('http') || u.includes('.')));
                    
                    return parts.map((url, i) => {
                        let icon = 'globe';
                        let label = i === 0 ? 'Website' : `Link ${i + 1}`;
                        
                        // Clean URL - handle cases where it might not have http
                        const fullUrl = url.startsWith('http') ? url : `https://${url}`;
                        const lowerUrl = fullUrl.toLowerCase();
                        
                        if (lowerUrl.includes('linkedin.com')) { icon = 'linkedin'; label = 'LinkedIn'; }
                        else if (lowerUrl.includes('facebook.com')) { icon = 'facebook'; label = 'Facebook'; }
                        else if (lowerUrl.includes('twitter.com') || lowerUrl.includes('x.com')) { icon = 'twitter'; label = 'Twitter'; }
                        else if (lowerUrl.includes('instagram.com')) { icon = 'instagram'; label = 'Instagram'; }
                        else if (lowerUrl.includes('github.com')) { icon = 'github'; label = 'GitHub'; }
                        else if (lowerUrl.includes('youtube.com')) { icon = 'youtube'; label = 'YouTube'; }
                        
                        return { label, url: fullUrl, icon };
                    });
                })(),
                stage: get('Stage', 'Growth Stage', 'المرحلة').toLowerCase().replace(/\s+/g, '_'),
                logo_url: get('Logo', 'Logo URL', 'لوجو')
            };
        }).filter(c => c.name);
    }

    return { days, slots, experts, companies };
};

/**
 * Parses a workbook generically, returning all sheets and their rows.
 */
export const parseGenericWorkbook = (workbook) => {
    const result = {};
    workbook.SheetNames.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];

        // Get headers in order
        const range = XLSX.utils.decode_range(sheet['!ref']);
        const headers = [];
        for (let C = range.s.c; C <= range.e.c; ++C) {
            const address = XLSX.utils.encode_col(C) + "1";
            if (sheet[address]) headers.push(sheet[address].v);
        }

        const rawRows = XLSX.utils.sheet_to_json(sheet);

        // Process rows to clean bilingual headers (English / Arabic -> English)
        const cleanedRows = rawRows.map(row => {
            const cleanedRow = {};
            Object.keys(row).forEach(key => {
                // Extract English part before /
                const englishKey = key.split('/')[0].trim();
                cleanedRow[englishKey] = row[key];
            });
            return cleanedRow;
        });

        const cleanedHeaders = headers.map(h => h.split('/')[0].trim());

        result[sheetName] = {
            rows: cleanedRows,
            headers: cleanedHeaders
        };
    });
    return result;
};

/**
 * Parses an uploaded Excel file generically.
 */
export const parseGenericExcel = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                resolve(parseGenericWorkbook(workbook));
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = (error) => reject(error);
        reader.readAsArrayBuffer(file);
    });
};

/**
 * Fetches and parses a public Google Sheet generically.
 */
export const fetchAndParseGenericGoogleSheet = async (url) => {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) throw new Error('Invalid Google Sheets URL.');
    const spreadsheetId = match[1];

    const exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`;
    
    try {
        const response = await fetch(exportUrl);

        if (!response.ok) {
            throw new Error('Failed to fetch Google Sheet. Please check if the spreadsheet is private.');
        }

        const buffer = await response.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });

        return parseGenericWorkbook(workbook);
    } catch (err) {
        console.error('Google Sheet fetch error:', err);
        if (err instanceof TypeError || err.message?.includes('Failed to fetch')) {
            throw new Error('فشل جلب ملف Google Sheet. الرابط غير متاح للعامة أو مغلق. يرجى التأكد من تغيير إعدادات المشاركة في جوجل شيت إلى "أي شخص لديه الرابط يمكنه العرض" (Anyone with the link can view).');
        }
        throw err;
    }
};

/**
 * Parses an uploaded Excel file.
 */
export const parseAgendaExcel = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                resolve(parseWorkbook(workbook));
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = (error) => reject(error);
        reader.readAsArrayBuffer(file);
    });
};

/**
 * Fetches and parses a public Google Sheet as an XLSX file.
 */
export const fetchAndParseGoogleSheet = async (url) => {
    // Extract Spreadsheet ID
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) throw new Error('Invalid Google Sheets URL. Please ensure it is a valid /spreadsheets/d/ link.');
    const spreadsheetId = match[1];

    // Fetch XLSX export
    const exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`;
    const response = await fetch(exportUrl);

    if (!response.ok) {
        throw new Error('Failed to fetch Google Sheet. Ensure it is shared as "Anyone with the link can view".');
    }

    const buffer = await response.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });

    return parseWorkbook(workbook);
};
