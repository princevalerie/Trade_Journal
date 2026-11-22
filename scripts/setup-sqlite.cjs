const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error('HTTP status ' + res.statusCode));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', reject);
  });
}

(async () => {
  const version = 'v12.11.1';
  const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/${version}/better-sqlite3-${version}-node-v127-win32-x64.tar.gz`;
  const rootDir = path.resolve(__dirname, '..');
  const sqliteDir = path.resolve(rootDir, 'node_modules/better-sqlite3');
  const tempTar = path.resolve(sqliteDir, 'better-sqlite3.tar.gz');

  console.log('📦 Downloading better-sqlite3 prebuild for Node.js 22 (ABI 127)...');
  await download(url, tempTar);
  console.log('📂 Extracting prebuilt binary...');
  const tempExtract = path.resolve(sqliteDir, '_temp_extract');
  fs.mkdirSync(tempExtract, { recursive: true });
  execSync(`tar -xzf "${tempTar}" -C "${tempExtract}"`);
  
  // Find all .node files extracted
  function findNodeFiles(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const full = path.join(dir, file);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) results = results.concat(findNodeFiles(full));
      else if (file.endsWith('.node')) results.push(full);
    }
    return results;
  }

  const nodeFiles = findNodeFiles(tempExtract);
  console.log('Found extracted .node files:', nodeFiles);
  if (nodeFiles.length > 0) {
    const targetPath = path.resolve(sqliteDir, 'build/Release/better_sqlite3.node');
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(nodeFiles[0], targetPath);
    console.log(`Copied ${nodeFiles[0]} -> ${targetPath}`);
  }

  fs.rmSync(tempExtract, { recursive: true, force: true });
  if (fs.existsSync(tempTar)) fs.unlinkSync(tempTar);

  console.log('🔍 Testing better-sqlite3 loading...');
  const Database = require(sqliteDir);
  const db = new Database(':memory:');
  console.log('✅ SQLite is working perfectly in Node.js! Open:', db.open);
  db.close();
})().catch(err => {
  console.error('❌ Error restoring sqlite prebuild:', err);
  process.exit(1);
});
