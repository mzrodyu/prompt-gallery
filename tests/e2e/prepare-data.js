const fs = require('fs');
const path = require('path');

const dir = path.resolve('.e2e-data');
fs.rmSync(dir, { recursive: true, force: true });
