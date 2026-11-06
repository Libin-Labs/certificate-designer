import { CertificateError, generateCertificates } from '@lp-labs/certificate-designer';
import type {
  CertificateLimits,
  CertificateOutput,
  CertificateRecord,
  CertificateTemplate,
  QrGenerator,
} from '@lp-labs/certificate-designer';
const template: CertificateTemplate = {
  width: 800,
  height: 600,
  title: 'Award {{recipient}}',
  lines: ['{{achievement}}'],
  qrField: 'verify',
};
const records: CertificateRecord[] = [
  { id: 'award-1', recipient: 'Rae', achievement: 'Service', verify: 'token' },
];
const qrGenerator: QrGenerator = async () => ({
  mediaType: 'image/png',
  data: new Uint8Array([1]),
});
const limits: CertificateLimits = {
  maxRecords: 20,
  maxFields: 20,
  maxInputBytes: 100_000,
  maxOutputBytes: 1_000_000,
};
const certificates: Promise<readonly CertificateOutput[]> = generateCertificates(
  template,
  records,
  {
    ...limits,
    qrGenerator,
  },
);
const error = new CertificateError('invalid', 'bad certificate');
void [certificates, error];
