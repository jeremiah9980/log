/* global React, ReactDOM, Papa, Recharts */
const { useState, useEffect, useRef, useMemo, useCallback } = React;
const { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } = Recharts;

const h = React.createElement;
const e = React.createElement;

/* ========================================================================
   CONSTANTS & UTILITIES
   ======================================================================== */
const STORAGE_KEY = 'signal_forensics_config_v1';
const PROCESSED_KEY = 'signal_forensics_processed_v1';
const POLL_INTERVAL_MS = 30000;
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

const ACCENT = '#d4a574';
const CALL_COLOR = '#7ec4cf';
const TEXT_COLOR = '#e8a87c';
const CONTACTS_COLOR = '#c8a2c8';

/* Phone normalization */
const normalizePhone = (raw) => {
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

const formatPhone = (raw) => {
  const d = normalizePhone(raw);
  if (!d) return raw || '—';
  if (d.includes('@')) return d;
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  if (d.length === 11) return `+${d[0]} (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  return d;
};

const guessColumn = (headers, candidates) => {
  const lower = headers.map(h => (h || '').toLowerCase().trim());
  for (const cand of candidates) {
    const idx = lower.findIndex(h => h === cand);
    if (idx !== -1) return headers[idx];
  }
  for (const cand of candidates) {
    const idx = lower.findIndex(h => h.includes(cand));
    if (idx !== -1) return headers[idx];
  }
  return null;
};

const detectMapping = (headers) => ({
  number: guessColumn(headers, ['phone number', 'phone', 'number', 'address', 'from', 'to', 'contact']),
  name: guessColumn(headers, ['contact name', 'name', 'display']),
  date: guessColumn(headers, ['date', 'time', 'timestamp', 'when']),
  duration: guessColumn(headers, ['duration', 'length', 'seconds']),
  direction: guessColumn(headers, ['direction', 'type', 'incoming', 'outgoing']),
  message: guessColumn(headers, ['message', 'body', 'text', 'content']),
});

/* Detect file kind from header signature */
const detectFileKind = (headers, filename) => {
  const lower = headers.map(h => (h || '').toLowerCase());
  const lname = (filename || '').toLowerCase();
  // Contacts heuristic
  const hasContactSignals = lower.some(h => h.includes('first name') || h.includes('last name') || h === 'name')
    && lower.some(h => h.includes('phone'));
  if (hasContactSignals && !lower.some(h => h.includes('duration') || h.includes('message') || h.includes('body'))) {
    return 'contacts';
  }
  if (lname.includes('contact')) return 'contacts';
  // Text log heuristic
  if (lower.some(h => h.includes('message') || h.includes('body') || h === 'text')) return 'text';
  if (lname.includes('text') || lname.includes('sms') || lname.includes('imessage')) return 'text';
  // Call log heuristic
  if (lower.some(h => h.includes('duration') || h.includes('call type'))) return 'call';
  if (lname.includes('call')) return 'call';
  // Default: assume call
  return 'call';
};

const parseDate = (val) => {
  if (!val) return null;
  const d = new Date(val);
  if (!isNaN(d.getTime())) return d;
  const n = Number(val);
  if (!isNaN(n) && n > 1000000000) return new Date(n > 1e12 ? n : n * 1000);
  return null;
};

/* Area code → region */
const AREA_CODES = {
  '512': 'Austin, TX', '737': 'Austin, TX', '254': 'Waco/Killeen, TX',
  '210': 'San Antonio, TX', '830': 'New Braunfels, TX', '361': 'Corpus Christi, TX',
  '713': 'Houston, TX', '832': 'Houston, TX', '281': 'Houston, TX', '346': 'Houston, TX',
  '214': 'Dallas, TX', '469': 'Dallas, TX', '972': 'Dallas, TX', '945': 'Dallas, TX',
  '817': 'Fort Worth, TX', '682': 'Fort Worth, TX',
  '915': 'El Paso, TX', '432': 'Midland, TX', '806': 'Lubbock, TX',
  '979': 'Bryan/College Station, TX', '936': 'Huntsville, TX',
  '903': 'Tyler, TX', '430': 'Tyler, TX', '409': 'Beaumont, TX',
  '212': 'Manhattan, NY', '646': 'Manhattan, NY', '917': 'NYC, NY', '718': 'NYC, NY', '347': 'NYC, NY',
  '415': 'San Francisco, CA', '628': 'San Francisco, CA', '650': 'Peninsula, CA',
  '510': 'Oakland, CA', '408': 'San Jose, CA', '669': 'San Jose, CA',
  '310': 'Los Angeles, CA', '424': 'Los Angeles, CA', '213': 'Los Angeles, CA', '323': 'Los Angeles, CA',
  '202': 'Washington, DC', '305': 'Miami, FL', '786': 'Miami, FL',
  '404': 'Atlanta, GA', '470': 'Atlanta, GA', '678': 'Atlanta, GA',
  '312': 'Chicago, IL', '773': 'Chicago, IL', '872': 'Chicago, IL',
  '617': 'Boston, MA', '857': 'Boston, MA',
  '206': 'Seattle, WA', '425': 'Seattle, WA',
  '503': 'Portland, OR', '971': 'Portland, OR',
  '702': 'Las Vegas, NV', '725': 'Las Vegas, NV',
  '602': 'Phoenix, AZ', '480': 'Phoenix, AZ', '623': 'Phoenix, AZ',
  '303': 'Denver, CO', '720': 'Denver, CO',
  '800': 'Toll-free', '888': 'Toll-free', '877': 'Toll-free', '866': 'Toll-free',
  '855': 'Toll-free', '844': 'Toll-free', '833': 'Toll-free',
};

const lookupRegion = (number) => {
  const d = normalizePhone(number);
  if (!d || d.length < 3 || d.includes('@')) return '';
  const ac = d.slice(0, 3);
  return AREA_CODES[ac] || '';
};

/* ========================================================================
   GOOGLE DRIVE API
   ======================================================================== */
const driveApi = {
  token: null,
  setToken(t) { this.token = t; },
  async _fetch(url, opts = {}) {
    const res = await fetch(url, {
      ...opts,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(opts.headers || {}),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Drive API ${res.status}: ${text}`);
    }
    return res;
  },
  async listFolderFiles(folderId) {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,modifiedTime,size)&pageSize=100`;
    const res = await this._fetch(url);
    const data = await res.json();
    return data.files || [];
  },
  async downloadFile(fileId) {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const res = await this._fetch(url);
    return await res.text();
  },
  async uploadFile(name, content, folderId, existingId = null) {
    const meta = { name, mimeType: 'text/csv' };
    if (!existingId && folderId) meta.parents = [folderId];
    const boundary = '-------signal' + Math.random().toString(36).slice(2);
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(meta) + `\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: text/csv\r\n\r\n` +
      content + `\r\n` +
      `--${boundary}--`;
    const url = existingId
      ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
    const res = await this._fetch(url, {
      method: existingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    return await res.json();
  },
  async findFileByName(folderId, name) {
    const q = encodeURIComponent(`'${folderId}' in parents and name = '${name}' and trashed = false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`;
    const res = await this._fetch(url);
    const data = await res.json();
    return (data.files || [])[0];
  },
};

/* ========================================================================
   CLAUDE API: Reverse Lookup
   ======================================================================== */
const reverseLookup = async (numbers, anthropicKey, onProgress) => {
  if (!anthropicKey || !numbers.length) return {};
  const results = {};
  const BATCH = 30;
  for (let i = 0; i < numbers.length; i += BATCH) {
    const batch = numbers.slice(i, i + BATCH);
    const prompt = `You are a phone number identification expert. For each phone number below, identify if it matches a known business, government agency, common service, or toll-free routing pattern. If you cannot identify with genuine confidence, return null for the name.

DO NOT guess names of private individuals — only identify entities that are publicly known (businesses, services, government).

Numbers (US):
${batch.map(n => `- ${formatPhone(n)} (raw: ${n})`).join('\n')}

Respond ONLY with valid JSON, no markdown fences, no preamble:
{"results": [{"raw": "5125551234", "name": "Identified Name or null", "category": "business|government|toll-free|spam-likely|individual|unknown", "confidence": "high|medium|low"}]}`;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1500,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!response.ok) {
        const errText = await response.text();
        console.warn('Anthropic error:', errText);
        onProgress(Math.min(i + BATCH, numbers.length), numbers.length);
        continue;
      }
      const data = await response.json();
      const text = data.content?.filter(c => c.type === 'text').map(c => c.text).join('') || '';
      const cleaned = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      for (const item of parsed.results || []) {
        if (item.name) {
          results[item.raw] = {
            name: item.name,
            category: item.category || 'unknown',
            confidence: item.confidence || 'medium',
            source: 'claude',
          };
        }
      }
    } catch (e) {
      console.warn('Lookup batch failed:', e);
    }
    onProgress(Math.min(i + BATCH, numbers.length), numbers.length);
  }
  return results;
};

/* ========================================================================
   ENRICHMENT & CONTACTS DIRECTORY
   ======================================================================== */
const enrichRows = (rows, mapping, contactsMap, claudeMap) => {
  return rows.map(r => {
    const num = normalizePhone(mapping.number ? r[mapping.number] : '');
    const existingName = mapping.name ? (r[mapping.name] || '').trim() : '';
    let name = '(unknown)';
    let source = 'none';
    if (existingName) { name = existingName; source = 'log'; }
    else if (contactsMap[num]) { name = contactsMap[num]; source = 'contacts'; }
    else if (claudeMap[num]?.name) { name = claudeMap[num].name; source = 'claude'; }
    return {
      ...r,
      _phone_raw: num,
      _phone_formatted: formatPhone(num),
      _identified_name: name,
      _name_source: source,
      _region: lookupRegion(num),
      _category: claudeMap[num]?.category || (name !== '(unknown)' ? 'identified' : 'unknown'),
      _confidence: claudeMap[num]?.confidence || (source === 'log' || source === 'contacts' ? 'high' : 'low'),
      _date_parsed: parseDate(mapping.date ? r[mapping.date] : null),
    };
  });
};

const buildContactsDirectory = (callRows, callMap, textRows, textMap, contactsMap, claudeMap) => {
  const directory = {};
  const ingest = (rows, mapping, kind) => {
    for (const r of rows) {
      const num = normalizePhone(mapping.number ? r[mapping.number] : '');
      if (!num) continue;
      if (!directory[num]) {
        const existingName = mapping.name ? (r[mapping.name] || '').trim() : '';
        let name = '(unknown)';
        let source = 'none';
        if (contactsMap[num]) { name = contactsMap[num]; source = 'contacts'; }
        else if (existingName) { name = existingName; source = 'log'; }
        else if (claudeMap[num]?.name) { name = claudeMap[num].name; source = 'claude'; }
        directory[num] = {
          phone_formatted: formatPhone(num),
          phone_raw: num,
          identified_name: name,
          name_source: source,
          confidence: claudeMap[num]?.confidence || (source === 'contacts' || source === 'log' ? 'high' : 'low'),
          category: claudeMap[num]?.category || (name !== '(unknown)' ? 'identified' : 'unknown'),
          region: lookupRegion(num),
          calls_total: 0,
          calls_inbound: 0,
          calls_outbound: 0,
          texts_total: 0,
          texts_inbound: 0,
          texts_outbound: 0,
          call_duration_sec: 0,
          first_contact: null,
          last_contact: null,
        };
      }
      const entry = directory[num];
      const date = parseDate(mapping.date ? r[mapping.date] : null);
      if (date) {
        if (!entry.first_contact || date < entry.first_contact) entry.first_contact = date;
        if (!entry.last_contact || date > entry.last_contact) entry.last_contact = date;
      }
      const dirVal = (mapping.direction ? String(r[mapping.direction] || '').toLowerCase() : '');
      const isInbound = /in|received|incoming/.test(dirVal);
      const isOutbound = /out|sent|outgoing|placed/.test(dirVal);
      if (kind === 'call') {
        entry.calls_total++;
        if (isInbound) entry.calls_inbound++;
        else if (isOutbound) entry.calls_outbound++;
        entry.call_duration_sec += Number(r[mapping.duration]) || 0;
      } else {
        entry.texts_total++;
        if (isInbound) entry.texts_inbound++;
        else if (isOutbound) entry.texts_outbound++;
      }
    }
  };
  if (callRows.length) ingest(callRows, callMap, 'call');
  if (textRows.length) ingest(textRows, textMap, 'text');
  // Also include numbers from contacts file that never appeared in logs
  for (const [num, name] of Object.entries(contactsMap)) {
    if (!directory[num]) {
      directory[num] = {
        phone_formatted: formatPhone(num),
        phone_raw: num,
        identified_name: name,
        name_source: 'contacts',
        confidence: 'high',
        category: 'identified',
        region: lookupRegion(num),
        calls_total: 0, calls_inbound: 0, calls_outbound: 0,
        texts_total: 0, texts_inbound: 0, texts_outbound: 0,
        call_duration_sec: 0,
        first_contact: null, last_contact: null,
      };
    }
  }
  return Object.values(directory)
    .map(d => ({
      ...d,
      first_contact: d.first_contact ? d.first_contact.toISOString().slice(0, 19).replace('T', ' ') : '',
      last_contact: d.last_contact ? d.last_contact.toISOString().slice(0, 19).replace('T', ' ') : '',
      total_interactions: d.calls_total + d.texts_total,
    }))
    .sort((a, b) => b.total_interactions - a.total_interactions);
};

/* Build contacts map from contacts CSV */
const buildContactsMap = (rows) => {
  const map = {};
  for (const row of rows) {
    const headers = Object.keys(row);
    const nameCol = guessColumn(headers, ['name', 'contact', 'display']);
    const firstCol = headers.find(h => /first.?name/i.test(h));
    const lastCol = headers.find(h => /last.?name/i.test(h));
    let name = '';
    if (nameCol && row[nameCol]) name = row[nameCol];
    else if (firstCol || lastCol) {
      name = [row[firstCol], row[lastCol]].filter(Boolean).join(' ').trim();
    }
    if (!name) continue;
    for (const h of headers) {
      if (/phone|number|mobile|cell/i.test(h)) {
        const norm = normalizePhone(row[h]);
        if (norm && norm.length >= 7) map[norm] = name.trim();
      }
    }
  }
  return map;
};

/* ========================================================================
   GOOGLE AUTH HOOK
   ======================================================================== */
const useGoogleAuth = (clientId, onLog) => {
  const [tokenClient, setTokenClient] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    if (!window.google?.accounts?.oauth2) {
      const checker = setInterval(() => {
        if (window.google?.accounts?.oauth2) {
          clearInterval(checker);
          init();
        }
      }, 200);
      return () => clearInterval(checker);
    }
    init();
    function init() {
      try {
        const tc = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: DRIVE_SCOPE,
          callback: (resp) => {
            if (resp.access_token) {
              setAccessToken(resp.access_token);
              driveApi.setToken(resp.access_token);
              fetchUser(resp.access_token);
              onLog && onLog('Authenticated with Google', 'good');
            } else if (resp.error) {
              onLog && onLog(`Auth error: ${resp.error}`, 'bad');
            }
          },
          error_callback: (err) => onLog && onLog(`Auth error: ${err.message || err.type}`, 'bad'),
        });
        setTokenClient(tc);
        setReady(true);
      } catch (err) {
        onLog && onLog(`Init error: ${err.message}`, 'bad');
      }
    }
  }, [clientId]);

  const fetchUser = async (token) => {
    try {
      const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const u = await r.json();
      setUser(u);
    } catch {}
  };

  const signIn = useCallback(() => {
    if (tokenClient) tokenClient.requestAccessToken({ prompt: 'consent' });
  }, [tokenClient]);

  const signOut = useCallback(() => {
    if (accessToken && window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(accessToken, () => {});
    }
    setAccessToken(null);
    setUser(null);
    driveApi.setToken(null);
  }, [accessToken]);

  return { ready, signIn, signOut, accessToken, user };
};

/* ========================================================================
   UI: Logo / Status pill / Stat / Section
   ======================================================================== */
const Pill = ({ tone = 'neutral', children }) => {
  const colors = {
    neutral: { bg: 'rgba(63,63,70,0.3)', fg: '#a1a1aa', border: '#3f3f46' },
    good: { bg: 'rgba(134,197,168,0.15)', fg: '#86c5a8', border: 'rgba(134,197,168,0.4)' },
    warn: { bg: 'rgba(232,200,124,0.15)', fg: '#e8c87c', border: 'rgba(232,200,124,0.4)' },
    bad: { bg: 'rgba(214,138,138,0.15)', fg: '#d68a8a', border: 'rgba(214,138,138,0.4)' },
    accent: { bg: 'rgba(212,165,116,0.12)', fg: ACCENT, border: 'rgba(212,165,116,0.4)' },
  };
  const c = colors[tone];
  return e('span', {
    className: 'font-mono',
    style: {
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontSize: 10, padding: '3px 9px', borderRadius: 2,
      background: c.bg, color: c.fg, border: `1px solid ${c.border}`,
      letterSpacing: '0.1em', textTransform: 'uppercase',
    },
  }, children);
};

const Stat = ({ label, value, sub, color = ACCENT }) =>
  e('div', { style: { border: '1px solid #27272a', borderRadius: 2, padding: 16, background: 'rgba(24,24,27,0.3)' } },
    e('div', { className: 'font-mono', style: { fontSize: 10, letterSpacing: '0.2em', color: '#71717a', textTransform: 'uppercase', marginBottom: 8 } }, label),
    e('div', { className: 'font-mono', style: { fontSize: 24, color, fontVariantNumeric: 'tabular-nums' } }, value),
    sub && e('div', { style: { fontSize: 11, color: '#71717a', marginTop: 4 } }, sub)
  );

/* ========================================================================
   MAIN APP
   ======================================================================== */
function App() {
  // Config (persisted)
  const [config, setConfig] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch { return {}; }
  });
  const [draftConfig, setDraftConfig] = useState(config);
  const [showSetup, setShowSetup] = useState(!config.googleClientId || !config.folderId);

  // Activity log
  const [activityLog, setActivityLog] = useState([]);
  const log = useCallback((msg, tone = 'neutral') => {
    setActivityLog(l => [{ msg, tone, time: new Date() }, ...l].slice(0, 60));
  }, []);

  // Google auth
  const { ready, signIn, signOut, accessToken, user } = useGoogleAuth(config.googleClientId, log);

  // Polling state
  const [polling, setPolling] = useState(false);
  const [lastCheck, setLastCheck] = useState(null);
  const [folderFiles, setFolderFiles] = useState([]);
  const pollTimer = useRef(null);
  const inFlight = useRef(false);

  // Processed file tracking
  const [processed, setProcessed] = useState(() => {
    try { return JSON.parse(localStorage.getItem(PROCESSED_KEY) || '{}'); }
    catch { return {}; }
  });
  const persistProcessed = (next) => {
    setProcessed(next);
    try { localStorage.setItem(PROCESSED_KEY, JSON.stringify(next)); } catch {}
  };

  // Results
  const [results, setResults] = useState(null);
  const [tab, setTab] = useState('overview');
  const [progress, setProgress] = useState(null);

  const saveConfig = () => {
    setConfig(draftConfig);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(draftConfig)); } catch {}
    setShowSetup(false);
    log('Configuration saved', 'good');
  };

  /* -- Folder scan -- */
  const scanFolder = useCallback(async () => {
    if (!config.folderId || !accessToken || inFlight.current) return;
    inFlight.current = true;
    try {
      const files = await driveApi.listFolderFiles(config.folderId);
      setFolderFiles(files);
      setLastCheck(new Date());
      const csvs = files.filter(f =>
        f.name.toLowerCase().endsWith('.csv') &&
        !f.name.startsWith('_signal_output_')
      );
      const newOnes = csvs.filter(f => {
        const sig = `${f.id}::${f.modifiedTime}`;
        return !processed[sig];
      });
      if (newOnes.length > 0) {
        log(`Found ${newOnes.length} new file(s) → processing`, 'accent');
        await processFiles(csvs);
      }
    } catch (err) {
      log(`Scan error: ${err.message}`, 'bad');
    } finally {
      inFlight.current = false;
    }
  }, [config.folderId, accessToken, processed]);

  /* -- File processing pipeline -- */
  const processFiles = async (csvFiles) => {
    if (!csvFiles.length) return;
    setProgress({ stage: 'Downloading files', current: 0, total: csvFiles.length });

    // 1. Download & parse all
    const parsed = [];
    for (let i = 0; i < csvFiles.length; i++) {
      setProgress({ stage: `Downloading ${csvFiles[i].name}`, current: i, total: csvFiles.length });
      try {
        const text = await driveApi.downloadFile(csvFiles[i].id);
        const parsedCsv = Papa.parse(text, { header: true, skipEmptyLines: true });
        const headers = parsedCsv.meta.fields || [];
        const kind = detectFileKind(headers, csvFiles[i].name);
        parsed.push({ file: csvFiles[i], rows: parsedCsv.data, headers, kind });
        log(`Parsed ${csvFiles[i].name} → detected as ${kind} log (${parsedCsv.data.length} rows)`, 'neutral');
      } catch (err) {
        log(`Failed ${csvFiles[i].name}: ${err.message}`, 'bad');
      }
    }

    // 2. Bucket by kind, merge same-kind files
    const callFiles = parsed.filter(p => p.kind === 'call');
    const textFiles = parsed.filter(p => p.kind === 'text');
    const contactFiles = parsed.filter(p => p.kind === 'contacts');

    const callRows = callFiles.flatMap(f => f.rows);
    const textRows = textFiles.flatMap(f => f.rows);
    const contactRows = contactFiles.flatMap(f => f.rows);

    const callMapping = callFiles.length ? detectMapping(callFiles[0].headers) : {};
    const textMapping = textFiles.length ? detectMapping(textFiles[0].headers) : {};

    const contactsMap = contactRows.length ? buildContactsMap(contactRows) : {};
    log(`Contacts loaded: ${Object.keys(contactsMap).length}`, 'neutral');

    // 3. Collect all unique numbers needing reverse lookup
    const allNums = new Set();
    const collect = (rows, mapping) => {
      if (!mapping.number) return;
      for (const row of rows) {
        const n = normalizePhone(row[mapping.number]);
        const existingName = mapping.name ? (row[mapping.name] || '').trim() : '';
        if (n && n.length >= 10 && !contactsMap[n] && !existingName) {
          allNums.add(n);
        }
      }
    };
    collect(callRows, callMapping);
    collect(textRows, textMapping);

    let claudeMap = {};
    if (config.anthropicKey && allNums.size > 0) {
      log(`Reverse lookup: ${allNums.size} unidentified number(s)`, 'accent');
      setProgress({ stage: 'Reverse lookup via Claude', current: 0, total: allNums.size });
      claudeMap = await reverseLookup(
        [...allNums],
        config.anthropicKey,
        (cur, tot) => setProgress({ stage: 'Reverse lookup via Claude', current: cur, total: tot })
      );
      log(`Identified ${Object.keys(claudeMap).length} via reverse lookup`, 'good');
    } else if (allNums.size > 0) {
      log(`${allNums.size} unidentified (no Anthropic key configured)`, 'warn');
    }

    // 4. Enrich
    setProgress({ stage: 'Enriching records', current: 0, total: 1 });
    const enrichedCalls = enrichRows(callRows, callMapping, contactsMap, claudeMap);
    const enrichedTexts = enrichRows(textRows, textMapping, contactsMap, claudeMap);

    // 5. Build contacts directory (third sheet)
    const directory = buildContactsDirectory(callRows, callMapping, textRows, textMapping, contactsMap, claudeMap);

    setResults({
      calls: { rows: enrichedCalls, mapping: callMapping },
      texts: { rows: enrichedTexts, mapping: textMapping },
      directory,
      contactsMapSize: Object.keys(contactsMap).length,
      claudeMapSize: Object.keys(claudeMap).length,
    });

    // 6. Write three output files back to Drive
    setProgress({ stage: 'Uploading results to Drive', current: 0, total: 3 });
    try {
      // Calls
      if (enrichedCalls.length) {
        const callsCsv = Papa.unparse(enrichedCalls.map(stripInternal));
        await uploadOrUpdate('_signal_output_call_log_enriched.csv', callsCsv);
        setProgress({ stage: 'Uploading results to Drive', current: 1, total: 3 });
      }
      // Texts
      if (enrichedTexts.length) {
        const textsCsv = Papa.unparse(enrichedTexts.map(stripInternal));
        await uploadOrUpdate('_signal_output_text_log_enriched.csv', textsCsv);
        setProgress({ stage: 'Uploading results to Drive', current: 2, total: 3 });
      }
      // Contacts directory
      const dirCsv = Papa.unparse(directory);
      await uploadOrUpdate('_signal_output_contacts_directory.csv', dirCsv);
      setProgress({ stage: 'Uploading results to Drive', current: 3, total: 3 });
      log('All three output files written to Drive', 'good');
    } catch (err) {
      log(`Upload error: ${err.message}`, 'bad');
    }

    // 7. Mark processed
    const next = { ...processed };
    for (const f of csvFiles) next[`${f.id}::${f.modifiedTime}`] = Date.now();
    persistProcessed(next);

    setProgress(null);
    setTab('overview');
  };

  const stripInternal = (r) => {
    const out = {};
    for (const k of Object.keys(r)) {
      if (k === '_date_parsed') continue;
      out[k] = r[k];
    }
    return out;
  };

  const uploadOrUpdate = async (name, content) => {
    const existing = await driveApi.findFileByName(config.folderId, name);
    return driveApi.uploadFile(name, content, config.folderId, existing?.id);
  };

  /* -- Polling lifecycle -- */
  useEffect(() => {
    if (!polling) {
      if (pollTimer.current) clearInterval(pollTimer.current);
      return;
    }
    log(`Polling started (every ${POLL_INTERVAL_MS / 1000}s)`, 'good');
    scanFolder();
    pollTimer.current = setInterval(scanFolder, POLL_INTERVAL_MS);
    return () => clearInterval(pollTimer.current);
  }, [polling, scanFolder]);

  const startWatching = () => setPolling(true);
  const stopWatching = () => { setPolling(false); log('Polling stopped', 'neutral'); };

  const triggerScanNow = () => scanFolder();

  const reprocessAll = async () => {
    if (!confirm('Re-process all CSVs in the folder, ignoring previous processing state?')) return;
    persistProcessed({});
    log('Cleared processing cache, re-scanning…', 'accent');
    setTimeout(scanFolder, 100);
  };

  const downloadLocal = (name, content) => {
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };

  /* ========================================================================
     RENDER
     ======================================================================== */
  const configured = !!(config.googleClientId && config.folderId);

  return e('div', { style: { maxWidth: 1280, margin: '0 auto', padding: '40px 24px 80px' } }, [

    /* HEADER */
    e('header', { key: 'h', style: { marginBottom: 40, paddingBottom: 24, borderBottom: '1px solid #18181b' } }, [
      e('div', { style: { display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 } }, [
        e('div', { className: 'font-mono', style: { fontSize: 10, letterSpacing: '0.3em', color: '#71717a', textTransform: 'uppercase' } }, '// signal_forensics'),
        e('div', { style: { height: 1, flex: 1, background: '#18181b' } }),
        e('div', { className: 'font-mono', style: { fontSize: 10, letterSpacing: '0.3em', color: '#52525b', textTransform: 'uppercase' } }, 'github_pages · v.1.0'),
      ]),
      e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16 } }, [
        e('div', null, [
          e('h1', { className: 'font-display', style: { fontSize: 52, color: ACCENT, margin: 0, lineHeight: 1 } }, 'Communication Forensics'),
          e('p', { style: { color: '#71717a', marginTop: 8, fontSize: 13, maxWidth: 680 } },
            'Drop CSVs into a Google Drive folder. The app polls for new files, identifies numbers (contacts cross-reference + Claude reverse lookup), and writes back three enriched sheets: call log, text log, and contacts directory.'),
        ]),
        e('div', { style: { display: 'flex', gap: 8 } }, [
          accessToken && user
            ? e('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } }, [
                e(Pill, { tone: 'good' }, ['● ', user.email || 'connected']),
                e('button', {
                  onClick: signOut,
                  style: { background: 'transparent', border: '1px solid #3f3f46', color: '#a1a1aa', padding: '6px 12px', fontSize: 11, fontFamily: 'JetBrains Mono', textTransform: 'uppercase', letterSpacing: '0.15em', borderRadius: 2 },
                }, 'Sign out'),
              ])
            : configured
              ? e('button', {
                  onClick: signIn, disabled: !ready,
                  style: { background: 'transparent', border: `1px solid ${ACCENT}`, color: ACCENT, padding: '8px 16px', fontSize: 11, fontFamily: 'JetBrains Mono', textTransform: 'uppercase', letterSpacing: '0.2em', borderRadius: 2 },
                }, 'Connect Google Drive')
              : null,
          e('button', {
            onClick: () => setShowSetup(s => !s),
            style: { background: 'transparent', border: '1px solid #3f3f46', color: '#a1a1aa', padding: '6px 12px', fontSize: 11, fontFamily: 'JetBrains Mono', textTransform: 'uppercase', letterSpacing: '0.15em', borderRadius: 2 },
          }, showSetup ? 'Hide setup' : 'Settings'),
        ]),
      ]),
    ]),

    /* SETUP PANEL */
    showSetup && e('section', { key: 'setup', style: { marginBottom: 32 } }, [
      e('div', { className: 'font-mono', style: { fontSize: 10, letterSpacing: '0.3em', color: '#71717a', marginBottom: 12, textTransform: 'uppercase' } }, '00 — Configuration'),
      e('div', { style: { border: '1px solid #27272a', borderRadius: 2, padding: 24, background: 'rgba(24,24,27,0.3)' } }, [
        e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 20 } }, [
          ConfigField({ label: 'Google OAuth Client ID', help: 'From Google Cloud Console (Web app type)', value: draftConfig.googleClientId || '', onChange: v => setDraftConfig(d => ({ ...d, googleClientId: v })), placeholder: 'xxxxx.apps.googleusercontent.com' }),
          ConfigField({ label: 'Drive Folder ID', help: 'From the URL: drive.google.com/drive/folders/{ID}', value: draftConfig.folderId || '', onChange: v => setDraftConfig(d => ({ ...d, folderId: v })), placeholder: '1abc...XYZ' }),
          ConfigField({ label: 'Anthropic API Key', help: 'For reverse lookup. Stored only in your browser.', value: draftConfig.anthropicKey || '', onChange: v => setDraftConfig(d => ({ ...d, anthropicKey: v })), placeholder: 'sk-ant-...', type: 'password' }),
        ]),
        e('div', { style: { marginTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 } }, [
          e('div', { style: { fontSize: 11, color: '#71717a' } },
            'Setup guide: see the README. All values stored locally in browser only.'),
          e('button', {
            onClick: saveConfig,
            disabled: !draftConfig.googleClientId || !draftConfig.folderId,
            style: { background: ACCENT, color: '#0a0a0b', padding: '8px 20px', fontSize: 11, fontFamily: 'JetBrains Mono', textTransform: 'uppercase', letterSpacing: '0.2em', border: 'none', borderRadius: 2, fontWeight: 600 },
          }, 'Save configuration'),
        ]),
      ]),
    ]),

    /* WATCH PANEL */
    configured && accessToken && e('section', { key: 'watch', style: { marginBottom: 32 } }, [
      e('div', { className: 'font-mono', style: { fontSize: 10, letterSpacing: '0.3em', color: '#71717a', marginBottom: 12, textTransform: 'uppercase' } }, '01 — Drive Folder Watcher'),
      e('div', { style: { border: '1px solid #27272a', borderRadius: 2, padding: 20, background: 'rgba(24,24,27,0.3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' } }, [
        e('div', null, [
          e('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 } }, [
            polling
              ? e('div', { className: 'pulse-dot', style: { width: 10, height: 10, borderRadius: '50%', background: '#86c5a8' } })
              : e('div', { style: { width: 10, height: 10, borderRadius: '50%', background: '#3f3f46' } }),
            e('div', { className: 'font-mono', style: { fontSize: 13, color: '#e4e4e7', letterSpacing: '0.05em' } },
              polling ? 'WATCHING' : 'IDLE'),
          ]),
          e('div', { style: { fontSize: 11, color: '#71717a' } }, [
            `Folder ID: ${config.folderId.slice(0, 12)}…  ·  `,
            `${folderFiles.filter(f => f.name.toLowerCase().endsWith('.csv') && !f.name.startsWith('_signal_output_')).length} input CSV(s)`,
            lastCheck && `  ·  last check ${lastCheck.toLocaleTimeString()}`,
          ]),
        ]),
        e('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
          !polling
            ? e('button', { onClick: startWatching,
                style: { background: ACCENT, color: '#0a0a0b', padding: '8px 16px', fontSize: 11, fontFamily: 'JetBrains Mono', textTransform: 'uppercase', letterSpacing: '0.2em', border: 'none', borderRadius: 2, fontWeight: 600 } }, '▶ Start watching')
            : e('button', { onClick: stopWatching,
                style: { background: 'transparent', color: '#d68a8a', border: '1px solid #d68a8a', padding: '8px 16px', fontSize: 11, fontFamily: 'JetBrains Mono', textTransform: 'uppercase', letterSpacing: '0.2em', borderRadius: 2 } }, '■ Stop'),
          e('button', { onClick: triggerScanNow, disabled: !!progress,
            style: { background: 'transparent', border: '1px solid #3f3f46', color: '#a1a1aa', padding: '8px 14px', fontSize: 11, fontFamily: 'JetBrains Mono', textTransform: 'uppercase', letterSpacing: '0.15em', borderRadius: 2 } }, 'Scan now'),
          e('button', { onClick: reprocessAll, disabled: !!progress,
            style: { background: 'transparent', border: '1px solid #3f3f46', color: '#a1a1aa', padding: '8px 14px', fontSize: 11, fontFamily: 'JetBrains Mono', textTransform: 'uppercase', letterSpacing: '0.15em', borderRadius: 2 } }, 'Re-process all'),
        ]),
      ]),

      /* Progress bar */
      progress && e('div', { style: { marginTop: 12, border: '1px solid #27272a', borderRadius: 2, padding: 12, background: 'rgba(24,24,27,0.3)' } }, [
        e('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 11, fontFamily: 'JetBrains Mono', marginBottom: 8 } }, [
          e('span', { style: { color: '#a1a1aa' } }, progress.stage),
          e('span', { style: { color: '#71717a' } }, `${progress.current} / ${progress.total}`),
        ]),
        e('div', { style: { height: 2, background: '#27272a', borderRadius: 1, overflow: 'hidden' } },
          e('div', { style: { height: '100%', width: progress.total ? `${(progress.current / progress.total) * 100}%` : '0%', background: ACCENT, transition: 'width 0.3s' } })),
      ]),

      /* Files in folder */
      folderFiles.length > 0 && e('div', { style: { marginTop: 12, border: '1px solid #27272a', borderRadius: 2, background: 'rgba(24,24,27,0.2)' } }, [
        e('div', { className: 'font-mono', style: { fontSize: 10, padding: 10, borderBottom: '1px solid #27272a', color: '#71717a', letterSpacing: '0.2em', textTransform: 'uppercase' } },
          `Folder contents (${folderFiles.length})`),
        e('div', { className: 'scrollbar-thin', style: { maxHeight: 200, overflowY: 'auto' } },
          folderFiles.map(f => {
            const isOutput = f.name.startsWith('_signal_output_');
            const isCsv = f.name.toLowerCase().endsWith('.csv');
            const sig = `${f.id}::${f.modifiedTime}`;
            const wasProcessed = !!processed[sig];
            return e('div', { key: f.id, style: {
                padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                borderBottom: '1px solid #18181b', fontSize: 12 } }, [
              e('div', { style: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 } }, [
                e('span', { className: 'font-mono', style: {
                    color: isOutput ? CONTACTS_COLOR : isCsv ? '#e4e4e7' : '#71717a',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, f.name),
              ]),
              e('div', { style: { display: 'flex', gap: 6 } }, [
                isOutput ? e(Pill, { tone: 'accent' }, 'OUTPUT')
                : !isCsv ? e(Pill, { tone: 'neutral' }, 'IGNORED')
                : wasProcessed ? e(Pill, { tone: 'good' }, '✓ DONE')
                : e(Pill, { tone: 'warn' }, 'PENDING'),
              ]),
            ]);
          })
        ),
      ]),
    ]),

    /* ACTIVITY LOG */
    activityLog.length > 0 && e('section', { key: 'log', style: { marginBottom: 32 } }, [
      e('div', { className: 'font-mono', style: { fontSize: 10, letterSpacing: '0.3em', color: '#71717a', marginBottom: 12, textTransform: 'uppercase' } }, '02 — Activity Log'),
      e('div', { style: { border: '1px solid #27272a', borderRadius: 2, background: 'rgba(0,0,0,0.4)', maxHeight: 200, overflowY: 'auto' }, className: 'scrollbar-thin' },
        activityLog.map((entry, i) =>
          e('div', { key: i, className: 'fade-in font-mono', style: { padding: '6px 12px', borderBottom: '1px solid #18181b', fontSize: 11, display: 'flex', gap: 12 } }, [
            e('span', { style: { color: '#52525b', minWidth: 60 } }, entry.time.toLocaleTimeString().slice(0, 8)),
            e('span', { style: { color: { good: '#86c5a8', warn: '#e8c87c', bad: '#d68a8a', accent: ACCENT, neutral: '#a1a1aa' }[entry.tone] } }, entry.msg),
          ])
        )),
    ]),

    /* RESULTS */
    results && e(Results, { key: 'r', results, tab, setTab, downloadLocal }),

    /* FOOTER */
    e('footer', { key: 'f', style: { marginTop: 80, paddingTop: 20, borderTop: '1px solid #18181b', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 } }, [
      e('span', { className: 'font-mono', style: { fontSize: 10, color: '#52525b', letterSpacing: '0.2em', textTransform: 'uppercase' } },
        '// processed in browser · keys stored locally · drive scope: drive.file'),
      e('span', { className: 'font-mono', style: { fontSize: 10, color: '#52525b', letterSpacing: '0.2em', textTransform: 'uppercase' } }, 'signal.fx'),
    ]),
  ]);
}

/* ========================================================================
   ConfigField
   ======================================================================== */
function ConfigField({ label, help, value, onChange, placeholder, type }) {
  return e('div', null, [
    e('label', { className: 'font-mono', style: { display: 'block', fontSize: 10, color: '#a1a1aa', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 6 } }, label),
    e('input', {
      type: type || 'text',
      value: value,
      onChange: ev => onChange(ev.target.value),
      placeholder,
    }),
    e('div', { style: { fontSize: 10, color: '#71717a', marginTop: 4 } }, help),
  ]);
}

/* ========================================================================
   Results panel: Overview + Calls + Texts + Contacts Directory tabs
   ======================================================================== */
function Results({ results, tab, setTab, downloadLocal }) {
  const { calls, texts, directory } = results;

  // Aggregations for overview
  const totalCallSec = calls.rows.reduce((s, r) => s + (Number(r[calls.mapping.duration]) || 0), 0);
  const callsIdentified = calls.rows.filter(r => r._identified_name !== '(unknown)').length;
  const textsIdentified = texts.rows.filter(r => r._identified_name !== '(unknown)').length;

  // Timeline
  const timelineMap = {};
  [...calls.rows.map(r => ({ ...r, _kind: 'call' })), ...texts.rows.map(r => ({ ...r, _kind: 'text' }))].forEach(r => {
    if (!r._date_parsed) return;
    const k = r._date_parsed.toISOString().slice(0, 10);
    if (!timelineMap[k]) timelineMap[k] = { date: k, calls: 0, texts: 0 };
    if (r._kind === 'call') timelineMap[k].calls++; else timelineMap[k].texts++;
  });
  const timeline = Object.values(timelineMap).sort((a, b) => a.date.localeCompare(b.date));

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'calls', label: `Call Log (${calls.rows.length.toLocaleString()})` },
    { id: 'texts', label: `Text Log (${texts.rows.length.toLocaleString()})` },
    { id: 'directory', label: `Contacts Directory (${directory.length.toLocaleString()})` },
  ];

  return e('section', null, [
    e('div', { className: 'font-mono', style: { fontSize: 10, letterSpacing: '0.3em', color: '#71717a', marginBottom: 12, textTransform: 'uppercase' } }, '03 — Output'),

    /* Tabs */
    e('div', { style: { display: 'flex', gap: 4, borderBottom: '1px solid #18181b', marginBottom: 24, overflowX: 'auto' } },
      tabs.map(t => e('button', {
        key: t.id, onClick: () => setTab(t.id),
        className: 'font-mono',
        style: {
          background: 'transparent', border: 'none',
          padding: '10px 16px', fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase',
          color: tab === t.id ? ACCENT : '#71717a',
          borderBottom: tab === t.id ? `1px solid ${ACCENT}` : '1px solid transparent',
          whiteSpace: 'nowrap', cursor: 'pointer',
        },
      }, t.label))
    ),

    /* Overview */
    tab === 'overview' && e('div', { style: { display: 'flex', flexDirection: 'column', gap: 24 } }, [
      e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 } }, [
        e(Stat, { label: 'Total Calls', value: calls.rows.length.toLocaleString(), color: CALL_COLOR, sub: `${callsIdentified} identified` }),
        e(Stat, { label: 'Total Texts', value: texts.rows.length.toLocaleString(), color: TEXT_COLOR, sub: `${textsIdentified} identified` }),
        e(Stat, { label: 'Unique Contacts', value: directory.length.toLocaleString(), color: CONTACTS_COLOR }),
        e(Stat, { label: 'Call Time', value: totalCallSec ? `${Math.floor(totalCallSec / 3600)}h ${Math.floor((totalCallSec % 3600) / 60)}m` : '—', color: ACCENT }),
      ]),

      timeline.length > 0 && e('div', { style: { border: '1px solid #27272a', borderRadius: 2, padding: 20, background: 'rgba(24,24,27,0.3)' } }, [
        e('div', { className: 'font-mono', style: { fontSize: 10, color: '#71717a', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 16 } }, 'Daily Activity Timeline'),
        e(ResponsiveContainer, { width: '100%', height: 240 },
          e(LineChart, { data: timeline }, [
            e(CartesianGrid, { key: 'g', stroke: '#27272a', strokeDasharray: '2 4' }),
            e(XAxis, { key: 'x', dataKey: 'date', tick: { fontSize: 10, fill: '#71717a', fontFamily: 'JetBrains Mono' }, stroke: '#3f3f46' }),
            e(YAxis, { key: 'y', tick: { fontSize: 10, fill: '#71717a', fontFamily: 'JetBrains Mono' }, stroke: '#3f3f46' }),
            e(Tooltip, { key: 't', contentStyle: { background: '#18181b', border: '1px solid #3f3f46', fontSize: 12, fontFamily: 'JetBrains Mono' } }),
            e(Line, { key: 'l1', type: 'monotone', dataKey: 'calls', stroke: CALL_COLOR, strokeWidth: 1.5, dot: false }),
            e(Line, { key: 'l2', type: 'monotone', dataKey: 'texts', stroke: TEXT_COLOR, strokeWidth: 1.5, dot: false }),
          ])
        ),
      ]),

      /* Top 10 from directory */
      e('div', { style: { border: '1px solid #27272a', borderRadius: 2, background: 'rgba(24,24,27,0.3)', overflow: 'hidden' } }, [
        e('div', { className: 'font-mono', style: { padding: 16, borderBottom: '1px solid #27272a', fontSize: 10, color: '#71717a', letterSpacing: '0.2em', textTransform: 'uppercase' } }, 'Top 10 Contacts'),
        e('div', { className: 'scrollbar-thin', style: { overflowX: 'auto' } },
          DirectoryTable({ rows: directory.slice(0, 10), compact: true })
        ),
      ]),
    ]),

    /* Calls table */
    tab === 'calls' && RecordsTable({ data: calls, downloadLocal, name: 'call_log_enriched' }),
    /* Texts table */
    tab === 'texts' && RecordsTable({ data: texts, downloadLocal, name: 'text_log_enriched' }),

    /* Contacts directory */
    tab === 'directory' && e('div', null, [
      e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 } }, [
        e('div', { className: 'font-mono', style: { fontSize: 11, color: '#71717a' } },
          `${directory.length.toLocaleString()} unique numbers · written to Drive as _signal_output_contacts_directory.csv`),
        e('button', {
          onClick: () => downloadLocal('contacts_directory.csv', Papa.unparse(directory)),
          className: 'font-mono',
          style: { background: 'transparent', border: '1px solid #3f3f46', color: '#a1a1aa', padding: '6px 12px', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', borderRadius: 2 },
        }, '↓ Download local copy'),
      ]),
      e('div', { style: { border: '1px solid #27272a', borderRadius: 2, overflow: 'hidden' } },
        e('div', { className: 'scrollbar-thin', style: { maxHeight: 700, overflow: 'auto' } },
          DirectoryTable({ rows: directory })
        )
      ),
    ]),
  ]);
}

function DirectoryTable({ rows, compact = false }) {
  return e('table', { style: { width: '100%', fontSize: 12, borderCollapse: 'collapse' } }, [
    e('thead', { key: 'h', style: { position: 'sticky', top: 0, background: '#0a0a0b', zIndex: 1 } },
      e('tr', { className: 'font-mono', style: { fontSize: 10, color: '#71717a', letterSpacing: '0.2em', textTransform: 'uppercase', borderBottom: '1px solid #27272a' } }, [
        e('th', { key: 'a', style: { textAlign: 'left', padding: 10 } }, 'Name'),
        e('th', { key: 'b', style: { textAlign: 'left', padding: 10 } }, 'Phone'),
        e('th', { key: 'c', style: { textAlign: 'left', padding: 10 } }, 'Region'),
        !compact && e('th', { key: 'd', style: { textAlign: 'left', padding: 10 } }, 'Source'),
        !compact && e('th', { key: 'e', style: { textAlign: 'left', padding: 10 } }, 'Category'),
        e('th', { key: 'f', style: { textAlign: 'right', padding: 10 } }, 'Calls'),
        e('th', { key: 'g', style: { textAlign: 'right', padding: 10 } }, 'Texts'),
        !compact && e('th', { key: 'h', style: { textAlign: 'right', padding: 10 } }, 'Duration'),
        !compact && e('th', { key: 'i', style: { textAlign: 'left', padding: 10 } }, 'Last Contact'),
      ])
    ),
    e('tbody', { key: 'b' },
      rows.map((r, i) => e('tr', { key: i, style: { borderBottom: '1px solid #18181b' } }, [
        e('td', { key: 'a', style: { padding: 8, color: '#e4e4e7' } }, r.identified_name),
        e('td', { key: 'b', className: 'font-mono', style: { padding: 8, color: '#a1a1aa' } }, r.phone_formatted),
        e('td', { key: 'c', style: { padding: 8, color: '#71717a', fontSize: 11 } }, r.region || '—'),
        !compact && e('td', { key: 'd', style: { padding: 8 } },
          e(Pill, { tone: r.name_source === 'contacts' ? 'good' : r.name_source === 'claude' ? 'accent' : r.name_source === 'log' ? 'neutral' : 'bad' }, r.name_source)
        ),
        !compact && e('td', { key: 'e', style: { padding: 8, color: '#a1a1aa', fontSize: 11 } }, r.category),
        e('td', { key: 'f', className: 'font-mono', style: { padding: 8, textAlign: 'right', color: CALL_COLOR } }, r.calls_total || ''),
        e('td', { key: 'g', className: 'font-mono', style: { padding: 8, textAlign: 'right', color: TEXT_COLOR } }, r.texts_total || ''),
        !compact && e('td', { key: 'h', className: 'font-mono', style: { padding: 8, textAlign: 'right', color: '#a1a1aa', fontSize: 11 } },
          r.call_duration_sec ? `${Math.floor(r.call_duration_sec / 60)}m` : ''),
        !compact && e('td', { key: 'i', className: 'font-mono', style: { padding: 8, color: '#71717a', fontSize: 11 } }, r.last_contact || '—'),
      ]))
    ),
  ]);
}

function RecordsTable({ data, downloadLocal, name }) {
  if (!data.rows.length) return e('div', { style: { color: '#71717a', fontStyle: 'italic', fontSize: 13 } }, 'No records');
  const m = data.mapping;
  const stripInternal = (r) => {
    const out = {};
    for (const k of Object.keys(r)) { if (k === '_date_parsed') continue; out[k] = r[k]; }
    return out;
  };
  return e('div', null, [
    e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 } }, [
      e('div', { className: 'font-mono', style: { fontSize: 11, color: '#71717a' } },
        `${data.rows.length.toLocaleString()} records · written to Drive as _signal_output_${name}.csv`),
      e('button', {
        onClick: () => downloadLocal(`${name}.csv`, Papa.unparse(data.rows.map(stripInternal))),
        className: 'font-mono',
        style: { background: 'transparent', border: '1px solid #3f3f46', color: '#a1a1aa', padding: '6px 12px', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', borderRadius: 2 },
      }, '↓ Download local copy'),
    ]),
    e('div', { style: { border: '1px solid #27272a', borderRadius: 2, overflow: 'hidden' } },
      e('div', { className: 'scrollbar-thin', style: { maxHeight: 700, overflow: 'auto' } },
        e('table', { style: { width: '100%', fontSize: 12, borderCollapse: 'collapse' } }, [
          e('thead', { key: 'h', style: { position: 'sticky', top: 0, background: '#0a0a0b' } },
            e('tr', { className: 'font-mono', style: { fontSize: 10, color: '#71717a', letterSpacing: '0.2em', textTransform: 'uppercase', borderBottom: '1px solid #27272a' } }, [
              e('th', { key: 1, style: { textAlign: 'left', padding: 10 } }, 'Name'),
              e('th', { key: 2, style: { textAlign: 'left', padding: 10 } }, 'Phone'),
              e('th', { key: 3, style: { textAlign: 'left', padding: 10 } }, 'Region'),
              m.date && e('th', { key: 4, style: { textAlign: 'left', padding: 10 } }, 'Date'),
              m.direction && e('th', { key: 5, style: { textAlign: 'left', padding: 10 } }, 'Direction'),
              m.duration && e('th', { key: 6, style: { textAlign: 'right', padding: 10 } }, 'Duration'),
              m.message && e('th', { key: 7, style: { textAlign: 'left', padding: 10 } }, 'Message'),
            ])
          ),
          e('tbody', { key: 'b' },
            data.rows.slice(0, 500).map((r, i) => e('tr', { key: i, style: { borderBottom: '1px solid #18181b' } }, [
              e('td', { key: 1, style: { padding: 8, color: '#e4e4e7' } }, r._identified_name),
              e('td', { key: 2, className: 'font-mono', style: { padding: 8, color: '#a1a1aa' } }, r._phone_formatted),
              e('td', { key: 3, style: { padding: 8, color: '#71717a', fontSize: 11 } }, r._region || '—'),
              m.date && e('td', { key: 4, className: 'font-mono', style: { padding: 8, color: '#71717a', fontSize: 11 } }, r[m.date]),
              m.direction && e('td', { key: 5, style: { padding: 8, color: '#a1a1aa' } }, r[m.direction]),
              m.duration && e('td', { key: 6, className: 'font-mono', style: { padding: 8, textAlign: 'right', color: '#a1a1aa' } }, r[m.duration]),
              m.message && e('td', { key: 7, style: { padding: 8, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#a1a1aa' } }, r[m.message]),
            ]))
          ),
        ])
      )
    ),
    data.rows.length > 500 && e('div', { className: 'font-mono', style: { padding: 10, fontSize: 11, color: '#71717a', borderTop: '1px solid #27272a', background: 'rgba(24,24,27,0.5)' } },
      `Showing first 500 of ${data.rows.length.toLocaleString()} · download for full file`),
  ]);
}

/* Mount */
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(e(App));
