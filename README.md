# @lp-labs/certificate-designer

Creates real SVG certificates from named record bindings, with HTML/XML-safe text output and bounded sequential batches. QR integration is optional and injected; the package never generates substitute or fake QR content.

## Install and quickstart

```sh
npm install @lp-labs/certificate-designer
```

```js
import assert from 'node:assert/strict';
import { generateCertificates } from '@lp-labs/certificate-designer';

const certificates = await generateCertificates(
  {
    width: 800,
    height: 600,
    title: 'Certificate for {{recipient}}',
    lines: ['Awarded for {{achievement}}'],
  },
  [{ id: 'award-1', recipient: 'Jordan Lee', achievement: 'Service' }],
);
assert.equal(certificates[0].id, 'award-1');
assert.ok(certificates[0].svg.includes('Certificate for Jordan Lee'));
```

## API and types

- `generateCertificates(template, records, options?): Promise<readonly CertificateOutput[]>` snapshots named string records, produces one SVG per record, and optionally inserts injected PNG bytes as a data URI.
- `CertificateError` exposes `code: 'invalid' | 'capacity' | 'unsupported' | 'adapter' | 'cancelled'`; injected generator errors are preserved as `cause`.
- `CertificateTemplate`: pixel `width`/`height`, `title`, ordered `lines`, optional record field `qrField`.
- `CertificateRecord`: required unique nonempty `id` and own string-valued fields. Named placeholders use `{{fieldName}}` syntax.
- `QrGenerator`: `(payload, signal?) => Promise<{ mediaType: 'image/png'; data: Uint8Array }>`; the payload is the configured record field value.
- `CertificateLimits`: `maxRecords`, `maxFields`, `maxInputBytes`, `maxLines`, `maxTextLength`, cumulative batch `maxOutputBytes`, and `maxQrBytes`.
- `CertificateOutput`: record `id` and generated SVG string.

Only names actually present in a record can be interpolated. Unknown/malformed bindings fail the whole call; values are escaped as SVG text. Records must be plain own-data string records; getters, symbols, duplicate IDs, missing fields, and inherited custom prototypes are rejected. Output is returned only after all records complete; external QR calls already made cannot be rolled back if a later record fails.

## Customize, errors, and limits

Author a fixed title and line layout with named placeholders; provide one record per personalized certificate. A template with `qrField` requires a `qrGenerator` and that field in every record. QR output must be nonempty PNG bytes and is embedded exactly as returned; this package does not generate, decode, validate, sign, or guarantee a QR code. Verify QR image validity and payload/privacy requirements in the injected provider and downstream print workflow.

Defaults: 500 records, 100 fields per record, 5,000,000 total input bytes, 50 lines per certificate, 2,000 characters per text field, 2,000,000 UTF-8 output bytes for the full batch, and 250,000 QR bytes per record. Hard ceilings are 5,000 records, 1,000 fields per record, 50,000,000 input bytes, 200 lines, 10,000 characters, 20,000,000 output bytes and 2,000,000 QR bytes. Dimensions must be 100–10,000 pixels; template lines must fit the declared height. QR layouts also require at least 400×400 pixels and reserve the lower-right area. Limits can be lowered. The full template and supplied record data are validated before invoking external QR calls. Malformed input and missing bindings use `invalid`; bounded overflow uses `capacity`; missing QR integration uses `unsupported`; invalid/failed QR output uses `adapter`; abort uses `cancelled`.

SVG text uses system serif fallback and is not embedded-font typography. There is no PDF, mail-merge CSV parser, signing, record persistence, print calibration, or certificate authenticity guarantee. Parse and validate CSV in your application, and protect personal data and QR payloads according to your requirements.

## Performance

Template/record binding scales with total bounded field text and each certificate's SVG output. QR generators run sequentially—one call per record—to keep memory predictable; adapter latency therefore adds across the batch. Batch input, record counts, QR bytes, and cumulative output each have limits.

## Modules and development

Independent ESM/CJS and declarations, no runtime or peer dependencies. CommonJS: `const { generateCertificates } = require('@lp-labs/certificate-designer')`. TypeScript `^5.9.3` and Prettier `^3.6.2` are development-only.

```sh
npm ci --offline
npm run build
npm run typecheck
npm test
npm run format:check
```

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
