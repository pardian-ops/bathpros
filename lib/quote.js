'use strict';

const WEB3FORMS_URL = 'https://api.web3forms.com/submit';
const WEB3FORMS_ACCESS_KEY = 'be5f5cdc-60b2-4961-9cf2-901bfe8a9e63';
const WEB3FORMS_SUBJECT = 'New Free Estimate Request - The Bath Pros';
const WEB3FORMS_FROM_NAME = 'The Bath Pros Website';

const QUOTE_FIELDS = [
  'Name',
  'Phone',
  'Email',
  'Service Address',
  'City or Town',
  'State and ZIP',
  'Service Needed',
  'Project Details',
];

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
// response as a real submission so bots cannot probe the filter. Nothing
// is forwarded to Web3Forms. Incomplete required fields still return 400.
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

function buildWeb3FormsFields(input) {
  const fields = {
    access_key: WEB3FORMS_ACCESS_KEY,
    subject: WEB3FORMS_SUBJECT,
    from_name: WEB3FORMS_FROM_NAME,
  };
  for (const name of QUOTE_FIELDS) {
    fields[name] = getField(input, name);
  }
  return fields;
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

  // Web3Forms free-plan API rejects server-side POSTs (HTTP 403 unless a
  // Pro plan allowlists the server IP). Vercel cannot deliver the lead.
  // Return the payload so the visitor's browser can POST it instead.
  return {
    status: 200,
    body: { success: true, deliver: buildWeb3FormsFields(input) },
    dropped: false,
  };
}

module.exports = {
  WEB3FORMS_URL,
  WEB3FORMS_ACCESS_KEY,
  WEB3FORMS_SUBJECT,
  WEB3FORMS_FROM_NAME,
  QUOTE_FIELDS,
  MIN_FORM_ELAPSED_MS,
  getField,
  isHoneypotTripped,
  isSpamQuote,
  processQuote,
  hasNonLatinSpam,
  looksLikeSpamUrls,
  isDisposableEmail,
  validateQuote,
  buildWeb3FormsFields,
};
