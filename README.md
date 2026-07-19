# dotagents

[![CI](https://github.com/mikan-919/dotagents/actions/workflows/ci.yml/badge.svg)](https://github.com/mikan-919/dotagents/actions/workflows/ci.yml)

Keep one `.agent/` directory as the source of truth for AI agent config
(`AGENTS.md`, `skills/`, `commands/`), and symlink it into `.claude`,
`.codex`, `.cursor`, etc. instead of copy-pasting the same files into every
tool's config directory.

## Usage

No install needed — run straight from GitHub:

```bash
bunx github:mikan-919/dotagents link --all
bunx github:mikan-919/dotagents graph
bunx github:mikan-919/dotagents sot
```

`npx github:...` works the same way. (Some sandboxed environments disable
git-based npm installs — if `npx` fails with `EALLOWGIT`, use `bunx` or
clone the repo and run `dist/agent.js` directly.)

Note: `bunx` caches `github:` installs and won't pick up new commits on its
own — if behavior looks stale, clear the cache with
`rm -rf /tmp/bunx-*-dotagents*`.

To use the short `agent` command name, install it globally:

```bash
npm install -g github:mikan-919/dotagents   # or: bun install -g ...
agent link --all
```

## Commands

- **`agent link [tool...] [--all] [--force]`** — symlink `.agent/` content
  into the given tools' config dirs (all known tools if none given).
  Existing real files are left alone unless `--force`.
- **`agent graph`** — print the `.agent/` tree and the current link status
  for every tool:

  ```
  .agent/
  ├── AGENTS.md
  └── skills/
      └── review/
          └── SKILL.md

  .claude/
    ✓ CLAUDE.md  -> ../.agent/AGENTS.md
    ✗ skills     local copy, not linked (run: agent sot)
    · commands   nothing to link
  .codex/
    ✓ AGENTS.md  -> ../.agent/AGENTS.md
    ○ skills     not linked yet (run: agent link)
  ```
- **`agent sot`** — collect content that was edited directly inside a
  tool's config dir (instead of through the symlink) back into `.agent`.
  Identical copies found in multiple tools are merged into one; content
  that exists in only one tool is moved into `.agent` too, then
  distributed everywhere via `link`. Copies that differ are left
  untouched and reported as a conflict for you to resolve by hand.

## Layout

```
.agent/
├── AGENTS.md
├── skills/
└── commands/
```

Each tool maps its own expected file/dir names onto these. The mapping is
a small hardcoded table in `bin/agent.ts` (`TOOLS`) — add a tool by adding
an entry there, then run `npm run build` to regenerate `dist/agent.js`
(the committed file that `bin` actually points to).

| tool   | dir       | links                                              |
|--------|-----------|-----------------------------------------------------|
| claude | `.claude` | `CLAUDE.md`, `skills/`, `commands/`                  |
| codex  | `.codex`  | `AGENTS.md`, `skills/`                               |
| cursor | `.cursor` | `skills/`                                            |

## Requirements

Node >=18 or Bun. Source lives in `bin/agent.ts`; the published/executed
file is the compiled `dist/agent.js`, committed so `npx`/`bunx` never need
to run a build step. (Node's native TS support refuses to strip types for
files under `node_modules`, which is where `npx`/`bunx` install git
dependencies — hence shipping compiled JS instead of running `.ts`
directly.)

Symlinks are POSIX-style (`symlinkSync`), so Windows needs Developer Mode
or an elevated shell; WSL works out of the box.

## Development

```bash
npm ci
npm test    # builds dist/ and runs the node:test suite
```

## License

[MIT](LICENSE)
