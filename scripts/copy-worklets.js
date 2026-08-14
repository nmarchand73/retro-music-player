import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'node_modules', 'chiptune3');
const destDir = path.join(root, 'public');
const files = ['libopenmpt.worklet.js', 'chiptune3.worklet.js'];

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

for (const file of files) {
  const src = path.join(srcDir, file);
  if (!fs.existsSync(src)) {
    console.warn(`Missing ${file} in chiptune3 package`);
    continue;
  }
  fs.copyFileSync(src, path.join(destDir, file));
  console.log(`Copied ${file} to public/`);

  if (file === 'chiptune3.worklet.js') {
    const workletPath = path.join(destDir, file);
    const contents = fs.readFileSync(workletPath, 'utf8');
    const patched = contents.replace(
      "from './libopenmpt.worklet.js'",
      "from '/libopenmpt.worklet.js'",
    );
    fs.writeFileSync(workletPath, patched);
  }
}
