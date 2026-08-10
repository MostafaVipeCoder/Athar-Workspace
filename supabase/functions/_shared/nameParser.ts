/**
 * Smart compound name parser for Arabic/English names.
 *
 * Recognises compound prefixes (e.g. "Abd Al", "Nour El", "عبد ال", "نور ال")
 * and returns the meaningful "given name" portion of a full name for use in
 * email greetings – without naïvely picking word[0] + word[last].
 *
 * Rules:
 *   1. Normalise whitespace.
 *   2. Walk through words, greedily consuming compound-prefix spans.
 *   3. Accumulate until we have consumed exactly 2 "logical name units"
 *      (where a compound like [Abd Al Rahman] counts as ONE unit).
 *   4. Return those 2 units joined; if fewer than 2 units exist, return all.
 */

// ---------------------------------------------------------------------------
// Configuration – extend this list to support more compound patterns
// ---------------------------------------------------------------------------

/**
 * Each sub-array is an ordered sequence of lowercase tokens that, when found
 * consecutively at the START of a logical name unit, indicate that the NEXT
 * word is also part of the same unit.
 *
 * e.g. ["abd", "al"] means: if the current word is "abd" and the next is "al",
 * then the word AFTER "al" still belongs to this unit.
 */
const COMPOUND_PREFIXES: string[][] = [
  // English / Latin transliterations
  ["abd", "al"],
  ["abd", "el"],
  ["abd", "ul"],
  ["abdu", "l"],       // Abdul (split form)
  ["abu"],             // Abu Bakr
  ["ibn"],             // Ibn Khaldun
  ["bint"],
  ["noor", "el"],
  ["noor", "al"],
  ["nour", "el"],
  ["nour", "al"],
  ["nur", "el"],
  ["nur", "al"],
  ["ala", "el"],
  ["ala", "al"],
  ["ala", "ud"],
  ["seif", "el"],
  ["seif", "al"],
  ["seyf", "el"],
  ["seyf", "al"],
  ["sayf", "el"],
  ["sayf", "al"],
  ["badr", "el"],
  ["badr", "al"],
  ["amal", "el"],
  ["amal", "al"],
  ["jamal", "el"],
  ["jamal", "al"],
  ["kamal", "el"],
  ["kamal", "al"],
  ["wael", "el"],
  ["waely"],
  ["abd"],             // General "Abd" prefix that may precede "Al-X"
  ["um"],              // Um Kulthum etc.
  ["umm"],

  // Arabic prefixes (these appear inside Arabic-script names)
  // We match after lowercasing unicode; Arabic chars are not lowercased but
  // we still include them here for structural consistency.
  ["عبد", "ال"],
  ["عبد"],             // عبد alone (عبد الرحمن written as two words)
  ["أبو"],
  ["ابن"],
  ["بنت"],
  ["نور", "ال"],
  ["نور"],
  ["نورا"],
  ["سيف", "ال"],
  ["بدر", "ال"],
  ["أمل", "ال"],
  ["جمال", "ال"],
  ["كمال", "ال"],
  ["ال"],              // generic Arabic definite article prefix word
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True if the string contains any Arabic / Arabic-Extended character. */
function isArabic(str: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(str);
}

/**
 * Given the current position in the words array, return how many additional
 * words (after `startIdx`) belong to the SAME logical name unit because of a
 * compound prefix starting at `startIdx`.
 *
 * Returns 0 if no compound pattern matches → caller should treat word[startIdx]
 * as a standalone unit of length 1.
 */
function compoundExtraWords(words: string[], startIdx: number): number {
  const word0 = words[startIdx]?.toLowerCase() ?? "";

  for (const pattern of COMPOUND_PREFIXES) {
    // Pattern length 1: ["abd"] etc. – means the NEXT word is part of this unit.
    // Pattern length 2: ["abd", "al"] – means the word at idx+1 is "al" and
    //   the word at idx+2 is the completion of the unit.

    if (pattern.length === 0) continue;

    if (word0 !== pattern[0]) continue;

    if (pattern.length === 1) {
      // e.g. ["abd"] – next word completes the unit (Abd Rahman → 2 extra words)
      // But only consume the extra word if it exists.
      if (startIdx + 1 < words.length) {
        return 1; // consume 1 extra word
      }
      return 0;
    }

    if (pattern.length === 2) {
      const word1 = words[startIdx + 1]?.toLowerCase() ?? "";
      if (word1 === pattern[1]) {
        // e.g. ["abd", "al"] matched → consume "al" + 1 more word (the name)
        if (startIdx + 2 < words.length) {
          return 2; // consume 2 extra words
        }
        // "al" is at idx+1 but nothing follows → consume just "al"
        return 1;
      }
    }
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the recipient display name to use inside an email greeting.
 *
 * Strategy:
 *   - Normalise whitespace.
 *   - Walk through words building "logical units" (respecting compound names).
 *   - Return the first TWO logical units (or fewer if the name is short).
 *
 * Examples:
 *   "Ahmed Mohamed Ali Hassan"      → "Ahmed Mohamed"
 *   "Abd Al Rahman Ahmed Mohamed"   → "Abd Al Rahman"
 *   "Abd El Rahman Ahmed"           → "Abd El Rahman"
 *   "Mohamed Abd El Rahman Ali"     → "Mohamed Abd El Rahman"
 *   "Abdul Rahman Ahmed Ali"        → "Abdul Rahman"   (single-word "Abdul" prefix)
 *   "Noor El Hoda Ahmed Mohamed"    → "Noor El Hoda"
 *   "محمد عبد الرحمن علي حسن"     → "محمد عبد الرحمن"
 *   "نور الهدى أحمد محمد"          → "نور الهدى"
 *   "Ahmed Ali"                     → "Ahmed Ali"
 *   "Ahmed"                         → "Ahmed"
 *   null / ""                       → ""  (caller should use fallback)
 */
export function getRecipientDisplayName(fullName: string | null | undefined): string {
  if (!fullName || typeof fullName !== "string") return "";

  // 1. Normalise whitespace
  const normalised = fullName.replace(/\s+/g, " ").trim();
  if (!normalised) return "";

  const words = normalised.split(" ");
  if (words.length === 1) return words[0];

  // 2. Walk and build logical units, tracking raw-word counts per unit
  const units: string[] = [];
  const unitWordCounts: number[] = []; // how many raw words each unit spans
  let i = 0;

  while (i < words.length) {
    const extraCount = compoundExtraWords(words, i);
    const unitWords = words.slice(i, i + 1 + extraCount);
    units.push(unitWords.join(" "));
    unitWordCounts.push(1 + extraCount);
    i += 1 + extraCount;

    // Stop once we have 2 logical units – we don't need more
    if (units.length === 2) break;
  }

  // 3. If the first unit is compound (spans >1 raw word), it IS the full
  //    given name – return it alone. Otherwise return both units
  //    (e.g. "Ahmed Ali" for a simple two-word name).
  if (unitWordCounts[0] > 1) {
    return units[0];
  }
  return units.join(" ");
}


/**
 * Convenience: always returns a non-empty string.
 * Falls back to `fallback` (e.g. company name) if name is empty.
 */
export function getRecipientDisplayNameWithFallback(
  fullName: string | null | undefined,
  fallback: string
): string {
  const result = getRecipientDisplayName(fullName);
  return result || fallback;
}

// ---------------------------------------------------------------------------
// Unit Tests (run via: deno test supabase/functions/_shared/nameParser.ts)
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const cases: Array<{ input: string | null | undefined; expected: string }> = [
    { input: "Ahmed Mohamed Ali Hassan",     expected: "Ahmed Mohamed" },
    { input: "Abd Al Rahman Ahmed Mohamed",  expected: "Abd Al Rahman" },
    { input: "Abd El Rahman Ahmed Mohamed",  expected: "Abd El Rahman" },
    { input: "Mohamed Abd El Rahman Ali Hassan", expected: "Mohamed Abd El Rahman" },
    { input: "Abdul Rahman Ahmed Ali",       expected: "Abdul Rahman" },
    { input: "Noor El Hoda Ahmed Mohamed",   expected: "Noor El Hoda" },
    { input: "Nur Al Huda Ahmed",            expected: "Nur Al Huda" },
    { input: "Abu Bakr Ahmed Mohamed",       expected: "Abu Bakr" },
    { input: "محمد عبد الرحمن علي حسن",     expected: "محمد عبد الرحمن" },
    { input: "نور الهدى أحمد محمد",          expected: "نور الهدى" },
    { input: "عبد الرحمن أحمد محمد",         expected: "عبد الرحمن" },
    { input: "Ahmed Ali",                    expected: "Ahmed Ali" },
    { input: "Ahmed",                        expected: "Ahmed" },
    { input: "  Abd   Al   Rahman  Ahmed  ", expected: "Abd Al Rahman" },
    { input: null,                           expected: "" },
    { input: undefined,                      expected: "" },
    { input: "",                             expected: "" },
    { input: "   ",                          expected: "" },
  ];

  let passed = 0;
  let failed = 0;

  for (const { input, expected } of cases) {
    const result = getRecipientDisplayName(input);
    const ok = result === expected;
    if (ok) {
      passed++;
      console.log(`✅  "${input}" → "${result}"`);
    } else {
      failed++;
      console.error(`❌  "${input}" → got "${result}", expected "${expected}"`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) Deno.exit(1);
}
