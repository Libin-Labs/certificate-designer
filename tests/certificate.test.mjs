import test from 'node:test';
import assert from 'node:assert/strict';
import { CertificateError, generateCertificates } from '../dist/esm/index.js';

const template = {
  width: 800,
  height: 600,
  title: 'Certificate for {{recipient}}',
  lines: ['Awarded to {{recipient}}', 'For {{achievement}}'],
};
const records = [
  { id: 'award-1', recipient: 'A & B <script>', achievement: 'Excellence' },
  { id: 'award-2', recipient: 'Casey', achievement: 'Service' },
];

test('generates actual SVG for every named record and escapes interpolated content', async () => {
  const output = await generateCertificates(template, records);
  assert.deepEqual(
    output.map((item) => item.id),
    ['award-1', 'award-2'],
  );
  assert.equal(output.length, 2);
  assert.ok(output[0].svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(output[0].svg.includes('Certificate for A &amp; B &lt;script&gt;'));
  assert.ok(output[0].svg.includes('Awarded to A &amp; B &lt;script&gt;'));
  assert.ok(!output[0].svg.includes('<script>'));
  assert.ok(Object.isFrozen(output));
  assert.ok(Object.isFrozen(output[0]));
});

test('injects actual QR PNG bytes and never invents QR images', async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 1, 2]);
  const seen = [];
  const output = await generateCertificates(
    { ...template, qrField: 'verifyUrl' },
    records.map((record, index) => ({ ...record, verifyUrl: `https://example.test/${index}` })),
    {
      qrGenerator: async (payload) => {
        seen.push(payload);
        return { mediaType: 'image/png', data: bytes };
      },
    },
  );
  assert.deepEqual(seen, ['https://example.test/0', 'https://example.test/1']);
  assert.ok(output[0].svg.includes('href="data:image/png;base64,iVBORwEC"'));
  assert.ok(output[1].svg.includes('aria-label="Certificate QR code"'));
});

test('validates bindings and record properties without executing getters', async () => {
  await assert.rejects(generateCertificates(template, records, null), { code: 'invalid' });
  await assert.rejects(generateCertificates(template, [{ id: 'missing' }]), { code: 'invalid' });
  await assert.rejects(
    generateCertificates({ ...template, title: 'Broken {{bad name}}' }, records),
    { code: 'invalid' },
  );
  const getter = { id: 'getter', recipient: 'x', achievement: 'y' };
  Object.defineProperty(getter, 'recipient', { get: () => 'not safe' });
  await assert.rejects(generateCertificates(template, [getter]), { code: 'invalid' });
  await assert.rejects(
    generateCertificates(template, [{ id: 'bad\u0000id', recipient: 'A', achievement: 'B' }]),
    { code: 'invalid' },
  );
  await assert.rejects(generateCertificates(template, new Array(1)), { code: 'invalid' });
  await assert.rejects(generateCertificates({ ...template, lines: new Array(1) }, records), {
    code: 'invalid',
  });
});

test('bounds batch, text, dimensions, QR result, and total output', async () => {
  await assert.rejects(generateCertificates(template, records, { maxRecords: 1 }), {
    code: 'capacity',
  });
  await assert.rejects(generateCertificates({ ...template, width: 99 }, records), CertificateError);
  await assert.rejects(
    generateCertificates(template, [{ id: 'x', recipient: 'long', achievement: 'x' }], {
      maxTextLength: 2,
    }),
    CertificateError,
  );
  await assert.rejects(
    generateCertificates(
      { ...template, qrField: 'verifyUrl' },
      [{ id: 'x', recipient: 'a', achievement: 'b', verifyUrl: 'payload' }],
      {
        maxQrBytes: 1,
        qrGenerator: async () => ({ mediaType: 'image/png', data: new Uint8Array([1, 2]) }),
      },
    ),
    { code: 'capacity' },
  );
  await assert.rejects(generateCertificates(template, records, { maxOutputBytes: 1 }), {
    code: 'capacity',
  });
  await assert.rejects(
    generateCertificates(template, [{ id: 'x', recipient: 'a', achievement: 'b', extra: 'x' }], {
      maxFields: 3,
    }),
    { code: 'capacity' },
  );
  await assert.rejects(generateCertificates(template, records, { maxInputBytes: 1 }), {
    code: 'capacity',
  });
  await assert.rejects(
    generateCertificates({ ...template, qrField: 'verifyUrl', height: 300 }, records),
    { code: 'invalid' },
  );
});

test('requires a QR adapter, rejects fake/malformed results, and surfaces generator failure', async () => {
  const qrTemplate = { ...template, qrField: 'verifyUrl' };
  const batch = [{ id: 'x', recipient: 'a', achievement: 'b', verifyUrl: 'payload' }];
  await assert.rejects(generateCertificates(qrTemplate, batch), { code: 'unsupported' });
  for (const qrGenerator of [
    async () => ({ mediaType: 'image/jpeg', data: new Uint8Array([1]) }),
    async () => ({ mediaType: 'image/png', data: new Uint8Array() }),
    async () => null,
    async () => {
      throw Error('QR provider');
    },
  ]) {
    await assert.rejects(
      generateCertificates(qrTemplate, batch, { qrGenerator }),
      (error) => error instanceof CertificateError && ['adapter'].includes(error.code),
    );
  }
});

test('cancellation is checked between asynchronous QR jobs', async () => {
  const controller = new AbortController();
  await assert.rejects(
    generateCertificates(
      { ...template, qrField: 'verifyUrl' },
      [{ id: 'x', recipient: 'a', achievement: 'b', verifyUrl: 'payload' }],
      {
        signal: controller.signal,
        qrGenerator: async () => {
          controller.abort();
          return { mediaType: 'image/png', data: new Uint8Array([1]) };
        },
      },
    ),
    { code: 'cancelled' },
  );
});

test('validates every binding before invoking an injected QR provider', async () => {
  let calls = 0;
  await assert.rejects(
    generateCertificates(
      { ...template, qrField: 'verify' },
      [
        { id: 'first', recipient: 'A', achievement: 'B', verify: 'ok' },
        { id: 'second', recipient: 'A', verify: 'missing-achievement' },
      ],
      {
        qrGenerator: async () => {
          calls += 1;
          return { mediaType: 'image/png', data: new Uint8Array([1]) };
        },
      },
    ),
    { code: 'invalid' },
  );
  assert.equal(calls, 0);
});
