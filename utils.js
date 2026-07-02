/**
 * Pure utility functions for Signal · Communication Forensics.
 * These are extracted from app.js so they can be imported and tested
 * independently of the browser environment.
 */

/* Phone normalization */
export const normalizePhone = (raw) => {
  if (!raw) return '';
  const s = String(raw).trim();
  // Handle email addresses (iMessage)
  if (s.includes('@')) return s.toLowerCase();
  const digits = s.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length === 10) return digits;
  if (digits.length >= 7) return digits;
  return '';
};

export const formatPhone = (raw) => {
  const d = normalizePhone(raw);
  if (!d) return raw || '—';
  if (d.includes('@')) return d;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `+${d[0]} (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return d;
};

export const guessColumn = (headers, candidates) => {
  const lower = headers.map((h) => (h || '').toLowerCase().trim());
  for (const cand of candidates) {
    const idx = lower.findIndex((h) => h === cand);
    if (idx !== -1) return headers[idx];
  }
  for (const cand of candidates) {
    const idx = lower.findIndex((h) => h.includes(cand));
    if (idx !== -1) return headers[idx];
  }
  return null;
};

export const detectMapping = (headers) => ({
  number: guessColumn(headers, ['phone number', 'phone', 'number', 'address', 'from', 'to', 'contact']),
  name: guessColumn(headers, ['contact name', 'name', 'display']),
  date: guessColumn(headers, ['date', 'time', 'timestamp', 'when']),
  duration: guessColumn(headers, ['duration', 'length', 'seconds']),
  direction: guessColumn(headers, ['direction', 'type', 'incoming', 'outgoing']),
  message: guessColumn(headers, ['message', 'body', 'text', 'content']),
});

/* Detect file kind from header signature */
export const detectFileKind = (headers, filename) => {
  const lower = headers.map((h) => (h || '').toLowerCase());
  const lname = (filename || '').toLowerCase();
  // Contacts heuristic
  const hasContactSignals =
    lower.some((h) => h.includes('first name') || h.includes('last name') || h === 'name') &&
    lower.some((h) => h.includes('phone'));
  if (
    hasContactSignals &&
    !lower.some((h) => h.includes('duration') || h.includes('message') || h.includes('body'))
  ) {
    return 'contacts';
  }
  if (lname.includes('contact')) return 'contacts';
  // Text log heuristic
  if (lower.some((h) => h.includes('message') || h.includes('body') || h === 'text')) return 'text';
  if (lname.includes('text') || lname.includes('sms') || lname.includes('imessage')) return 'text';
  // Call log heuristic
  if (lower.some((h) => h.includes('duration') || h.includes('call type'))) return 'call';
  if (lname.includes('call')) return 'call';
  // Default: assume call
  return 'call';
};

export const parseDate = (val) => {
  if (!val) return null;
  const d = new Date(val);
  if (!isNaN(d.getTime())) return d;
  const n = Number(val);
  if (!isNaN(n) && n > 1000000000) return new Date(n > 1e12 ? n : n * 1000);
  return null;
};

/* Area code → region */
export const AREA_CODES = {
  512: 'Austin, TX',
  737: 'Austin, TX',
  254: 'Waco/Killeen, TX',
  210: 'San Antonio, TX',
  830: 'New Braunfels, TX',
  361: 'Corpus Christi, TX',
  713: 'Houston, TX',
  832: 'Houston, TX',
  281: 'Houston, TX',
  346: 'Houston, TX',
  214: 'Dallas, TX',
  469: 'Dallas, TX',
  972: 'Dallas, TX',
  945: 'Dallas, TX',
  817: 'Fort Worth, TX',
  682: 'Fort Worth, TX',
  915: 'El Paso, TX',
  432: 'Midland, TX',
  806: 'Lubbock, TX',
  979: 'Bryan/College Station, TX',
  936: 'Huntsville, TX',
  903: 'Tyler, TX',
  430: 'Tyler, TX',
  409: 'Beaumont, TX',
  212: 'Manhattan, NY',
  646: 'Manhattan, NY',
  917: 'NYC, NY',
  718: 'NYC, NY',
  347: 'NYC, NY',
  415: 'San Francisco, CA',
  628: 'San Francisco, CA',
  650: 'Peninsula, CA',
  510: 'Oakland, CA',
  408: 'San Jose, CA',
  669: 'San Jose, CA',
  310: 'Los Angeles, CA',
  424: 'Los Angeles, CA',
  213: 'Los Angeles, CA',
  323: 'Los Angeles, CA',
  202: 'Washington, DC',
  305: 'Miami, FL',
  786: 'Miami, FL',
  404: 'Atlanta, GA',
  470: 'Atlanta, GA',
  678: 'Atlanta, GA',
  312: 'Chicago, IL',
  773: 'Chicago, IL',
  872: 'Chicago, IL',
  617: 'Boston, MA',
  857: 'Boston, MA',
  206: 'Seattle, WA',
  425: 'Seattle, WA',
  503: 'Portland, OR',
  971: 'Portland, OR',
  702: 'Las Vegas, NV',
  725: 'Las Vegas, NV',
  602: 'Phoenix, AZ',
  480: 'Phoenix, AZ',
  623: 'Phoenix, AZ',
  303: 'Denver, CO',
  720: 'Denver, CO',
  800: 'Toll-free',
  888: 'Toll-free',
  877: 'Toll-free',
  866: 'Toll-free',
  855: 'Toll-free',
  844: 'Toll-free',
  833: 'Toll-free',
};

export const lookupRegion = (number) => {
  const d = normalizePhone(number);
  if (!d || d.length < 3 || d.includes('@')) return '';
  const ac = d.slice(0, 3);
  return AREA_CODES[ac] || '';
};
