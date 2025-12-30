const fs = require('fs');
const path = require('path');

const loadBase64 = (p) => {
  if (!fs.existsSync(p)) return null;
  const ext = path.extname(p).toLowerCase();
  const data = fs.readFileSync(p).toString('base64');
  if (ext === '.png') return `data:image/png;base64,${data}`;
  if (ext === '.svg') return `data:image/svg+xml;base64,${data}`;
  return null;
};

const getSegmentAssets = (segment = 'default') => {
  const root = path.join(__dirname, '../../templates/assets/segments');
  const seg = segment.toLowerCase();
  return {
    logo:
      loadBase64(path.join(root, seg, 'logo.png')) ||
      loadBase64(path.join(root, 'default', 'logo.png')),
    signature:
      loadBase64(path.join(root, seg, 'signature.svg')) ||
      loadBase64(path.join(root, 'default', 'signature.svg'))
  };
};

module.exports = { getSegmentAssets };

