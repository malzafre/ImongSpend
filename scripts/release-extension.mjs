#!/usr/bin/env node

import { execSync } from 'node:child_process'

const version = process.argv[2]
const semverRegex = /^[0-9]+\.[0-9]+\.[0-9]+$/

function run(command) {
  execSync(command, { stdio: 'inherit' })
}

function output(command) {
  return execSync(command, { encoding: 'utf8' }).trim()
}

if (!version || !semverRegex.test(version)) {
  console.error('Usage: npm run release:extension -- <major.minor.patch>')
  process.exit(1)
}

const tag = `v${version}`

try {
  const branch = output('git branch --show-current')
  if (branch !== 'main') {
    console.error(`Release must run from main. Current branch: ${branch || '(detached)'}`)
    process.exit(1)
  }

  const workingTree = output('git status --porcelain')
  if (workingTree) {
    console.error('Working tree is not clean. Commit or stash changes before releasing.')
    process.exit(1)
  }

  run('git fetch origin --tags --prune')

  try {
    run(`git rev-parse --verify --quiet refs/tags/${tag}`)
    console.error(`Tag already exists locally: ${tag}`)
    process.exit(1)
  } catch {
    // Tag does not exist locally.
  }

  const remoteTag = output(`git ls-remote --tags --refs origin refs/tags/${tag}`)
  if (remoteTag) {
    console.error(`Tag already exists on origin: ${tag}`)
    process.exit(1)
  }

  run('git pull --ff-only origin main')

  run(`npm run version:extension -- ${version}`)
  run('npm run lint:extension')
  run('npm run typecheck --workspace @imongspend/shared')
  run('npm run typecheck --workspace @imongspend/extension')
  run('npm run build:extension')

  run('git add apps/extension/public/manifest.json apps/extension/package.json')

  const staged = output('git diff --cached --name-only')
  if (!staged) {
    console.error('No version changes were staged. Aborting release.')
    process.exit(1)
  }

  run(`git commit -m "chore(release): extension ${tag}"`)
  run('git push origin main')
  run(`git tag ${tag}`)
  run(`git push origin ${tag}`)

  console.log(`Release prepared and pushed: ${tag}`)
  console.log('GitHub Actions will publish the release from the tag workflow.')
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Release failed: ${message}`)
  process.exit(1)
}
