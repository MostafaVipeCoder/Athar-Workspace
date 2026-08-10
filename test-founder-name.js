
// Test script for extractSmartFirstName function

const extractSmartFirstName = (fullName) => {
    if (!fullName) return 'Founder';
    
    // Trim and normalize whitespace
    const normalizedName = fullName.trim().replace(/\s+/g, ' ');
    
    // Split into words
    const words = normalizedName.split(' ');
    const firstWord = words[0]?.toLowerCase() || '';
    
    // List of exact prefixes (when written as separate first word)
    const separateAbdPrefixes = ['abd', 'abdul', 'abdel', 'abdu'];
    
    // Check if first word is exactly one of the separate prefixes
    const isSeparatePrefix = separateAbdPrefixes.includes(firstWord);
    
    if (isSeparatePrefix && words.length >= 2) {
        // Case: "Abdul Rahman" → take first two words
        return `${words[0]} ${words[1]}`;
    }
    
    // List of prefixes to check for combined names
    const combinedAbdPrefixes = ['abd', 'abdul', 'abdel', 'abdu', 'abdullah', 'abdulrahman', 'abdelaziz'];
    const hasCombinedAbdPrefix = combinedAbdPrefixes.some(prefix => firstWord.startsWith(prefix));
    
    if (hasCombinedAbdPrefix) {
        // Case: "Abdulrahman" or "Abdullah" → take first word only
        return words[0];
    }
    
    // For regular names, take just the first word
    return words[0] || 'Founder';
};

// Test cases
const testCases = [
    { input: "John Doe", expected: "John" },
    { input: "Jane Smith", expected: "Jane" },
    { input: "mostafa shaban", expected: "mostafa" },
    { input: "Mostafa Shaban", expected: "Mostafa" },
    { input: "Abdul Rahman", expected: "Abdul Rahman" },
    { input: "Abd Allah", expected: "Abd Allah" },
    { input: "Abdel Aziz", expected: "Abdel Aziz" },
    { input: "Abdu Allah", expected: "Abdu Allah" },
    { input: "Abdulrahman Ali", expected: "Abdulrahman" },
    { input: "Abdallah Hassan", expected: "Abdallah" },
    { input: "Abdelaziz Mohamed", expected: "Abdelaziz" },
    { input: "abdul rahman", expected: "abdul rahman" },
    { input: "ABDEL AZIZ", expected: "ABDEL AZIZ" },
    { input: "Mohamed", expected: "Mohamed" },
    { input: "Abdullah", expected: "Abdullah" },
    { input: "", expected: "Founder" },
    { input: null, expected: "Founder" },
    { input: "  Ali  Hassan  ", expected: "Ali" },
];

// Run tests
console.log("Testing extractSmartFirstName function:\n");
let allPassed = true;

testCases.forEach((test, index) => {
    const result = extractSmartFirstName(test.input);
    const passed = result === test.expected;
    allPassed = allPassed && passed;
    
    console.log(`Test ${index + 1}:`);
    console.log(`  Input:    ${JSON.stringify(test.input)}`);
    console.log(`  Expected: ${JSON.stringify(test.expected)}`);
    console.log(`  Got:      ${JSON.stringify(result)}`);
    console.log(`  ${passed ? "✅ PASS" : "❌ FAIL"}\n`);
});

console.log(allPassed ? "✅ All tests passed!" : "❌ Some tests failed!");
