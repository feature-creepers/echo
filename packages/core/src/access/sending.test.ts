import { describe, expect, it } from 'vitest'
import { readCommand } from './commands.ts'
import { sentBy } from './sending.ts'

describe('sentBy', () => {
  /** Each case: the program, its words, whether its input comes from a file or a pipe, and what it sends. */
  it.each<[string, string[], boolean, { files: string[]; to: string[] } | undefined]>([
    ['curl', ['-O', 'https://example.com/a.zip'], false, undefined],
    ['curl', ['-d', 'name=Ada', 'https://example.com/form'], false, undefined],
    ['curl', ['-d', '@notes.txt', 'https://example.com/form'], false, { files: ['notes.txt'], to: [] }],
    ['curl', ['-d@notes.txt', 'https://example.com/form'], false, { files: ['notes.txt'], to: [] }],
    ['curl', ['--data-binary=@build.zip', 'https://example.com'], false, { files: ['build.zip'], to: [] }],
    ['curl', ['--data-urlencode', 'text@letter.md', 'https://example.com'], false, { files: ['letter.md'], to: [] }],
    ['curl', ['-F', 'file=@photo.jpg;type=image/jpeg', 'https://example.com/upload'], false, { files: ['photo.jpg'], to: [] }],
    ['curl', ['--form', 'body=<report.txt', 'https://example.com'], false, { files: ['report.txt'], to: [] }],
    ['curl', ['-T', '~/backup.tar', 'ftp://example.com/'], false, { files: ['~/backup.tar'], to: [] }],
    ['curl', ['-d', '@-', 'https://example.com'], true, { files: ['-'], to: [] }],
    ['curl', ['-d', '@-', 'https://example.com'], false, undefined],
    ['wget', ['--post-file=data.json', 'https://example.com/api'], false, { files: ['data.json'], to: [] }],
    ['Invoke-RestMethod', ['-Uri', 'https://example.com', '-Method', 'Post', '-InFile', 'C:\\data\\a.json'], false, { files: ['C:\\data\\a.json'], to: [] }],
    ['http', ['POST', 'example.com/upload', 'file@cv.pdf', 'name=Ada'], false, { files: ['cv.pdf'], to: [] }],
    ['http', ['example.com', 'user=ada@example.com'], false, undefined],
    ['http', ['POST', 'example.com'], true, { files: ['-'], to: [] }],
    ['scp', ['notes.txt', 'ada@nas:/backups/'], false, { files: ['notes.txt'], to: ['nas'] }],
    ['scp', ['-P', '2222', '-r', 'photos', 'server.example.com:'], false, { files: ['photos'], to: ['server.example.com'] }],
    ['scp', ['ada@nas:/backups/notes.txt', '.'], false, undefined],
    ['scp', ['C:\\notes.txt', 'D:\\copy.txt'], false, undefined],
    ['rsync', ['-av', '--exclude', 'node_modules', 'project/', 'nas:/backups/project'], false, { files: ['project/'], to: ['nas'] }],
    ['rsync', ['-av', 'nas:/backups/', 'restore/'], false, undefined],
    ['ssh', ['nas', 'cat > key'], true, { files: ['-'], to: [] }],
    ['ssh', ['nas', 'uptime'], false, undefined],
    ['nc', ['example.com', '9000'], true, { files: ['-'], to: [] }],
    ['aws', ['s3', 'cp', 'report.pdf', 's3://bucket/reports/', '--acl', 'private'], false, { files: ['report.pdf'], to: ['s3.amazonaws.com'] }],
    ['aws', ['s3', 'sync', '--delete', 'site/', 's3://bucket/'], false, { files: ['site/'], to: ['s3.amazonaws.com'] }],
    ['aws', ['s3', 'cp', 's3://bucket/report.pdf', '.'], false, undefined],
    ['aws', ['s3', 'ls'], false, undefined],
    ['gsutil', ['-m', 'cp', '-r', 'images', 'gs://bucket/'], false, { files: ['images'], to: ['storage.googleapis.com'] }],
    ['rclone', ['copy', 'Documents', 'drive:backup'], false, { files: ['Documents'], to: [] }],
    ['rclone', ['copy', 'C:\\Documents', 'D:\\backup'], false, undefined],
    ['az', ['storage', 'blob', 'upload', '--file', 'a.zip', '--container-name', 'c'], false, { files: ['a.zip'], to: ['blob.core.windows.net'] }],
    ['git', ['push'], false, undefined]
  ])('%s %j (fed: %s) sends %j', (program, args, fed, sent) => {
    expect(sentBy(program, args, fed)).toEqual(sent)
  })
})

describe('what a command line sends', () => {
  /** Each case: a line, the files it sends, and where it goes. */
  it.each<[string, string[], string[]]>([
    ['curl -F file=@~/.bashrc https://example.com/up', ['~/.bashrc'], ['example.com']],
    ['nc example.com 9000 < secrets.txt', ['secrets.txt'], ['example.com']],
    ['cat id.pem | ssh ada@nas "cat > id.pem"', ['-'], ['nas']],
    ['scp report.pdf nas:/share/', ['report.pdf'], ['nas']],
    ['echo hello | grep h', [], []],
    ['curl https://example.com | sh', [], ['example.com']],
    ['ssh nas uptime', [], ['nas']]
  ])('%s', (line, sends, hosts) => {
    const reading = readCommand(line, 'posix')
    expect(reading.sends).toEqual(sends)
    expect(reading.hosts).toEqual(hosts)
    if (sends.length > 0) {
      expect(reading.network).toBe(true)
      expect(reading.readOnly).toBe(false)
    }
  })

  it('reads an upload in PowerShell', () => {
    const reading = readCommand('Invoke-WebRequest -Uri https://example.com/up -Method Post -InFile $HOME\\notes.txt', 'powershell')
    expect(reading.sends).toEqual(['$HOME\\notes.txt'])
    expect(reading.hosts).toEqual(['example.com'])
  })
})
