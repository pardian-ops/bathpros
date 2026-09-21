'use strict';

const { processQuote } = require('../lib/zoho-quote');

function setCors(req, res) {
  const origin = req.headers.origin || '';
  const allowed =
    !origin ||
    /^(https:\/\/([a-z0-9-]+\.)?thebathpros\.net|https:\/\/[a-z0-9-]+\.vercel\.app|http:\/\/localhost(?::\d+)?|http:\/\/127\.0\.0\.1(?::\d+)?)$/i.test(
      origin
    );
  if (allowed && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  let raw = '';
  if (typeof req.body === 'string') {
    raw = req.body;
  } else if (Buffer.isBuffer(req.body)) {
    raw = req.body.toString('utf8');
  } else if (typeof req.on === 'function' && req.readable !== false) {
    raw = await readRawBody(req);
  }

  raw = raw.trim();
  if (!raw) return {};

  const contentType = String(req.headers['content-type'] || '');
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  return JSON.parse(raw);
}

async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ success: false, message: 'Method not allowed' }));
    return;
  }

  let input;
  try {
    input = await readBody(req);
  } catch {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ success: false, message: 'Invalid request body' }));
    return;
  }

  // Spam (honeypot, Cyrillic/non-Latin, foreign location, disposable
  // email, spam URLs, too-fast submit) is silently dropped: same
  // { success: true } JSON as a real Lead, and Zoho is not called.
  const result = await processQuote(input);
  if (result.dropped) {
    console.info('quote dropped as spam');
  } else if (result.status >= 500) {
    console.error('quote submit failed', result.body && result.body.message);
  }
  res.statusCode = result.status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(result.body));
}

module.exports = handler;
