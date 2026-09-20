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
  return Boolean(getField(input, 'aG9uZXlwb3Q'));
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
  getField,
  isHoneypotTripped,
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
