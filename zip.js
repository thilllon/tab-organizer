import { createWriteStream, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import archiver from 'archiver'

const manifest = JSON.parse(readFileSync('./dist/manifest.json', 'utf-8'))
const name = manifest.name.replaceAll(' ', '-')
const filename = `${name}-${manifest.version}.zip`

mkdirSync('package', { recursive: true })

const output = createWriteStream(path.join('package', filename))
const archive = archiver('zip', { zlib: { level: 9 } })

output.on('close', () => {
  console.log(`Packaged: package/${filename} (${archive.pointer()} bytes)`)
})

archive.on('error', (err) => {
  throw err
})

archive.pipe(output)
archive.directory('dist/', false)
await archive.finalize()
