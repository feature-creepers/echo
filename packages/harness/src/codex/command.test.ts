import { describe, expect, it } from 'vitest'
import { commandLine, shownCommand } from './command.ts'

describe('a command of Codex, as the person reads it', () => {
  it.each([
    // What Codex 0.169 gave on Windows, its shell's path quoted for a POSIX shell.
    [`"C:\\\\Program Files\\\\PowerShell\\\\7\\\\pwsh.exe" -Command 'git --version; echo two lines > note.txt'`, 'git --version; echo two lines > note.txt'],
    [`'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' -NoProfile -Command 'Get-ChildItem'`, 'Get-ChildItem'],
    [`powershell.exe -NoLogo -c Get-Location`, 'Get-Location'],
    [`pwsh -Command Get-ChildItem -Force`, 'Get-ChildItem -Force'],
    [`/bin/bash -lc 'ls -la | wc -l'`, 'ls -la | wc -l'],
    [`bash -lc 'echo '"'"'hi'"'"''`, `echo 'hi'`],
    [`/bin/zsh -lc "echo \\"hi\\" \\$HOME"`, 'echo "hi" $HOME'],
    [`sh -c ls`, 'ls'],
    [`cmd.exe /c dir /b`, 'dir /b'],
    [`C:\\Windows\\System32\\cmd.exe /C "type a.txt"`, '"type a.txt"'],
    // Not a shell given a line: as given.
    ['git status', 'git status'],
    ['bash script.sh', 'bash script.sh'],
    [`bash -lc`, 'bash -lc'],
    [`bash -lc 'ls`, `bash -lc 'ls`],
    [`bash -c 'echo $0' first`, `bash -c 'echo $0' first`],
    [`bash -o pipefail -c 'ls | wc -l'`, `bash -o pipefail -c 'ls | wc -l'`],
    [`pwsh -File build.ps1`, 'pwsh -File build.ps1'],
    ['ls', 'ls']
  ])('%s', (line, shown) => {
    expect(shownCommand(line)).toBe(shown)
  })

  it('reads the words older versions give as one line first', () => {
    expect(shownCommand(commandLine(['/bin/bash', '-lc', "cat 'my notes.md'"]))).toBe("cat 'my notes.md'")
    expect(commandLine(['ls', 'my notes'])).toBe("ls 'my notes'")
    expect(commandLine(undefined)).toBe('')
  })
})
