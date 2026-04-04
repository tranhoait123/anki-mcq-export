/**
 * Normalizes MCQ text (questions, options, or answers) for comparison.
 * - Removes leading labels (A., B), (C), 1., etc.)
 * - Lowercases and trims whitespace.
 * - Removes trailing punctuation.
 */
export const normalizeMCQText = (text: string): string => {
  if (!text) return "";
  
  return text
    .trim()
    // 1. Remove common prefixes: "A. ", "A) ", "A- ", "A: ", "(A) ", "1. ", "1) "
    // Supports up to 2 characters for numbering (e.g., "10. ")
    .replace(/^(\(?[A-Za-z0-9]{1,2}[.\s\)\-\:]+)\s*/i, "")
    // 2. Lowercase for case-insensitive comparison
    .toLowerCase()
    // 3. Remove trailing dots/commas/semicolons
    .replace(/[.,;:]+$/, "")
    // 4. Normalize internal whitespace (convert all to single space)
    .replace(/\s+/g, " ")
    .trim();
};

/**
 * Robust comparison to determine if an option matches the correct answer.
 * @param option The option text (e.g., "A. Toxoplasmosis")
 * @param correctAnswer The correct answer text/letter (e.g., "A" or "Toxoplasmosis")
 * @param index The 0-based index of the option (0 for A, 1 for B, etc.)
 */
export const isOptionCorrect = (option: string, correctAnswer: string, index: number): boolean => {
  if (!correctAnswer) return false;

  const normalizedOpt = normalizeMCQText(option);
  const normalizedCorrect = normalizeMCQText(correctAnswer);

  // 1. Literal normalized match (e.g., "toxoplasmosis" === "toxoplasmosis")
  if (normalizedOpt === normalizedCorrect) return true;

  // 2. Letter match: if correctAnswer is JUST the letter (e.g., "A", "b", "C.")
  // We check if the normalized correct answer is a single letter matching the index.
  const letters = ['a', 'b', 'c', 'd', 'e'];
  const correctLetter = correctAnswer.trim().toLowerCase().replace(/[^a-z]/g, '');
  if (correctLetter.length === 1 && correctLetter === letters[index]) {
    return true;
  }

  // 3. Prefix match: if correctAnswer starts with "A. " and option matches the rest
  // This is handled by normalizeMCQText because it strips the prefix from both.
  
  // 4. Fallback: Check if the original correct answer string contains the index letter 
  // as its first non-whitespace character.
  const firstChar = correctAnswer.trim().charAt(0).toLowerCase();
  if (firstChar === letters[index] && (correctAnswer.trim().length === 1 || /^[a-e][.\)\-\:\s]/.test(correctAnswer.trim().toLowerCase()))) {
    // If it's just "A" or "A. something", and we are at index 0, it's a match.
    // BUT we need to be careful not to match "Aspirin" with index 0 (A).
    // The regex above [a-e][.\)\-\:\s] ensures there's a separator.
    return true;
  }

  return false;
};
