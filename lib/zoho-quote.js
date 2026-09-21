'use strict';

const ZOHO_WEBFORM_URL = 'https://crm.zoho.com/crm/WebToLeadForm';
const RETURN_URL = 'https://www.thebathpros.net/#quote';

const ZOHO_HIDDEN = {
  xnQsjsdp: '05a6bc102df17ee373031b98d61ce7dd44ddd59e7fd1aeaa06011727789c767e',
  xmIwtLD:
    '13554afa0c7f0c4a65cd0574d02f1ca7ec872e88c5b178652cfdbb5b88322557aae5fb1278197b4ca8a887b9dbe1a98d',
  actionType: 'TGVhZHM=',
  zc_gad: '',
  returnURL: RETURN_URL,
  aG9uZXlwb3Q: '',
};

// Exact Zoho Lead "Address - State / Province" picklist labels for US states.
const US_STATE_BY_ABBR = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida (United States)',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana (United States)',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  PR: 'Puerto Rico',
};

const US_STATE_BY_NAME = {};
for (const [abbr, label] of Object.entries(US_STATE_BY_ABBR)) {
  US_STATE_BY_NAME[label.toLowerCase()] = label;
  US_STATE_BY_NAME[abbr.toLowerCase()] = label;
}
US_STATE_BY_NAME.florida = 'Florida (United States)';
US_STATE_BY_NAME.montana = 'Montana (United States)';
US_STATE_BY_NAME['washington dc'] = 'District of Columbia';
US_STATE_BY_NAME['washington d.c.'] = 'District of Columbia';
US_STATE_BY_NAME['washington, dc'] = 'District of Columbia';
US_STATE_BY_NAME['d.c.'] = 'District of Columbia';

function trim(value) {
  return String(value == null ? '' : value).trim();
}

function getField(input, ...names) {
  if (!input || typeof input !== 'object') return '';
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(input, name) && input[name] != null) {
      return trim(input[name]);
    }
  }
  const lower = {};
  for (const [key, value] of Object.entries(input)) {
    lower[key.toLowerCase()] = value;
  }
  for (const name of names) {
    const value = lower[name.toLowerCase()];
    if (value != null) return trim(value);
  }
  return '';
}

function isHoneypotTripped(input) {
  const botcheck = getField(input, 'botcheck');
  if (botcheck && !['false', '0', 'off', 'no'].includes(botcheck.toLowerCase())) {
    return true;
  }
  return Boolean(
    getField(input, 'aG9uZXlwb3Q') ||
      getField(input, 'website') ||
      getField(input, 'fax') ||
      getField(input, 'company_url')
  );
}

// Silent-drop policy: suspected spam gets the same 200 { success: true }
// response as a real Lead so bots cannot probe the filter. Nothing is
// forwarded to Zoho. Incomplete required fields still return 400.
const MIN_FORM_ELAPSED_MS = 1500;
const MAX_NAME_CHARS = 120;
const MAX_DETAILS_CHARS = 2000;
const MAX_GENERIC_CHARS = 255;

const NON_LATIN_SPAM_RE = /[\u0400-\u04FF\u0500-\u052F\u2DE0-\u2DFF\uA640-\uA69F\u0600-\u06FF\u0750-\u077F\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/;

// Obvious non-US locations. Intentionally omits words that collide with
// US states/cities (Georgia, Indiana, St. Petersburg).
const FOREIGN_LOCATION_RE =
  /\b(moscow|moskva|russia|russian federation|belarus|kazakhstan|ukraine|kyiv|kiev|odessa|odesa|shanghai|beijing|shenzhen|guangzhou|lagos|karachi|tehran|istanbul|mumbai|delhi|bangkok|hanoi|jakarta|manila|siberia|novosibirsk|yekaterinburg|vladivostok)\b/i;

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  '10minutemail.com',
  '10minutemail.net',
  'discard.email',
  'emailondeck.com',
  'fakeinbox.com',
  'getnada.com',
  'guerrillamail.com',
  'guerrillamailblock.com',
  'mailcatch.com',
  'maildrop.cc',
  'mailinator.com',
  'mailnesia.com',
  'minuteinbox.com',
  'moakt.com',
  'mytemp.email',
  'pokemail.net',
  'sharklasers.com',
  'spam4.me',
  'temp-mail.io',
  'temp-mail.org',
  'tempmail.com',
  'throwawaymail.com',
  'tmpmail.net',
  'tmpmail.org',
  'trash-mail.com',
  'trashmail.com',
  'trashmail.de',
  'yopmail.com',
  'yopmail.fr',
]);

const SUSPICIOUS_URL_TLD_RE =
  /\.(ru|su|cn|xyz|top|click|info|icu|tk|ml|ga|cf|gq|pw|buzz|rest|cfd|shop|online|site|fun|vip|work|live|pro)(?:\/|$|\?|#)/i;

const SPAM_PROMO_RE =
  /\b(iv\s*drip|hangover|casino|crypto|bitcoin|viagra|cialis|seo\b|backlink|guest\s*post|binary\s*options|forex)\b/i;

const ALLOWED_PROJECT_URL_RE =
  /(?:google|googleapis|gstatic|icloud|dropbox|imgur|facebook|fbcdn|instagram|homedepot|lowes|amazon|wayfair|thebathpros)\./i;

function hasNonLatinSpam(text) {
  return NON_LATIN_SPAM_RE.test(text);
}

function hasForeignLocation(...values) {
  return values.some((value) => FOREIGN_LOCATION_RE.test(value || ''));
}

function isDisposableEmail(email) {
  const domain = String(email || '')
    .trim()
    .toLowerCase()
    .split('@')[1];
  if (!domain) return false;
  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) return true;
  const root = domain.split('.').slice(-2).join('.');
  return DISPOSABLE_EMAIL_DOMAINS.has(root);
}

function extractUrls(text) {
  const source = String(text || '');
  const matches = source.match(/https?:\/\/[^\s<>"']+|www\.[^\s<>"']+/gi);
  return matches || [];
}

function looksLikeSpamUrls(details) {
  const urls = extractUrls(details);
  if (urls.length === 0) return false;
  if (urls.length >= 2) return true;
  const url = urls[0];
  if (SUSPICIOUS_URL_TLD_RE.test(url)) return true;
  if (SPAM_PROMO_RE.test(details)) return true;
  if (hasNonLatinSpam(details) || hasForeignLocation(details)) return true;
  if (ALLOWED_PROJECT_URL_RE.test(url)) return false;
  const remainder = String(details || '')
    .replace(/https?:\/\/[^\s<>"']+|www\.[^\s<>"']+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return remainder.length < 20;
}

function isTooFast(input, now) {
  const started = getField(input, 'quote_started');
  if (!/^\d{10,16}$/.test(started)) return false;
  const elapsed = now - Number(started);
  if (Number.isNaN(elapsed)) return false;
  if (elapsed < 0) return Number(started) > now + 60 * 1000;
  return elapsed < MIN_FORM_ELAPSED_MS;
}

function isSpamQuote(input, now = Date.now()) {
  if (isHoneypotTripped(input)) return true;

  const name = getField(input, 'Name');
  const details = getField(input, 'Project Details');
  const city = getField(input, 'City or Town');
  const stateZip = getField(input, 'State and ZIP');
  const address = getField(input, 'Service Address');
  const service = getField(input, 'Service Needed');
  const email = getField(input, 'Email');
  const scanned = [name, details, city, stateZip, address, service].join('\n');

  if (hasNonLatinSpam(scanned)) return true;
  if (hasForeignLocation(city, stateZip, address)) return true;
  if (name.length > MAX_NAME_CHARS || details.length > MAX_DETAILS_CHARS) return true;
  if (address.length > MAX_GENERIC_CHARS || city.length > MAX_GENERIC_CHARS) return true;
  if (looksLikeSpamUrls(details)) return true;
  if (isDisposableEmail(email)) return true;
  if (isTooFast(input, now)) return true;
  return false;
}

async function processQuote(input, options = {}) {
  const now = options.now != null ? options.now : Date.now();
  if (isSpamQuote(input, now)) {
    return { status: 200, body: { success: true }, dropped: true };
  }

  const validationError = validateQuote(input);
  if (validationError) {
    return { status: 400, body: { success: false, message: validationError }, dropped: false };
  }

  const submitFn = options.submit || submitToZoho;
  try {
    const result = await submitFn(buildZohoFields(input));
    if (!result || !result.ok) {
      return {
        status: 502,
        body: { success: false, message: 'Zoho did not accept the lead' },
        dropped: false,
      };
    }
    return { status: 200, body: { success: true }, dropped: false };
  } catch {
    return {
      status: 502,
      body: { success: false, message: 'Could not reach Zoho CRM' },
      dropped: false,
    };
  }
}

function splitName(fullName) {
  const parts = trim(fullName).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: '', last: parts[0].slice(0, 80) };
  const last = parts.pop().slice(0, 80);
  return { first: parts.join(' ').slice(0, 40), last };
}

function normalizeState(raw) {
  const value = trim(raw).replace(/[.,]/g, ' ').replace(/\s+/g, ' ');
  if (!value) return '';
  const lower = value.toLowerCase();
  if (US_STATE_BY_NAME[lower]) return US_STATE_BY_NAME[lower];
  if (/^[a-z]{2}$/i.test(value) && US_STATE_BY_ABBR[value.toUpperCase()]) {
    return US_STATE_BY_ABBR[value.toUpperCase()];
  }
  return '';
}

function parseStateZip(raw) {
  const source = trim(raw);
  if (!source) return { state: '', zip: '', parsed: false, raw: '' };

  const zipMatch = source.match(/\b(\d{5})(?:-\d{4})?\b/);
  const zip = zipMatch ? zipMatch[0] : '';
  const withoutZip = zipMatch ? source.replace(zipMatch[0], ' ') : source;
  const stateToken = withoutZip.replace(/[,\s]+/g, ' ').trim();
  const state = normalizeState(stateToken);

  return {
    state,
    zip,
    parsed: Boolean(state || zip),
    raw: source,
  };
}

function buildDescription(input, parsedStateZip) {
  const service = getField(input, 'Service Needed');
  const details = getField(input, 'Project Details');
  const parts = [`Service Needed: ${service || '(not specified)'}`];
  parts.push('', `Project Details: ${details || '(none)'}`);
  if (parsedStateZip.raw && (!parsedStateZip.state || !parsedStateZip.zip)) {
    parts.push('', `State and ZIP (as entered): ${parsedStateZip.raw}`);
  }
  return parts.join('\n');
}

function validateQuote(input) {
  const required = [
    ['Name', 'Name'],
    ['Phone', 'Phone'],
    ['Email', 'Email'],
    ['Service Address', 'Service Address'],
    ['City or Town', 'City or Town'],
    ['State and ZIP', 'State and ZIP'],
    ['Service Needed', 'Service Needed'],
  ];
  for (const [field, label] of required) {
    if (!getField(input, field)) {
      return `${label} is required.`;
    }
  }
  const email = getField(input, 'Email');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'Please enter a valid email address.';
  }
  return '';
}

function buildZohoFields(input) {
  const name = splitName(getField(input, 'Name'));
  const parsed = parseStateZip(getField(input, 'State and ZIP'));
  const fields = {
    ...ZOHO_HIDDEN,
    Company: 'Residential',
    'Last Name': name.last,
    'First Name': name.first,
    Email: getField(input, 'Email').slice(0, 100),
    Phone: getField(input, 'Phone').slice(0, 30),
    'Address - Street Address': getField(input, 'Service Address').slice(0, 255),
    'Address - City': getField(input, 'City or Town').slice(0, 255),
    Description: buildDescription(input, parsed),
  };
  if (parsed.state) fields['Address - State / Province'] = parsed.state;
  if (parsed.zip) fields['Address - Zip / Postal Code'] = parsed.zip.slice(0, 255);
  return fields;
}

function encodeFormBody(fields) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    params.append(key, value == null ? '' : String(value));
  }
  return params.toString();
}

function isZohoSuccess(status, location, body) {
  if (status >= 400) return false;
  const haystack = `${location || ''}\n${body || ''}`;
  if (/wf_thankyoumessage|submitted successfully|thank you for submitting/i.test(haystack)) {
    return true;
  }
  if (location && /thebathpros\.net/i.test(location)) return true;
  if ((status === 301 || status === 302 || status === 303 || status === 307) && location) {
    return true;
  }
  return false;
}

async function submitToZoho(fields, fetchImpl) {
  const fetchFn = fetchImpl || fetch;
  const response = await fetchFn(ZOHO_WEBFORM_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      Accept: 'text/html,application/xhtml+xml',
      Origin: 'https://www.thebathpros.net',
      Referer: RETURN_URL,
    },
    body: encodeFormBody(fields),
    redirect: 'manual',
  });

  const location = response.headers.get('location') || '';
  let body = '';
  try {
    body = await response.text();
  } catch {
    body = '';
  }

  return {
    ok: isZohoSuccess(response.status, location, body),
    status: response.status,
    location,
  };
}

module.exports = {
  ZOHO_WEBFORM_URL,
  RETURN_URL,
  ZOHO_HIDDEN,
  US_STATE_BY_ABBR,
  MIN_FORM_ELAPSED_MS,
  getField,
  isHoneypotTripped,
  isSpamQuote,
  processQuote,
  hasNonLatinSpam,
  looksLikeSpamUrls,
  isDisposableEmail,
  splitName,
  normalizeState,
  parseStateZip,
  buildDescription,
  validateQuote,
  buildZohoFields,
  encodeFormBody,
  isZohoSuccess,
  submitToZoho,
};
