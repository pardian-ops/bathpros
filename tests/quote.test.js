'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateQuote,
  isHoneypotTripped,
  isSpamQuote,
  buildWeb3FormsFields,
  processQuote,
  MIN_FORM_ELAPSED_MS,
  WEB3FORMS_URL,
  WEB3FORMS_ACCESS_KEY,
  WEB3FORMS_SUBJECT,
  WEB3FORMS_FROM_NAME,
} = require('../lib/quote');

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

test('builds a Web3Forms payload with the public access key and form fields', () => {
  const fields = buildWeb3FormsFields({
    ...sample,
    website: 'https://spam.example',
    botcheck: '',
    quote_started: '1700000000000',
    xnQsjsdp: 'must-not-forward',
  });
  assert.equal(fields.access_key, WEB3FORMS_ACCESS_KEY);
  assert.equal(fields.access_key, 'be5f5cdc-60b2-4961-9cf2-901bfe8a9e63');
  assert.equal(fields.subject, WEB3FORMS_SUBJECT);
  assert.equal(fields.subject, 'New Free Estimate Request - The Bath Pros');
  assert.equal(fields.from_name, WEB3FORMS_FROM_NAME);
  assert.equal(fields.from_name, 'The Bath Pros Website');
  assert.equal(fields.Name, 'Jane Q Public');
  assert.equal(fields.Phone, '(508) 348-9615');
  assert.equal(fields.Email, 'jane@example.com');
  assert.equal(fields['Service Address'], '12 Main St');
  assert.equal(fields['City or Town'], 'Worcester');
  assert.equal(fields['State and ZIP'], 'MA 01601');
  assert.equal(fields['Service Needed'], 'Bathtub reglazing');
  assert.equal(fields['Project Details'], 'Cast iron tub, chips on the overflow.');
  assert.equal(fields.website, undefined);
  assert.equal(fields.botcheck, undefined);
  assert.equal(fields.quote_started, undefined);
  assert.equal(fields.xnQsjsdp, undefined);
  assert.equal(fields.Company, undefined);
});

test('returns a browser deliver payload and does not call Web3Forms itself', async () => {
  const original = global.fetch;
  let called = 0;
  global.fetch = async () => {
    called += 1;
    throw new Error('server must not POST to Web3Forms');
  };
  try {
    const result = await processQuote(sample);
    assert.equal(result.status, 200);
    assert.equal(result.dropped, false);
    assert.equal(called, 0);
    assert.equal(result.body.success, true);
    assert.equal(result.body.deliver.access_key, WEB3FORMS_ACCESS_KEY);
    assert.equal(result.body.deliver.subject, WEB3FORMS_SUBJECT);
    assert.equal(result.body.deliver['State and ZIP'], 'MA 01601');
    assert.equal(WEB3FORMS_URL, 'https://api.web3forms.com/submit');
  } finally {
    global.fetch = original;
  }
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
