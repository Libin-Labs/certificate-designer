export interface CertificateRecord {
  readonly id: string;
  readonly [field: string]: string;
}

export interface CertificateTemplate {
  readonly width: number;
  readonly height: number;
  readonly title: string;
  readonly lines: readonly string[];
  readonly qrField?: string;
}

export type QrGenerator = (
  payload: string,
  signal?: AbortSignal,
) => Promise<{ readonly mediaType: 'image/png'; readonly data: Uint8Array }>;

export interface CertificateLimits {
  readonly maxRecords?: number;
  readonly maxFields?: number;
  readonly maxInputBytes?: number;
  readonly maxLines?: number;
  readonly maxTextLength?: number;
  readonly maxOutputBytes?: number;
  readonly maxQrBytes?: number;
}

export interface CertificateOutput {
  readonly id: string;
  readonly svg: string;
}

export class CertificateError extends Error {
  constructor(
    readonly code: 'invalid' | 'capacity' | 'unsupported' | 'adapter' | 'cancelled',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CertificateError';
  }
}

function limit(
  value: number | undefined,
  fallback: number,
  ceiling: number,
  field: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > ceiling)
    throw new CertificateError('invalid', `${field} must be an integer in 1..${ceiling}.`);
  return resolved;
}

function dimension(value: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 100 || value > 10_000)
    throw new CertificateError('invalid', `${field} must be finite in 100..10,000.`);
  return value;
}

function plainText(value: string, field: string, maxLength: number): string {
  if (
    typeof value !== 'string' ||
    value.length > maxLength ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  )
    throw new CertificateError(
      'invalid',
      `${field} must be plain text up to ${maxLength} characters.`,
    );
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (point === 0xfffe || point === 0xffff)
      throw new CertificateError('invalid', `${field} contains an invalid XML character.`);
  }
  return value;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&apos;';
    }
  });
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    const chunk = bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function ownStringRecord(
  input: CertificateRecord,
  maxTextLength: number,
  maxFields: number,
): Readonly<Record<string, string>> {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Object.getOwnPropertySymbols(input).length
  )
    throw new CertificateError('invalid', 'Each certificate record must be a plain string record.');
  const fields = Object.getOwnPropertyNames(input);
  if (fields.length > maxFields)
    throw new CertificateError('capacity', 'Certificate record field capacity exceeded.');
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const key of fields) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(key))
      throw new CertificateError('invalid', `Invalid record field: ${key}.`);
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    if (!('value' in descriptor))
      throw new CertificateError('invalid', `Record field ${key} cannot be an accessor.`);
    result[key] = plainText(descriptor.value, `Record field ${key}`, maxTextLength);
  }
  if (!result.id?.trim()) throw new CertificateError('invalid', 'Each record needs a nonempty id.');
  return Object.freeze(result);
}

function requiredBindings(template: CertificateTemplate): readonly string[] {
  const bindings = new Set<string>();
  for (const value of [template.title, ...template.lines]) {
    for (const match of value.matchAll(/\{\{([A-Za-z][A-Za-z0-9_.-]{0,63})\}\}/gu))
      bindings.add(match[1]!);
  }
  return Object.freeze([...bindings]);
}

function interpolate(template: string, record: Readonly<Record<string, string>>): string {
  return template
    .replace(/\{\{([A-Za-z][A-Za-z0-9_.-]{0,63})\}\}/gu, (_match, field: string) => {
      const value = record[field];
      if (value === undefined)
        throw new CertificateError('invalid', `Certificate record is missing binding "${field}".`);
      return value;
    })
    .replace(/\{\{[^{}]*\}\}/gu, () => {
      throw new CertificateError('invalid', 'Certificate contains an invalid named binding.');
    });
}

function validateTemplate(
  input: CertificateTemplate,
  limits: CertificateLimits,
): CertificateTemplate {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new CertificateError('invalid', 'A certificate template is required.');
  const maxLines = limit(limits.maxLines, 50, 200, 'maxLines');
  const maxTextLength = limit(limits.maxTextLength, 2000, 10_000, 'maxTextLength');
  const width = dimension(input.width, 'Width');
  const height = dimension(input.height, 'Height');
  if (height < 180) throw new CertificateError('invalid', 'Height must leave room for the title.');
  const title = plainText(input.title, 'Title', maxTextLength);
  if (!title.trim()) throw new CertificateError('invalid', 'Certificate title is required.');
  if (!Array.isArray(input.lines) || input.lines.length > maxLines)
    throw new CertificateError('capacity', `Certificate lines must not exceed ${maxLines}.`);
  for (let index = 0; index < input.lines.length; index += 1)
    if (!Object.hasOwn(input.lines, index))
      throw new CertificateError('invalid', 'Template lines cannot contain empty slots.');
  const lines = input.lines.map((line) => plainText(line, 'Template line', maxTextLength));
  if (lines.length > 0 && 160 + (lines.length - 1) * 36 > height - 40)
    throw new CertificateError('invalid', 'Template lines exceed the certificate height.');
  const qrField = input.qrField;
  if (qrField !== undefined && !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(qrField))
    throw new CertificateError('invalid', 'qrField must be a named record field.');
  if (qrField && (width < 400 || height < 400))
    throw new CertificateError('invalid', 'QR certificates need at least 400 by 400 pixels.');
  if (qrField && lines.length > 0 && 160 + (lines.length - 1) * 36 > height - 200)
    throw new CertificateError('invalid', 'Template lines must leave room for the QR image.');
  return Object.freeze({
    width,
    height,
    title,
    lines: Object.freeze(lines),
    ...(qrField ? { qrField } : {}),
  });
}

function assertBindings(template: string): void {
  const withValidBindingsRemoved = template.replace(/\{\{[A-Za-z][A-Za-z0-9_.-]{0,63}\}\}/gu, '');
  if (/\{\{|\}\}/u.test(withValidBindingsRemoved))
    throw new CertificateError('invalid', 'Certificate contains an invalid named binding.');
}

function renderCertificate(
  template: CertificateTemplate,
  record: Readonly<Record<string, string>>,
  qrData: Uint8Array | undefined,
): string {
  const title = escapeXml(interpolate(template.title, record));
  const textLines = template.lines
    .map(
      (line, index) =>
        `<text x="${template.width / 2}" y="${160 + index * 36}" text-anchor="middle" font-family="serif" font-size="24">${escapeXml(interpolate(line, record))}</text>`,
    )
    .join('');
  const qr = qrData
    ? `<image x="${template.width - 144}" y="${template.height - 144}" width="112" height="112" href="data:image/png;base64,${encodeBase64(qrData)}" aria-label="Certificate QR code"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Certificate for ${escapeXml(record.id!)}" width="${template.width}" height="${template.height}" viewBox="0 0 ${template.width} ${template.height}"><rect x="12" y="12" width="${template.width - 24}" height="${template.height - 24}" fill="#ffffff" stroke="#1f2937" stroke-width="4"/><text x="${template.width / 2}" y="104" text-anchor="middle" font-family="serif" font-size="36" font-weight="700">${title}</text>${textLines}${qr}</svg>`;
}

/** Creates actual SVG certificates with escaped named bindings and optional injected QR images. */
export async function generateCertificates(
  templateInput: CertificateTemplate,
  inputs: readonly CertificateRecord[],
  options: CertificateLimits & {
    readonly qrGenerator?: QrGenerator;
    readonly signal?: AbortSignal;
  } = {},
): Promise<readonly CertificateOutput[]> {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new CertificateError('invalid', 'Options must be an object.');
  const template = validateTemplate(templateInput, options);
  assertBindings(template.title);
  for (const line of template.lines) assertBindings(line);
  const maxRecords = limit(options.maxRecords, 500, 5000, 'maxRecords');
  const maxFields = limit(options.maxFields, 100, 1000, 'maxFields');
  const maxInputBytes = limit(options.maxInputBytes, 5_000_000, 50_000_000, 'maxInputBytes');
  const maxOutputBytes = limit(options.maxOutputBytes, 2_000_000, 20_000_000, 'maxOutputBytes');
  const maxQrBytes = limit(options.maxQrBytes, 250_000, 2_000_000, 'maxQrBytes');
  if (!Array.isArray(inputs)) throw new CertificateError('invalid', 'Records must be an array.');
  for (let index = 0; index < inputs.length; index += 1)
    if (!Object.hasOwn(inputs, index))
      throw new CertificateError('invalid', 'Record arrays cannot contain empty slots.');
  if (inputs.length > maxRecords)
    throw new CertificateError('capacity', 'Certificate batch capacity exceeded.');
  const maxTextLength = limit(options.maxTextLength, 2000, 10_000, 'maxTextLength');
  const records = inputs.map((record) => ownStringRecord(record, maxTextLength, maxFields));
  let inputBytes = new TextEncoder().encode(template.title).byteLength;
  for (const line of template.lines) inputBytes += new TextEncoder().encode(line).byteLength;
  for (const record of records)
    for (const [key, value] of Object.entries(record))
      inputBytes +=
        new TextEncoder().encode(key).byteLength + new TextEncoder().encode(value).byteLength;
  if (inputBytes > maxInputBytes)
    throw new CertificateError('capacity', 'Certificate batch input byte capacity exceeded.');
  const bindings = requiredBindings(template);
  for (const record of records) {
    for (const binding of bindings)
      if (record[binding] === undefined)
        throw new CertificateError(
          'invalid',
          `Certificate record ${record.id} is missing binding "${binding}".`,
        );
    if (template.qrField && record[template.qrField] === undefined)
      throw new CertificateError(
        'invalid',
        `Record ${record.id} is missing QR field ${template.qrField}.`,
      );
  }
  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.id!))
      throw new CertificateError('invalid', `Duplicate certificate ID: ${record.id}.`);
    ids.add(record.id!);
  }
  if (template.qrField && typeof options.qrGenerator !== 'function')
    throw new CertificateError(
      'unsupported',
      'A QR field requires an injected QR image generator.',
    );
  const output: CertificateOutput[] = [];
  let totalBytes = 0;
  for (const record of records) {
    if (options.signal?.aborted)
      throw new CertificateError('cancelled', 'Certificate generation was cancelled.');
    let qrData: Uint8Array | undefined;
    if (template.qrField) {
      const payload = record[template.qrField];
      if (payload === undefined)
        throw new CertificateError('invalid', 'Required QR data is missing.');
      let generated: Awaited<ReturnType<QrGenerator>>;
      try {
        generated = await options.qrGenerator!(payload, options.signal);
      } catch (cause) {
        throw new CertificateError('adapter', 'QR image generator failed.', { cause });
      }
      if (options.signal?.aborted)
        throw new CertificateError('cancelled', 'Certificate generation was cancelled.');
      if (
        !generated ||
        generated.mediaType !== 'image/png' ||
        !(generated.data instanceof Uint8Array) ||
        generated.data.byteLength === 0
      )
        throw new CertificateError('adapter', 'QR generator must return nonempty image/png bytes.');
      if (generated.data.byteLength > maxQrBytes)
        throw new CertificateError('capacity', 'QR image byte capacity exceeded.');
      qrData = new Uint8Array(generated.data);
    }
    const svg = renderCertificate(template, record, qrData);
    const bytes = new TextEncoder().encode(svg).byteLength;
    totalBytes += bytes;
    if (totalBytes > maxOutputBytes)
      throw new CertificateError('capacity', 'Certificate batch output byte capacity exceeded.');
    output.push(Object.freeze({ id: record.id!, svg }));
  }
  return Object.freeze(output);
}
