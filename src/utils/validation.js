const PHONE_ALLOWED_CHARACTERS = /^[+\d\s\-()]*$/;
const MIN_PHONE_DIGITS = 8;
const MAX_PHONE_DIGITS = 15;

export function extractPhoneDigits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

export function validateLoosePhoneNumber(value = '', label = 'Phone number') {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (!PHONE_ALLOWED_CHARACTERS.test(raw)) {
    return `${label} can only include digits, spaces, parentheses, hyphens, and an optional leading +.`;
  }

  const plusMatches = raw.match(/\+/g) || [];
  if (plusMatches.length > 1 || (plusMatches.length === 1 && !raw.startsWith('+'))) {
    return `${label} can only contain a single + at the beginning.`;
  }

  const digits = extractPhoneDigits(raw);
  if (digits.length < MIN_PHONE_DIGITS || digits.length > MAX_PHONE_DIGITS) {
    return `${label} must contain between ${MIN_PHONE_DIGITS} and ${MAX_PHONE_DIGITS} digits after removing formatting.`;
  }

  return '';
}

export function isValidLoosePhoneNumber(value = '', label = 'Phone number') {
  return !validateLoosePhoneNumber(value, label);
}
