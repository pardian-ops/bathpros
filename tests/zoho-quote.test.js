'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  splitName,
  parseStateZip,
  normalizeState,
  buildZohoFields,
  validateQuote,
  isHoneypotTripped,
  isSpamQuote,
  isZohoSuccess,
  MIN_FORM_ELAPSED_MS,
  ZOHO_HIDDEN,
} = require('../lib/zoho-quote');

const sample = {
  Name: 'Jane Q Public',
  Phone: '(508) 348-9615',
  Email: 'jane@example.com',
  'Service Address': '12 Main St',
  'City or Town': 'Worcester',
  'State and ZIP': 'MA 01601',
  'Service Needed': 'Bathtub reglazing',
  'Project Details': 'Cast iron tub, chips on the overflow.',
};

test('splits a full name into first and last', () => {
  assert.deepEqual(splitName('Jane Q Public'), { first: 'Jane Q', last: 'Public' });
  assert.deepEqual(splitName('Cher'), { first: '', last: 'Cher' });
});

test('parses common State and ZIP formats', () => {
  assert.deepEqual(parseStateZip('MA 01601'), {
    state: 'Massachusetts',
    zip: '01601',
    parsed: true,
    raw: 'MA 01601',
  });
  assert.equal(parseStateZip('Massachusetts, 01601-1234').zip, '01601-1234');
  assert.equal(parseStateZip('FL 33401').state, 'Florida (United States)');
  assert.equal(parseStateZip('01608').zip, '01608');
  assert.equal(parseStateZip('01608').state, '');
});

test('maps US abbreviations to Zoho picklist labels', () => {
  assert.equal(normalizeState('ma'), 'Massachusetts');
  assert.equal(normalizeState('Florida'), 'Florida (United States)');
  assert.equal(normalizeState('Montana'), 'Montana (United States)');
  assert.equal(normalizeState('Narnia'), '');
});

test('builds Zoho webform fields with hidden digests and required Company', () => {
  const fields = buildZohoFields(sample);
  assert.equal(fields.xnQsjsdp, ZOHO_HIDDEN.xnQsjsdp);
  assert.equal(fields.xmIwtLD, ZOHO_HIDDEN.xmIwtLD);
  assert.equal(fields.actionType, 'TGVhZHM=');
  assert.equal(fields.zc_gad, '');
  assert.equal(fields.aG9uZXlwb3Q, '');
  assert.equal(fields.returnURL, 'https://www.thebathpros.net/#quote');
  assert.equal(fields.Company, 'Residential');
  assert.equal(fields['Last Name'], 'Public');
  assert.equal(fields['First Name'], 'Jane Q');
  assert.equal(fields.Email, 'jane@example.com');
  assert.equal(fields.Phone, '(508) 348-9615');
  assert.equal(fields['Address - Street Address'], '12 Main St');
  assert.equal(fields['Address - City'], 'Worcester');
  assert.equal(fields['Address - State / Province'], 'Massachusetts');
  assert.equal(fields['Address - Zip / Postal Code'], '01601');
  assert.match(fields.Description, /Service Needed: Bathtub reglazing/);
  assert.match(fields.Description, /Project Details: Cast iron tub/);
  assert.equal(fields.access_key, undefined);
  assert.equal(fields.subject, undefined);
  assert.equal(fields.from_name, undefined);
});

test('keeps unparsed State and ZIP in Description', () => {
  const fields = buildZohoFields({
    ...sample,
    'State and ZIP': 'Greater Boston corridor',
  });
  assert.equal(fields['Address - State / Province'], undefined);
  assert.match(fields.Description, /State and ZIP \(as entered\): Greater Boston corridor/);
});

test('validates required site fields', () => {
  assert.equal(validateQuote(sample), '');
  assert.match(validateQuote({ ...sample, Name: '' }), /Name is required/);
  assert.match(validateQuote({ ...sample, Email: 'not-an-email' }), /valid email/);
});

test('treats filled honeypots as bots', () => {
  assert.equal(isHoneypotTripped(sample), false);
  assert.equal(isHoneypotTripped({ ...sample, botcheck: 'on' }), true);
  assert.equal(isHoneypotTripped({ ...sample, aG9uZXlwb3Q: 'spam' }), true);
  assert.equal(isHoneypotTripped({ ...sample, website: 'https://spam.test' }), true);
});

test('detects Zoho thank-you HTML as success', () => {
  const body =
    '<div id="wf_thankyoumessage"><b>Thank you for submitting your response.</b></div>';
  assert.equal(isZohoSuccess(200, '', body), true);
  assert.equal(isZohoSuccess(302, 'https://www.thebathpros.net/#quote', ''), true);
  assert.equal(isZohoSuccess(500, '', body), false);
  assert.equal(isZohoSuccess(200, '', '<html>cannot be empty</html>'), false);
});

const knownSpam = {
  Name: 'Kapelnica ot / pohmelya_tjel',
  Phone: '+7 495 000 0000',
  Email: 'ustgiekkkel@savmask.com',
  'Service Address': 'Lenina 1',
  'City or Town': 'Moscow',
  'State and ZIP': 'Russia',
  'Service Needed': 'Bathtub reglazing',
  'Project Details':
    'Капельница от похмелья на дому. IV drip. Заказать: https://pohmelye-spam.ru/kapelnica',
};

test('flags the known Cyrillic Moscow SEO spam pattern', () => {
  assert.equal(isSpamQuote(knownSpam), true);
  assert.equal(isSpamQuote({ ...knownSpam, 'Project Details': '' }), true);
  assert.equal(validateQuote(sample), '');
  assert.equal(isSpamQuote(sample), false);
});

test('allows a normal Worcester / MA bathtub reglazing quote', () => {
  const worcester = {
    ...sample,
    Name: 'Alex Rivera',
    Email: 'alex.rivera@gmail.com',
    'Service Address': '40 Quote Form Rd',
    'City or Town': 'Worcester',
    'State and ZIP': 'MA 01609',
    'Service Needed': 'Bathtub reglazing',
    'Project Details': 'Cast iron tub, chips near the overflow. Looking for white.',
    quote_started: String(Date.now() - 8000),
  };
  assert.equal(validateQuote(worcester), '');
  assert.equal(isSpamQuote(worcester), false);
});

test('allows accented Latin names and nearby New England towns', () => {
  assert.equal(
    isSpamQuote({
      ...sample,
      Name: 'José García',
      'City or Town': 'Framingham',
      'State and ZIP': 'MA 01701',
      'Project Details': 'Need the tub refinished before we list the house.',
    }),
    false
  );
  assert.equal(
    isSpamQuote({
      ...sample,
      'City or Town': 'Providence',
      'State and ZIP': 'RI 02903',
    }),
    false
  );
});

test('flags non-Latin copy, disposable email, long text, and too-fast submits', () => {
  assert.equal(
    isSpamQuote({ ...sample, 'Project Details': 'Please reglaze 浴缸 soon' }),
    true
  );
  assert.equal(isSpamQuote({ ...sample, Email: 'bot@mailinator.com' }), true);
  assert.equal(isSpamQuote({ ...sample, 'Project Details': 'x'.repeat(2001) }), true);
  assert.equal(
    isSpamQuote(
      { ...sample, quote_started: String(1_700_000_000_000) },
      1_700_000_000_000 + MIN_FORM_ELAPSED_MS - 1
    ),
    true
  );
  assert.equal(
    isSpamQuote(
      { ...sample, quote_started: String(1_700_000_000_000) },
      1_700_000_000_000 + 8_000
    ),
    false
  );
  assert.equal(
    isSpamQuote(
      { ...sample, quote_started: String(1_700_000_000_000) },
      1_700_000_000_000 + 36 * 60 * 60 * 1000
    ),
    false
  );
});

test('treats promotional or suspicious URLs in project details as spam', () => {
  assert.equal(
    isSpamQuote({
      ...sample,
      'Project Details': 'Hangover IV drip special https://promo.xyz/iv',
    }),
    true
  );
  assert.equal(
    isSpamQuote({
      ...sample,
      'Project Details': 'Photo of the chips: https://photos.google.com/share/tub',
    }),
    false
  );
});
