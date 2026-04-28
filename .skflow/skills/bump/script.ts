import { sh, ask, done } from "@skflow/runtime";

export async function main() {
  // Step 1: Find the last version tag
  const tagResult = await sh("git describe --tags --abbrev=0 2>/dev/null || echo none");
  const lastTag = tagResult.stdout.trim();

  if (lastTag === "none") {
    return done({
      summary: "No version tag found. Create an initial tag first (e.g., git tag v0.1.0).",
    });
  }

  // Step 2: Get commits since last tag
  const commitsResult = await sh(`git log ${lastTag}..HEAD --oneline --no-merges`);
  const commits = commitsResult.stdout.trim();

  if (!commits) {
    return done({ summary: "No new commits since " + lastTag + ". Nothing to bump." });
  }

  // Step 3: Get changed files since last tag
  const filesResult = await sh(`git diff --name-only ${lastTag}..HEAD`);
  const changedFiles = filesResult.stdout.trim();

  // Step 4: Get detailed commit log with files per commit for per-package attribution
  const detailedLog = await sh(
    `git log ${lastTag}..HEAD --no-merges --pretty=format:"%s" --name-only`,
  );

  // Step 5: Ask LLM to determine bump types per package
  const bumpDecision = await ask({
    prompt: `Analyze the commits and changed files since ${lastTag} and determine the version bump for each affected package.

Packages:
- @skflow/runtime (packages/runtime/)
- @skflow/transform (packages/transform/)
- @skflow/cli (packages/cli/)

Rules:
- feat!: or BREAKING CHANGE → major
- feat: → minor
- fix:, perf: → patch
- chore:, docs:, style:, test:, refactor:, ci: → patch
- Use the HIGHEST bump for each package based on commits that touch that package's files
- Only include packages that actually have file changes

Respond with ONLY a JSON object mapping package directory to bump type, e.g.:
{"runtime": "minor", "transform": "patch", "cli": "minor"}

If a package has no changes, omit it.`,
    data: { commits, changedFiles, detailedLog: detailedLog.stdout },
  });

  // Step 6: Apply version bumps using node
  const updateScript = `
const fs = require('fs');
const bumps = JSON.parse(process.argv[1]);
const results = [];

function bumpVersion(version, type) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (type === 'major') return (major + 1) + '.0.0';
  if (type === 'minor') return major + '.' + (minor + 1) + '.0';
  return major + '.' + minor + '.' + (patch + 1);
}

const packageDirs = { runtime: 'packages/runtime', transform: 'packages/transform', cli: 'packages/cli' };
const newVersions = {};

// Bump each package
for (const [pkg, type] of Object.entries(bumps)) {
  const pkgPath = packageDirs[pkg] + '/package.json';
  if (!fs.existsSync(pkgPath)) continue;
  const json = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const oldVersion = json.version;
  json.version = bumpVersion(oldVersion, type);
  newVersions['@skflow/' + pkg] = json.version;
  fs.writeFileSync(pkgPath, JSON.stringify(json, null, 2) + '\\n');
  results.push(pkg + ': ' + oldVersion + ' → ' + json.version + ' (' + type + ')');
}

// Update cross-references in cli's package.json
const cliPkgPath = 'packages/cli/package.json';
if (fs.existsSync(cliPkgPath)) {
  const cliJson = JSON.parse(fs.readFileSync(cliPkgPath, 'utf8'));
  let updated = false;
  for (const [name, ver] of Object.entries(newVersions)) {
    if (cliJson.dependencies && cliJson.dependencies[name]) {
      cliJson.dependencies[name] = 'workspace:*';
      updated = true;
    }
  }
  if (updated) fs.writeFileSync(cliPkgPath, JSON.stringify(cliJson, null, 2) + '\\n');
}

// Bump root package.json to highest new version
const rootPkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const allNewVersions = Object.values(newVersions);
if (allNewVersions.length > 0) {
  const highest = allNewVersions.sort((a, b) => {
    const [a1,a2,a3] = a.split('.').map(Number);
    const [b1,b2,b3] = b.split('.').map(Number);
    return (b1-a1) || (b2-a2) || (b3-a3);
  })[0];
  const oldRoot = rootPkg.version;
  rootPkg.version = highest;
  fs.writeFileSync('package.json', JSON.stringify(rootPkg, null, 2) + '\\n');
  results.push('root: ' + oldRoot + ' → ' + highest);
}

console.log(JSON.stringify(results));
`;

  const applyResult = await sh(
    `node -e "${updateScript.replace(/"/g, '\\"').replace(/\n/g, " ")}" '${bumpDecision.replace(/'/g, "'\\''")}'`,
  );

  if (applyResult.code !== 0) {
    return done({ summary: "Failed to apply version bumps: " + applyResult.stderr });
  }

  const results = applyResult.stdout.trim();
  if (!results || !results.startsWith("[")) {
    return done({
      summary: "Version bump applied but could not parse results. Check package.json files.",
    });
  }

  const parsed = JSON.parse(results);
  return done({
    summary: "Bumped versions:\n" + parsed.join("\n"),
    data: { tag: lastTag, bumps: bumpDecision, results: parsed },
  });
}
