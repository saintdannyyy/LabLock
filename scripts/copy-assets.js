// Plain Node script (not compiled): tsc only emits .js from .ts, so the
// renderer's static HTML/CSS files need to be copied into dist/ separately
// after each build. Uses fs.cpSync (built into Node 22+), no dependency needed.
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');

function copyIfExists(from, to) {
  if (!fs.existsSync(from)) return;
  fs.cpSync(from, to, { recursive: true });
}

// Copy renderer .html/.css files next to the compiled renderer .js files.
const rendererSrc = path.join(projectRoot, 'src', 'renderer');
const rendererDist = path.join(projectRoot, 'dist', 'renderer');
for (const dir of fs.readdirSync(rendererSrc, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const srcDir = path.join(rendererSrc, dir.name);
  const distDir = path.join(rendererDist, dir.name);
  for (const file of fs.readdirSync(srcDir)) {
    if (file.endsWith('.html') || file.endsWith('.css')) {
      fs.mkdirSync(distDir, { recursive: true });
      fs.copyFileSync(path.join(srcDir, file), path.join(distDir, file));
    }
  }
}

console.log('Assets copied to dist/.');
