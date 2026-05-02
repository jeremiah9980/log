import { describe, it, expect } from 'vitest';
import {
  normalizePhone,
  formatPhone,
  guessColumn,
  detectFileKind,
  parseDate,
  lookupRegion,
  detectMapping,
} from './utils.js';

describe('normalizePhone', () => {
  it('returns empty string for falsy input', () => {
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone(null)).toBe('');
    expect(normalizePhone(undefined)).toBe('');
  });

  it('normalizes a 10-digit number', () => {
    expect(normalizePhone('5125550123')).toBe('5125550123');
    expect(normalizePhone('(512) 555-0123')).toBe('5125550123');
  });

  it('strips the leading 1 from an 11-digit US number', () => {
    expect(normalizePhone('15125550123')).toBe('5125550123');
    expect(normalizePhone('+1 (512) 555-0123')).toBe('5125550123');
  });

  it('returns lowercase email addresses unchanged', () => {
    expect(normalizePhone('User@Example.com')).toBe('user@example.com');
  });

  it('handles short numbers (>=7 digits)', () => {
    expect(normalizePhone('5550123')).toBe('5550123');
  });

  it('returns empty string for fewer than 7 digits', () => {
    expect(normalizePhone('123')).toBe('');
  });
});

describe('formatPhone', () => {
  it('formats a 10-digit number with area code parens', () => {
    expect(formatPhone('5125550123')).toBe('(512) 555-0123');
  });

  it('formats an 11-digit number with country code', () => {
    expect(formatPhone('15125550123')).toBe('(512) 555-0123');
  });

  it('returns email as-is', () => {
    expect(formatPhone('test@example.com')).toBe('test@example.com');
  });

  it('returns em-dash for empty input', () => {
    expect(formatPhone('')).toBe('—');
    expect(formatPhone(null)).toBe('—');
  });
});

describe('guessColumn', () => {
  it('finds an exact column match', () => {
    expect(guessColumn(['Phone', 'Name', 'Date'], ['phone'])).toBe('Phone');
  });

  it('finds a partial column match when no exact match exists', () => {
    expect(guessColumn(['Phone Number', 'Full Name'], ['phone number'])).toBe('Phone Number');
  });

  it('returns null when no column matches', () => {
    expect(guessColumn(['Foo', 'Bar'], ['phone'])).toBeNull();
  });
});

describe('detectFileKind', () => {
  it('detects call logs by header', () => {
    expect(detectFileKind(['Phone', 'Duration', 'Date'], 'export.csv')).toBe('call');
  });

  it('detects text logs by header', () => {
    expect(detectFileKind(['Phone', 'Message', 'Date'], 'export.csv')).toBe('text');
  });

  it('detects contacts by header', () => {
    expect(detectFileKind(['First Name', 'Last Name', 'Phone Number'], 'contacts.csv')).toBe('contacts');
  });

  it('detects call logs by filename', () => {
    expect(detectFileKind(['A', 'B'], 'my_call_log.csv')).toBe('call');
  });

  it('detects text logs by filename', () => {
    expect(detectFileKind(['A', 'B'], 'sms_export.csv')).toBe('text');
  });

  it('defaults to call when no signals found', () => {
    expect(detectFileKind(['Col1', 'Col2'], 'unknown.csv')).toBe('call');
  });
});

describe('parseDate', () => {
  it('returns null for falsy input', () => {
    expect(parseDate(null)).toBeNull();
    expect(parseDate('')).toBeNull();
  });

  it('parses ISO date strings', () => {
    const d = parseDate('2024-01-15T10:30:00Z');
    expect(d).toBeInstanceOf(Date);
    expect(d.getFullYear()).toBe(2024);
  });

  it('parses a numeric value as a Date', () => {
    // new Date(number) treats the value as milliseconds from epoch
    const d = parseDate(1705312200000); // 2024-01-15 in ms
    expect(d).toBeInstanceOf(Date);
    expect(d.getFullYear()).toBe(2024);
  });

  it('parses a non-ISO string date', () => {
    const d = parseDate('January 15, 2024');
    expect(d).toBeInstanceOf(Date);
    expect(d.getFullYear()).toBe(2024);
  });
});

describe('lookupRegion', () => {
  it('returns region for a known area code', () => {
    expect(lookupRegion('5125550123')).toBe('Austin, TX');
  });

  it('returns empty string for an unknown area code', () => {
    expect(lookupRegion('9999990000')).toBe('');
  });

  it('returns empty string for an email', () => {
    expect(lookupRegion('user@example.com')).toBe('');
  });

  it('identifies toll-free numbers', () => {
    expect(lookupRegion('8005550199')).toBe('Toll-free');
  });
});

describe('detectMapping', () => {
  it('maps standard call log headers', () => {
    const mapping = detectMapping(['Phone Number', 'Contact Name', 'Date', 'Duration', 'Direction']);
    expect(mapping.number).toBe('Phone Number');
    expect(mapping.name).toBe('Contact Name');
    expect(mapping.date).toBe('Date');
    expect(mapping.duration).toBe('Duration');
    expect(mapping.direction).toBe('Direction');
  });

  it('returns null for missing columns', () => {
    const mapping = detectMapping(['Foo', 'Bar']);
    expect(mapping.number).toBeNull();
    expect(mapping.message).toBeNull();
  });
});
