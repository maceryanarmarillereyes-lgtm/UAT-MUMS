/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Do not modify existing UI/UX, layouts, or core logic in this file without explicitly asking Thunter BOY for clearance. If changes are required here, STOP and provide a RISK IMPACT REPORT first. */
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

function die(msg){
  console.error(`\n[package_phase1_release] ${msg}\n`);
  process.exit(1);
}

function readText(p){
  return fs.readFileSync(p, 'utf8');
}

function writeText(p, s){
  fs.writeFileSync(p, s, 'utf8');
}

function parseArgs(argv){
  const out = {
    bump: true,
    force: false,
    outDir: null,
    dryRun: false,
  };
  for(let i=0;i<argv.length;i++){
    const a = String(argv[i]||'');
    if(a === '--no-bump') out.bump = false;
    else if(a === '--bump') out.bump = true;
    else if(a === '--force') out.force = true;
    else if(a === '--dry-run') out.dryRun = true;
    else if(a === '--out'){
      out.outDir = String(argv[i+1]||'').trim();
      i++;
    }else if(a === '-h' || a === '--help'){
      console.log(`\nMUMS Phase 1 — Sequential Release Packager\n\n`+
        `Usage:\n`+
        `  node tools/package_phase1_release.js [--out <dir>] [--no-bump] [--force] [--dry-run]\n\n`+
        `Default:\n`+
        `  - Creates: MUMS Phase 1-<sequence>.zip\n`+
        `  - Then bumps SEQ + cache-bust tokens to the next sequence (ready for next release)\n`+
        `\nSource of truth:\n`+
        `  - public/js/config/version.js (const SEQ = <n>)\n`);
      process.exit(0);
    }
  }
  return out;
}

// Back-compat: older builds stored the build label in Config.BUILD
const SEP_CLASS = '[-\u2010\u2011\u2012\u2013\u2014]';
const BUILD_RE = new RegExp(`BUILD\\s*:\\s*['\"]MUMS\\s+Phase\\s+1${SEP_CLASS}(\\d+)['\"]`);

// Phase 1-511+ source of truth
const VERSION_SEQ_RE = /\bconst\s+SEQ\s*=\s*(\d+)\s*;/;
const CACHE_TOKEN_RE_GLOBAL = /\bp1-\d+\b/g;

function parseSeqFromVersion(text){
  const m = String(text||'').match(VERSION_SEQ_RE);
  return m ? Number(m[1]) : null;
}

function bumpVersionSeq(text, nextSeq){
  return String(text||'').replace(VERSION_SEQ_RE, `const SEQ = ${nextSeq};`);
}

function bumpCacheTokens(text, nextSeq){
  // Replace any p1-<n> tokens in asset URLs. Intentionally broad so pages stay consistent.
  return String(text||'').replace(CACHE_TOKEN_RE_GLOBAL, `p1-${nextSeq}`);
}

function main(){
  const opts = parseArgs(process.argv.slice(2));
  const root = path.resolve(__dirname, '..');

  const versionPath = path.join(root, 'public', 'js', 'config', 'version.js');
  const configPath = path.join(root, 'public', 'js', 'config.js');

  let seq = null;

  if(fs.existsSync(versionPath)){
    seq = parseSeqFromVersion(readText(versionPath));
    if(!Number.isFinite(seq) || seq <= 0){
      die('Could not parse SEQ in public/js/config/version.js');
    }
  }else{
    // Back-compat for older zips
    if(!fs.existsSync(configPath)) die('Missing public/js/config.js');
    const cfg = readText(configPath);
    const m = cfg.match(BUILD_RE);
    if(!m) die('Could not parse Config.BUILD in public/js/config.js (and version.js is missing)');
    seq = Number(m[1]);
    if(!Number.isFinite(seq) || seq <= 0) die(`Invalid build sequence: ${m[1]}`);
  }

  const outDir = opts.outDir ? path.resolve(root, opts.outDir) : root;
  if(!fs.existsSync(outDir) && !opts.dryRun){
    fs.mkdirSync(outDir, { recursive: true });
  }

  const zipName = `MUMS Phase 1-${seq}.zip`;
  const zipPath = path.join(outDir, zipName);
  if(fs.existsSync(zipPath) && !opts.force){
    die(`Output already exists: ${zipName} (use --force to overwrite)`);
  }

  // Build zip (exclude common non-artifacts)
  const zipArgs = ['-r', zipPath, '.'];
  const excludes = [
    'node_modules/*',
    '.git/*',
    '.vercel/*',
    '*.zip',
    'dist/*',
    'tmp/*',
  ];
  for(const x of excludes){
    zipArgs.push('-x', x);
  }

  if(opts.dryRun){
    console.log(`[package_phase1_release] DRY RUN: would run zip ${zipArgs.join(' ')}`);
  }else{
    console.log(`[package_phase1_release] Packaging → ${zipName}`);
    const res = cp.spawnSync('zip', zipArgs, { cwd: root, stdio: 'inherit' });
    if(res.status !== 0){
      die('zip command failed');
    }
  }

  if(!opts.bump){
    console.log(`[package_phase1_release] Done (no bump).`);
    return;
  }

  const nextSeq = seq + 1;
  const filesToBump = [
    versionPath,
    // Public HTML helper pages
    path.join(root, 'public', 'index.html'),
    path.join(root, 'public', 'login.html'),
    path.join(root, 'public', 'dashboard.html'),
    path.join(root, 'public', 'schedule.html'),
    path.join(root, 'public', 'debug.html'),
    // Root redirect helpers (if present)
    path.join(root, 'index.html'),
    path.join(root, 'login.html'),
    path.join(root, 'dashboard.html'),
    path.join(root, 'schedule.html'),
    path.join(root, 'debug.html'),
  ];

  for(const fp of filesToBump){
    if(!fs.existsSync(fp)) continue;

    const before = readText(fp);
    let after = before;

    if(path.resolve(fp) === path.resolve(versionPath)){
      after = bumpVersionSeq(before, nextSeq);
    }else{
      after = bumpCacheTokens(before, nextSeq);
    }

    if(after !== before){
      if(opts.dryRun) console.log(`[package_phase1_release] DRY RUN: would bump in ${path.relative(root, fp)}`);
      else writeText(fp, after);
    }
  }

  if(opts.dryRun) console.log(`[package_phase1_release] DRY RUN: would bump SEQ to ${nextSeq} and cache tokens to p1-${nextSeq}`);
  else console.log(`[package_phase1_release] Bumped SEQ to ${nextSeq} and cache tokens to p1-${nextSeq}`);
  console.log(`[package_phase1_release] Next run will create: MUMS Phase 1-${nextSeq}.zip`);
}

main();
