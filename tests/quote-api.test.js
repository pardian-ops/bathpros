'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { processQuote, buildZohoFields } = require('../lib/zoho-quote');

const worcester = {
  Name: 'Alex Rivera',
  Phone: '(508) 348-9615',
  Email: 'alex.rivera@gmail.com',
  'Service Address': '40 Quote Form Rd',
  'City or Town': 'Worcester',
  'State and ZIP': 'MA 01609',
  'Service Needed': 'Bathtub reglazing',
  'Project Details': 'Cast iron tub, chips near the overflow. Looking for white.',
  quote_started: String(Date.now() - 8000),
};

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

test('/api/quote drops known spam and never creates a Zoho lead', async () => {
  let called = 0;
  const result = await processQuote(knownSpam, {
    submit: async () => {
      called += 1;
      return { ok: true, status: 200 };
    },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { success: true });
  assert.equal(result.dropped, true);
  assert.equal(called, 0);
});

test('/api/quote still submits a Worcester MA bathtub quote to Zoho', async () => {
  let fields;
  const result = await processQuote(worcester, {
    submit: async (payload) => {
      fields = payload;
      return { ok: true, status: 200 };
    },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { success: true });
  assert.equal(result.dropped, false);
  assert.equal(fields['Address - City'], 'Worcester');
  assert.equal(fields['Address - State / Province'], 'Massachusetts');
  assert.equal(fields['Address - Zip / Postal Code'], '01609');
  assert.match(fields.Description, /Bathtub reglazing/);
  assert.deepEqual(fields.xnQsjsdp, buildZohoFields(worcester).xnQsjsdp);
});

test('/api/quote honeypot and too-fast posts are silent drops', async () => {
  let called = 0;
  const submit = async () => {
    called += 1;
    return { ok: true, status: 200 };
  };
  const honeypot = await processQuote({ ...worcester, website: 'http://bot' }, { submit });
  const fast = await processQuote(
    { ...worcester, quote_started: String(1_700_000_000_000) },
    { submit, now: 1_700_000_000_400 }
  );
  assert.equal(honeypot.dropped, true);
  assert.equal(fast.dropped, true);
  assert.equal(called, 0);
});

test('/api/quote missing required fields still return 400 and skip Zoho', async () => {
  let called = 0;
  const result = await processQuote(
    { ...worcester, Name: '' },
    {
      submit: async () => {
        called += 1;
        return { ok: true, status: 200 };
      },
    }
  );
  assert.equal(result.status, 400);
  assert.equal(result.body.success, false);
  assert.match(result.body.message, /Name is required/);
  assert.equal(called, 0);
});
