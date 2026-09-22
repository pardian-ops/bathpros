'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { processQuote, buildWeb3FormsFields, WEB3FORMS_URL } = require('../lib/quote');
const handler = require('../api/quote');

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

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(payload) {
      this.body = payload || '';
    },
  };
}

test('/api/quote drops known spam and returns no Web3Forms payload', async () => {
  const result = await processQuote(knownSpam);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { success: true });
  assert.equal(result.dropped, true);
  assert.equal(result.body.deliver, undefined);
});

test('/api/quote returns a Web3Forms payload for a Worcester MA bathtub quote', async () => {
  const result = await processQuote(worcester);
  assert.equal(result.status, 200);
  assert.equal(result.dropped, false);
  assert.deepEqual(result.body.deliver, buildWeb3FormsFields(worcester));
  const fields = result.body.deliver;
  assert.equal(fields.access_key, 'be5f5cdc-60b2-4961-9cf2-901bfe8a9e63');
  assert.equal(fields.subject, 'New Free Estimate Request - The Bath Pros');
  assert.equal(fields.from_name, 'The Bath Pros Website');
  assert.equal(fields['City or Town'], 'Worcester');
  assert.equal(fields['State and ZIP'], 'MA 01609');
  assert.equal(fields['Service Needed'], 'Bathtub reglazing');
  assert.equal(fields.quote_started, undefined);
  assert.equal(fields.xnQsjsdp, undefined);
});

test('/api/quote honeypot and too-fast posts are silent drops', async () => {
  const honeypot = await processQuote({ ...worcester, website: 'http://bot' });
  const fast = await processQuote(
    { ...worcester, quote_started: String(1_700_000_000_000) },
    { now: 1_700_000_000_400 }
  );
  assert.equal(honeypot.dropped, true);
  assert.equal(honeypot.body.deliver, undefined);
  assert.equal(fast.dropped, true);
  assert.equal(fast.body.deliver, undefined);
});

test('/api/quote missing required fields still return 400 and skip Web3Forms', async () => {
  const result = await processQuote({ ...worcester, Name: '' });
  assert.equal(result.status, 400);
  assert.equal(result.body.success, false);
  assert.match(result.body.message, /Name is required/);
  assert.equal(result.body.deliver, undefined);
});

test('POST /api/quote handler returns a browser payload and does not call fetch', async () => {
  const original = global.fetch;
  let called = 0;
  global.fetch = async () => {
    called += 1;
    throw new Error('server must not POST to Web3Forms');
  };
  try {
    const req = {
      method: 'POST',
      headers: {
        origin: 'https://www.thebathpros.net',
        'content-type': 'application/json',
      },
      body: worcester,
    };
    const res = mockRes();
    await handler(req, res);
    assert.equal(called, 0);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://www.thebathpros.net');
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.equal(body.deliver.access_key, 'be5f5cdc-60b2-4961-9cf2-901bfe8a9e63');
    assert.equal(body.deliver.Name, 'Alex Rivera');
    assert.equal(body.deliver['Service Address'], '40 Quote Form Rd');
    assert.equal(body.deliver['State and ZIP'], 'MA 01609');
    assert.equal(body.deliver.quote_started, undefined);
    assert.equal(body.deliver.subject, 'New Free Estimate Request - The Bath Pros');
  } finally {
    global.fetch = original;
  }
});

test('POST /api/quote handler omits the Web3Forms payload for spam', async () => {
  const res = mockRes();
  await handler(
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: knownSpam,
    },
    res
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { success: true });
});

test('quote submit path has no Zoho CRM endpoint or form credentials', () => {
  const files = ['api/quote.js', 'lib/quote.js', 'index.html', 'index-3.html'];
  const banned = [/crm\.zoho\.com/i, /WebToLead/i, /xnQsjsdp/, /xmIwtLD/, /\bZoho\b/];
  for (const file of files) {
    const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    for (const pattern of banned) {
      assert.equal(pattern.test(text), false, `${file} matched ${pattern}`);
    }
  }
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'lib/zoho-quote.js')), false);
});

test('public pages keep PageSense and send accepted quotes to Web3Forms from the browser', () => {
  const fieldNames = [
    'Name',
    'Phone',
    'Email',
    'Service Address',
    'City or Town',
    'State and ZIP',
    'Service Needed',
    'Project Details',
  ];
  for (const file of ['index.html', 'index-3.html']) {
    const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.match(
      text,
      /<script src="https:\/\/cdn\.pagesense\.io\/js\/940040282\/23a7b45813264bdcbd8d5014ffaa6a67\.js"><\/script>/
    );
    assert.match(text, /fetch\('\/api\/quote'/);
    assert.match(text, /fetch\('https:\/\/api\.web3forms\.com\/submit'/);
    assert.equal(text.includes(WEB3FORMS_URL), true);
    const scriptAt = text.indexOf("document.getElementById('quoteForm')");
    const script = text.slice(scriptAt, text.indexOf('</script>', scriptAt));
    assert.match(script, /res\.deliver/);
    assert.equal(/crm\.zoho|WebToLead|access_key/.test(script), false);
    for (const name of fieldNames) {
      assert.equal(text.includes(`name="${name}"`), true, `${file} missing ${name}`);
    }
  }
});
