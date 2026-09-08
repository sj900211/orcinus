#!/usr/bin/env node
// Orcinus identity guard. Fails if the fork's release identity drifts back toward
// upstream (stablyai/orca) — the exact regression that once made an Orcinus install
// adopt Orca's updater feed and installer identity (guild ruling #1). Wired into
// orcinus-ci AND the upstream auto-sync gate so a merge that reintroduces upstream
// identity is caught before it can ship.
//
// Scope of the negative scan is deliberately narrow: only the literal upstream
// release-feed URL, and only in src/main + src/shared production code. A blanket
// ban on "orca"/"stablyai" would be wrong — the Linux .deb name (orca-ide) and the
// WM_CLASS (orca) are contractually legitimate, and tests legitimately reference
// the upstream URL as fixtures.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = join(import.meta.dirname, '..', '..') // the app root (src/)
const failures = []
const expect = (cond, message) => {
  if (!cond) {
    failures.push(message)
  }
}

// 1. package.json name
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
expect(pkg.name === 'orcinus', `package.json name is "${pkg.name}", expected "orcinus"`)

// 2. electron-builder release identity (require works plainly — see orcinus-ci smoke)
const builder = require(join(ROOT, 'config', 'electron-builder.config.cjs'))
const publish = Array.isArray(builder.publish) ? builder.publish[0] : builder.publish
expect(
  builder.appId === 'com.sj900211.orcinus',
  `appId is "${builder.appId}", expected "com.sj900211.orcinus"`
)
expect(
  builder.productName === 'Orcinus',
  `productName is "${builder.productName}", expected "Orcinus"`
)
expect(publish?.owner === 'sj900211', `publish.owner is "${publish?.owner}", expected "sj900211"`)
expect(
  typeof publish?.repo === 'string' && publish.repo.startsWith('orcinus'),
  `publish.repo is "${publish?.repo}", expected an orcinus* repo`
)

// 3. updater feed-URL scan over src/main + src/shared production code
const POSITIVE = 'github.com/sj900211/orcinus/releases'
const NEGATIVE = 'github.com/stablyai/orca/releases'
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.mjs', '.cjs', '.js'])
const isTestFile = (name) =>
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(name) ||
  name.endsWith('-test-harness.ts') ||
  name.endsWith('-test-fixtures.ts')
const walk = (dir) => {
  const files = []
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__') {
      continue
    }
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      files.push(...walk(full))
    } else if (SOURCE_EXTS.has(extname(entry)) && !isTestFile(entry)) {
      files.push(full)
    }
  }
  return files
}
let positiveHits = 0
const negativeHits = []
const positiveRe = new RegExp(POSITIVE.replaceAll('.', '\\.'), 'g')
for (const scope of ['main', 'shared']) {
  for (const file of walk(join(ROOT, 'src', scope))) {
    const text = readFileSync(file, 'utf8')
    positiveHits += (text.match(positiveRe) || []).length
    if (text.includes(NEGATIVE)) {
      negativeHits.push(file.slice(ROOT.length + 1).replaceAll('\\', '/'))
    }
  }
}
expect(
  positiveHits >= 2,
  `found ${positiveHits} Orcinus release-feed references in src/main+src/shared, expected >= 2 (the updater feed must point at the fork)`
)
expect(
  negativeHits.length === 0,
  `production code still points at the upstream release feed (stablyai/orca): ${negativeHits.join(', ')}`
)

// 4. daemon-host relocation root: the %LOCALAPPDATA%\<root>\daemon-host tree must be the fork's own
// (not upstream 'Orca'), and the TS constant and the NSIS uninstall path must name the SAME root —
// a drift or an 'Orca' revert makes Orcinus share/delete a co-installed upstream Orca's live daemon
// tree. See docs/reference/windows-daemon-host-relocation.md.
const relocationSrc = readFileSync(join(ROOT, 'src', 'main', 'daemon', 'daemon-host-relocation.ts'), 'utf8')
const nshSrc = readFileSync(join(ROOT, 'config', 'nsis', 'orca-installer-hooks.nsh'), 'utf8')
const tsRoot = relocationSrc.match(/LOCAL_HOST_ROOT_NAME\s*=\s*'([^']+)'/)?.[1]
const nshRoot = nshSrc.match(/RMDir\s+\/r\s+"\$LOCALAPPDATA\\([^\\"]+)\\daemon-host"/)?.[1]
expect(tsRoot != null, 'could not find LOCAL_HOST_ROOT_NAME in daemon-host-relocation.ts')
expect(nshRoot != null, 'could not find the daemon-host RMDir path in orca-installer-hooks.nsh')
expect(
  tsRoot === builder.productName,
  `daemon-host root LOCAL_HOST_ROOT_NAME is "${tsRoot}", expected the fork productName "${builder.productName}" (an 'Orca' root shares upstream Orca's %LOCALAPPDATA% tree)`
)
expect(
  tsRoot === nshRoot,
  `daemon-host root drift: daemon-host-relocation.ts uses "${tsRoot}" but orca-installer-hooks.nsh uninstall deletes "${nshRoot}\\daemon-host" — they must name the same directory`
)

// 5. Linux AppImage producer/validator symmetry: the artifact name electron-builder EMITS
// (config appImage.artifactName) must be one the build-time contract ACCEPTS
// (static-appimage-package-contract.cjs), and both must carry the fork's name — not the
// upstream 'orca-' prefix. A half-done rebrand here passes every unit test but fails the
// release build in CD (the only leg that packages Linux) — the v1.4.197 failure mode.
const appImageArtifact = String(builder.appImage?.artifactName ?? '')
const appImageName = appImageArtifact.replace(/\.\$\{ext\}$/, '.AppImage')
const contractSrc = readFileSync(
  join(ROOT, 'config', 'scripts', 'static-appimage-package-contract.cjs'),
  'utf8'
)
const contractNames = [...contractSrc.matchAll(/'([A-Za-z0-9._-]+\.AppImage)'/g)].map((m) => m[1])
const appImagePrefix = `${builder.productName.toLowerCase()}-`
expect(appImageArtifact.length > 0, 'could not read appImage.artifactName from electron-builder config')
expect(
  contractNames.length > 0,
  'could not find accepted *.AppImage names in static-appimage-package-contract.cjs'
)
const foreignAppImageNames = contractNames.filter((name) => !name.startsWith(appImagePrefix))
expect(
  foreignAppImageNames.length === 0,
  `static-appimage contract accepts non-fork AppImage names: ${foreignAppImageNames.join(', ')} (expected the "${appImagePrefix}…" prefix, not upstream 'orca-')`
)
expect(
  contractNames.includes(appImageName),
  `electron-builder emits "${appImageName}" but static-appimage-package-contract.cjs does not accept it (accepts: ${contractNames.join(', ')}) — producer/validator drift`
)

if (failures.length > 0) {
  console.error('[verify-orcinus-identity] FAILED — fork identity has drifted:')
  for (const f of failures) {
    console.error(`  - ${f}`)
  }
  process.exit(1)
}
console.log(
  `[verify-orcinus-identity] OK — name=${pkg.name} appId=${builder.appId} productName=${builder.productName} ` +
    `publish=${publish.owner}/${publish.repo} feedRefs=${positiveHits} upstreamRefs=0 hostRoot=${tsRoot} appImage=${appImageName}`
)
