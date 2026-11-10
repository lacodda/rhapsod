// Writes the version being released into the samples that show it.
//
//   node tools/stamp-version.mjs
//
// furca's bump rewrites every `vX.Y.Z` and `rhapsod X.Y.Z` of the last
// release; a bare number it leaves alone, since in prose that is as often a
// dependency's. Two bare numbers here are the product's all the same, and a
// test holds each to the manifest (tests/release_consistency.rs):
//
// - the health transcripts, `{"status":"ok","version":"X.Y.Z",...}`, which is
//   how a reader checks that the stand they just brought up is this release;
// - `RHAPSOD_VERSION=X.Y.Z`, the line of a stand's `.env` that picks the image.
//
// It belongs right after the release bump (see release.toml), so the release
// commit carries them. Text between `<!-- historical versions -->` and its closing comment is what
// happened on a day and stays as written.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = join(import.meta.dirname, '..')

const manifest = readFileSync(join(root, 'Cargo.toml'), 'utf8')
// The first `version =` at the start of a line is the package's: a dependency
// names its version inside braces.
const version = /^version\s*=\s*"(\d+\.\d+\.\d+)"/m.exec(manifest)?.[1]
if (!version) {
  console.error('stamp-version: Cargo.toml has no [package] version')
  process.exit(1)
}

function pages(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return pages(path)
    return /\.mdx?$/.test(entry.name) ? [path] : []
  })
}

const files = [
  join(root, 'README.md'),
  join(root, 'docker-compose.prod.yml'),
  ...pages(join(root, 'docs/site/src/content/docs')),
]

function stamp(line) {
  let out = line.replace(/\bRHAPSOD_VERSION=\d+\.\d+\.\d+\b/g, `RHAPSOD_VERSION=${version}`)
  if (out.includes('"status":') && out.includes('"pieces":')) {
    out = out.replace(/"version":"\d+\.\d+\.\d+"/g, `"version":"${version}"`)
  }
  return out
}

let changed = 0
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  let history = false
  const lines = text.split('\n').map((line) => {
    if (line.includes('<!-- historical versions -->')) history = true
    if (line.includes('<!-- /historical versions -->')) history = false
    return history ? line : stamp(line)
  })
  const stamped = lines.join('\n')
  if (stamped !== text) {
    writeFileSync(file, stamped)
    changed += 1
    console.log(`stamp-version: ${relative(root, file).replaceAll('\\', '/')} now shows ${version}`)
  }
}
if (changed === 0) console.log(`stamp-version: every sample already shows ${version}`)
