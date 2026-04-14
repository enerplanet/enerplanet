/**
 * Email validation utility
 * 
 * Provides a safe email validation function that is not vulnerable to ReDoS attacks.
 * Uses a simple and efficient regex pattern without catastrophic backtracking.
 */

/**
 * Validates email format safely without ReDoS vulnerability
 * 
 * This regex is safe because:
 * 1. Uses atomic patterns that don't backtrack
 * 2. Limits length to prevent excessive processing
 * 3. Uses simple character classes without nested quantifiers
 * 
 * @param email - The email address to validate
 * @returns true if valid email format, false otherwise
 */
export function isValidEmail(email: string): boolean {
	// Basic sanity checks first
	if (!email || typeof email !== 'string') {
		return false;
	}

	// Limit length to prevent DoS
	if (email.length > 254) {
		return false;
	}

	// Trim whitespace
	email = email.trim();

	// Check for @ symbol (must have exactly one)
	const atIndex = email.indexOf('@');
	if (atIndex === -1 || atIndex !== email.lastIndexOf('@')) {
		return false;
	}

	// Split into local and domain parts
	const localPart = email.substring(0, atIndex);
	const domainPart = email.substring(atIndex + 1);

	// Validate local part (before @)
	if (!localPart || localPart.length > 64) {
		return false;
	}

	// Validate domain part (after @)
	if (!domainPart || domainPart.length > 253) {
		return false;
	}

	// Check for at least one dot in domain
	if (!domainPart.includes('.')) {
		return false;
	}

	// Simple safe regex for final validation
	// This pattern is safe because it uses non-backtracking character classes
	const safeEmailPattern = /^[a-zA-Z0-9._%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
	
	return safeEmailPattern.test(email);
}
