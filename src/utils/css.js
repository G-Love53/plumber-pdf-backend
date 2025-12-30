const fs = require('fs');
const path = require('path');

const loadGlobalCss = () => {
  const p = path.join(__dirname, '../../templates/assets/common/global-print.css');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};

module.exports = { loadGlobalCss };

