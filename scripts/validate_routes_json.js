/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Do not modify existing UI/UX, layouts, or core logic in this file without explicitly asking Thunter BOY for clearance. If changes are required here, STOP and provide a RISK IMPACT REPORT first. */
#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const routesPath = path.join(__dirname, '..', 'public', '_routes.json');

function normalizeRule(rule) {
  return String(rule || '').trim();
}

function matchesByWildcard(rule, candidate) {
  const base = rule.slice(0, -1);
  return candidate.startsWith(base);
}

function overlaps(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;

  const aWild = a.endsWith('*');
  const bWild = b.endsWith('*');

  if (aWild && matchesByWildcard(a, b)) return true;
  if (bWild && matchesByWildcard(b, a)) return true;

  if (aWild && bWild) {
    const aBase = a.slice(0, -1);
    const bBase = b.slice(0, -1);
    return aBase.startsWith(bBase) || bBase.startsWith(aBase);
  }

  return false;
}

function main() {
  let json;
  try {
    json = JSON.parse(fs.readFileSync(routesPath, 'utf8'));
  } catch (err) {
    console.error(`[routes-check] Failed to parse ${routesPath}:`, err.message);
    process.exit(1);
  }

  const includes = Array.isArray(json.include) ? json.include.map(normalizeRule).filter(Boolean) : [];
  const overlapsFound = [];

  for (let i = 0; i < includes.length; i += 1) {
    for (let j = i + 1; j < includes.length; j += 1) {
      const a = includes[i];
      const b = includes[j];
      if (overlaps(a, b)) overlapsFound.push([a, b]);
    }
  }

  if (overlapsFound.length) {
    console.error('[routes-check] Overlapping include rules detected in public/_routes.json:');
    overlapsFound.forEach(([a, b]) => console.error(`  - "${a}" overlaps "${b}"`));
    process.exit(1);
  }

  console.log('[routes-check] public/_routes.json include rules are valid (no overlaps).');
}

main();
