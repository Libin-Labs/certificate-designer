import library = require('@lp-labs/certificate-designer');
void library.generateCertificates({ width: 800, height: 600, title: 'Award {{name}}', lines: [] }, [
  { id: 'one', name: 'Jordan' },
]);
