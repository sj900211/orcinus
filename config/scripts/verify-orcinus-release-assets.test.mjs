import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getRequiredOrcinusReleaseAssetNames,
  verifyOrcinusReleaseAssets
} from './verify-orcinus-release-assets.mjs'

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: vi.fn(async () => body),
    text: vi.fn(async () => (typeof body === 'string' ? body : JSON.stringify(body)))
  }
}

function releaseWithAssets(tag, assetNames) {
  return {
    tag_name: tag,
    draft: true,
    prerelease: false,
    assets: assetNames.map((name, index) => ({
      id: index + 1,
      name,
      state: 'uploaded',
      size: 123
    }))
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getRequiredOrcinusReleaseAssetNames', () => {
  it('requires the rebranded Windows and Linux x64 assets', () => {
    expect(getRequiredOrcinusReleaseAssetNames('v1.4.27')).toEqual(
      expect.arrayContaining([
        'latest.yml',
        'orcinus-windows-setup.exe',
        'orcinus-windows-setup.exe.blockmap',
        'latest-linux.yml',
        'orcinus-linux.AppImage',
        'orca-ide_1.4.27_amd64.deb'
      ])
    )
  })

  // The fork's release matrix is Windows + Linux x64 only: no Apple Developer
  // ID means unsigned mac builds cannot auto-update, and arm64 stays out until
  // decided. Requiring those assets would make the publish gate unsatisfiable.
  it('does not require macOS, arm64, rpm, or upstream-named assets', () => {
    const names = getRequiredOrcinusReleaseAssetNames('v1.4.27')
    expect(names).not.toEqual(expect.arrayContaining(['latest-mac.yml']))
    expect(names).not.toEqual(expect.arrayContaining(['latest-linux-arm64.yml']))
    expect(names.some((name) => name.includes('mac'))).toBe(false)
    expect(names.some((name) => name.includes('arm64'))).toBe(false)
    expect(names.some((name) => name.endsWith('.rpm'))).toBe(false)
    expect(names.some((name) => name.startsWith('orca-windows'))).toBe(false)
    expect(names.some((name) => name.startsWith('orca-linux'))).toBe(false)
  })
})

describe('verifyOrcinusReleaseAssets', () => {
  it('accepts a release carrying every required asset', async () => {
    const tag = 'v1.4.27'
    const release = releaseWithAssets(tag, getRequiredOrcinusReleaseAssetNames(tag))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([release]))
      .mockResolvedValue(jsonResponse('version: 1.4.27\n'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await verifyOrcinusReleaseAssets({ repo: 'sj900211/orcinus', tag, token: 't' })
    expect(result.tag).toBe(tag)
    expect(result.checked).toEqual(expect.arrayContaining(['orcinus-windows-setup.exe']))
  })

  it('fails when a required asset is missing', async () => {
    const tag = 'v1.4.27'
    const assets = getRequiredOrcinusReleaseAssetNames(tag).filter(
      (name) => name !== 'orcinus-windows-setup.exe'
    )
    const release = releaseWithAssets(tag, assets)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([release]))
      .mockResolvedValue(jsonResponse('version: 1.4.27\n'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      verifyOrcinusReleaseAssets({ repo: 'sj900211/orcinus', tag, token: 't' })
    ).rejects.toThrow('Missing: orcinus-windows-setup.exe')
  })

  // The drift detector: latest*.yml names the real electron-builder output, so
  // an asset renamed by a config change is caught even if the static list lags.
  it('fails when a manifest-referenced asset has not been uploaded', async () => {
    const tag = 'v1.4.27'
    const release = releaseWithAssets(tag, getRequiredOrcinusReleaseAssetNames(tag))
    const linuxManifest = release.assets.find((asset) => asset.name === 'latest-linux.yml')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([release]))
      .mockImplementation(async (url) => {
        if (String(url).endsWith(`/assets/${linuxManifest.id}`)) {
          return jsonResponse(
            [
              'version: 1.4.27',
              'files:',
              '  - url: orcinus-linux.AppImage.blockmap',
              'path: orcinus-linux.AppImage'
            ].join('\n')
          )
        }
        return jsonResponse('version: 1.4.27\n')
      })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      verifyOrcinusReleaseAssets({ repo: 'sj900211/orcinus', tag, token: 't' })
    ).rejects.toThrow('Missing: orcinus-linux.AppImage.blockmap')
    expect(linuxManifest).toBeTruthy()
  })
})
