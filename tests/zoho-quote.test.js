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
  isZohoSuccess,
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
});

test('detects Zoho thank-you HTML as success', () => {
  const body =
    '<div id="wf_thankyoumessage"><b>Thank you for submitting your response.</b></div>';
  assert.equal(isZohoSuccess(200, '', body), true);
  assert.equal(isZohoSuccess(302, 'https://www.thebathpros.net/#quote', ''), true);
  assert.equal(isZohoSuccess(500, '', body), false);
  assert.equal(isZohoSuccess(200, '', '<html>cannot be empty</html>'), false);
});
