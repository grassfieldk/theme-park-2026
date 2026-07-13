import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = resolve(root, 'recovery/assets')
const destinationRoot = resolve(root, 'public/assets')
const manifest = JSON.parse(await readFile(resolve(root, 'src/config/web-assets.json'), 'utf8'))

/** 指定パスが対象ディレクトリの内部にあることを確認する */
function inside(rootPath, path) {
  return path === rootPath || path.startsWith(`${rootPath}${sep}`)
}

await rm(destinationRoot, { recursive: true, force: true })

for (const asset of manifest.assets) {
  const source = resolve(sourceRoot, asset.source)
  const destination = resolve(destinationRoot, asset.target)
  if (!inside(sourceRoot, source) || !inside(destinationRoot, destination)) {
    throw new Error(`アセットのパスが不正です: ${asset.source}`)
  }
  await mkdir(dirname(destination), { recursive: true })
  await cp(source, destination)
}

console.log(`${manifest.assets.length} 件の Web 用アセットを同期しました`)
