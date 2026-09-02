#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = process.cwd();
const pkgPath = resolve(rootDir, 'package.json');
const viteConfigPath = resolve(rootDir, 'vite.config.ts');

function run(cmd, options = {}) {
  return execSync(cmd, { cwd: rootDir, encoding: 'utf-8', stdio: 'pipe', ...options });
}

function getRepoUrl() {
  try {
    const remote = run('git remote get-url origin').trim();
    if (remote.startsWith('git@github.com:')) {
      return `https://github.com/${remote.replace('git@github.com:', '').replace(/\.git$/, '')}`;
    }
    return remote.replace(/\.git$/, '');
  } catch {
    return 'https://github.com/Mind-Ext/bar-arxiv-tables';
  }
}

function getLastTag() {
  try {
    return run('git describe --tags --abbrev=0').trim();
  } catch {
    return null;
  }
}

function getCommits(lastTag) {
  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
  const raw = run(`git log ${range} --no-merges --pretty=format:"%h%x09%s"`).trim();
  if (!raw) return [];
  return raw.split('\n').map((line) => {
    const [hash, ...rest] = line.split('\t');
    const subject = rest.join('\t').trim();
    return { hash: hash.trim(), subject };
  });
}

function parseVersion(v) {
  const cleaned = v.trim().replace(/^v/i, '');
  const parts = cleaned.split('.').map((p) => parseInt(p, 10));
  if (parts.some((n) => isNaN(n))) {
    throw new Error(`Invalid version format: ${v}`);
  }
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  return { major, minor, patch, formatted: `${major}.${minor}.${patch}` };
}

function normalizeInputVersion(input, current) {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();
  if (trimmed === 'major') return `${current.major + 1}.0.0`;
  if (trimmed === 'minor') return `${current.major}.${current.minor + 1}.0`;
  if (trimmed === 'patch') return `${current.major}.${current.minor}.${current.patch + 1}`;

  const cleaned = input.trim().replace(/^v/i, '');
  const parts = cleaned.split('.');
  if (parts.length === 1) {
    const major = parseInt(parts[0], 10);
    if (isNaN(major)) throw new Error(`Invalid version: ${input}`);
    return `${major}.0.0`;
  }
  if (parts.length === 2) {
    const [major, minor] = parts.map((n) => parseInt(n, 10));
    if (isNaN(major) || isNaN(minor)) throw new Error(`Invalid version: ${input}`);
    return `${major}.${minor}.0`;
  }
  if (parts.length === 3) {
    const [major, minor, patch] = parts.map((n) => parseInt(n, 10));
    if (isNaN(major) || isNaN(minor) || isNaN(patch)) throw new Error(`Invalid version: ${input}`);
    return `${major}.${minor}.${patch}`;
  }
  throw new Error(`Invalid version format: ${input}`);
}

function determineTargetVersion(arg, currentVersionStr, commits) {
  const current = parseVersion(currentVersionStr);
  const normalized = normalizeInputVersion(arg, current);
  if (normalized) {
    return normalized;
  }

  // Auto-increment: check if contains new features (feat:)
  const hasFeat = commits.some((c) => /^feat(\(.*\))?:/i.test(c.subject));
  if (hasFeat) {
    return `${current.major}.${current.minor + 1}.0`;
  }
  return `${current.major}.${current.minor}.${current.patch + 1}`;
}

function categorizeCommits(commits, repoUrl) {
  const features = [];
  const fixes = [];
  const improvements = [];
  const others = [];

  for (const { hash, subject } of commits) {
    const link = `[\`${hash}\`](${repoUrl}/commit/${hash})`;

    if (/^feat(\(.*\))?:/i.test(subject)) {
      const cleanSubject = subject.replace(/^feat(\([^)]+\))?:\s*/i, (match, p1) => (p1 ? `**${p1.slice(1, -1)}:** ` : ''));
      features.push(`- ${link} ${cleanSubject}`);
    } else if (/^fix(\(.*\))?:/i.test(subject)) {
      const cleanSubject = subject.replace(/^fix(\([^)]+\))?:\s*/i, (match, p1) => (p1 ? `**${p1.slice(1, -1)}:** ` : ''));
      fixes.push(`- ${link} ${cleanSubject}`);
    // } else if (/^(refac|refactor|perf|style)(\(.*\))?:/i.test(subject)) {
    //   const cleanSubject = subject.replace(/^(refac|refactor|perf|style)(\([^)]+\))?:\s*/i, (match, p1, p2) => (p2 ? `**${p2.slice(1, -1)}:** ` : ''));
    //   improvements.push(`- ${link} ${cleanSubject}`);
    } else {
      others.push(`- ${link} ${subject}`);
    }
  }

  const sections = [];
  if (features.length > 0) {
    sections.push(`### Features\n\n${features.join('\n')}`);
  }
  if (fixes.length > 0) {
    sections.push(`### Fixes\n\n${fixes.join('\n')}`);
  }
  // if (improvements.length > 0) {
  //   sections.push(`### Improvements\n\n${improvements.join('\n')}`);
  // }
  if (others.length > 0) {
    sections.push(`### Others\n\n${others.join('\n')}`);
  }

  return sections.join('\n\n') || '- Initial Release';
}

function updateVersionFiles(newVersion) {
  // 1. package.json
  const pkgContent = readFileSync(pkgPath, 'utf-8');
  const updatedPkg = pkgContent.replace(/"version":\s*"[^"]+"/, `"version": "${newVersion}"`);
  writeFileSync(pkgPath, updatedPkg, 'utf-8');

  // 2. vite.config.ts
  const viteContent = readFileSync(viteConfigPath, 'utf-8');
  const updatedVite = viteContent.replace(/version:\s*['"][^'"]+['"]/, `version: '${newVersion}'`);
  writeFileSync(viteConfigPath, updatedVite, 'utf-8');
}

async function main() {
  const args = process.argv.slice(2);
  let isDryRun = false;
  let isDraft = false;
  let customNotes = null;
  let versionArg = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      isDryRun = true;
    } else if (arg === '--draft') {
      isDraft = true;
    } else if (arg === '-n' || arg === '--note') {
      customNotes = args[++i] ?? '';
    } else if (!arg.startsWith('-')) {
      if (!versionArg) {
        versionArg = arg;
      }
    }
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const currentVersion = pkg.version || '0.1.0';
  const repoUrl = getRepoUrl();
  const lastTag = getLastTag();
  const commits = getCommits(lastTag);

  const targetVersion = determineTargetVersion(versionArg, currentVersion, commits);
  const releaseNotes = customNotes !== null ? customNotes : categorizeCommits(commits, repoUrl);

  console.log('========================================');
  console.log(`📦 Release Automation: v${targetVersion}`);
  console.log(`📌 Current Version:   v${currentVersion}`);
  console.log(`🏷️  Last Git Tag:       ${lastTag ?? '(none)'}`);
  console.log(`📝 Commits Found:     ${commits.length}`);
  console.log(`🌐 Repository:        ${repoUrl}`);
  console.log('========================================\n');

  console.log('--- Generated Release Notes ---');
  console.log(releaseNotes);
  console.log('-------------------------------\n');

  if (isDryRun) {
    console.log('🔍 [DRY RUN] Skipping file writes, git commit, tag, and GitHub release.');
    return;
  }

  // 1. Update version strings in files
  console.log(`✏️  Updating version to ${targetVersion} in package.json and vite.config.ts...`);
  updateVersionFiles(targetVersion);

  // 2. Format files
  console.log('🎨 Running code formatter...');
  try {
    run('pnpm run fmt');
  } catch (err) {
    console.warn('⚠️  Formatting warning:', err.message);
  }

  // 3. Run test suite
  console.log('🧪 Running tests...');
  run('pnpm test run', { stdio: 'inherit' });

  // 4. Build userscript
  console.log('🔨 Building userscript...');
  run('pnpm build', { stdio: 'inherit' });

  // 5. Git commit and tag
  console.log('🔖 Creating git commit and tag...');
  run('git add package.json vite.config.ts');
  const commitMsg = `release: v${targetVersion}`;
  run(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`);
  run(`git tag v${targetVersion}`);

  // 6. Push to remote
  console.log('🚀 Pushing to remote...');
  run('git push && git push --tags', { stdio: 'inherit' });

  // 7. Create GitHub Release
  console.log('🎉 Creating GitHub Release...');
  const draftFlag = isDraft ? '--draft ' : '';
  const assetPath = 'dist/bar-arxiv-tables.user.js';
  const ghCmd = `gh release create v${targetVersion} ${assetPath} ${draftFlag}--title "v${targetVersion}" --notes "${releaseNotes.replace(/"/g, '\\"')}"`;
  
  try {
    run(ghCmd, { stdio: 'inherit' });
    console.log(`\n✨ Successfully published release v${targetVersion}!`);
  } catch (err) {
    console.error('\n⚠️  Could not run gh release create automatically. You can publish manually with:');
    console.log(`\n${ghCmd}\n`);
  }
}

main().catch((err) => {
  console.error('❌ Release failed:', err);
  process.exit(1);
});
