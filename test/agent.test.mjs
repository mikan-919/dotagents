import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, lstatSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../dist/agent.js", import.meta.url));

function run(cwd, ...args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });
  return { status: r.status, out: r.stdout + r.stderr };
}

function sandbox(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "dotagents-"));
  for (const [path, content] of Object.entries(files)) {
    const p = join(dir, path);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

test("link creates symlinks for all tools", () => {
  const dir = sandbox({ ".agents/AGENTS.md": "# hi\n", ".agents/skills/review/SKILL.md": "review\n" });
  const { status, out } = run(dir, "link", "--all");
  assert.equal(status, 0);
  assert.match(out, /\+ \.claude\/CLAUDE\.md/);
  assert.ok(lstatSync(join(dir, ".claude/CLAUDE.md")).isSymbolicLink());
  assert.equal(readFileSync(join(dir, ".claude/CLAUDE.md"), "utf8"), "# hi\n");
  assert.equal(readFileSync(join(dir, ".codex/skills/review/SKILL.md"), "utf8"), "review\n");
});

test("link refuses to clobber a real file without --force", () => {
  const dir = sandbox({ ".agents/AGENTS.md": "new\n", ".claude/CLAUDE.md": "precious\n" });
  let r = run(dir, "link", "claude");
  assert.match(r.out, /skipping/);
  assert.equal(readFileSync(join(dir, ".claude/CLAUDE.md"), "utf8"), "precious\n");
  r = run(dir, "link", "claude", "--force");
  assert.ok(lstatSync(join(dir, ".claude/CLAUDE.md")).isSymbolicLink());
});

test("link creates a missing .agents/ instead of erroring", () => {
  const empty = sandbox();
  const { status, out } = run(empty, "link");
  assert.equal(status, 0);
  assert.match(out, /\.agents\/ created/);
  assert.ok(lstatSync(join(empty, ".agents")).isDirectory());
});

test("legacy .agent/ is migrated to .agents/ and stale links are re-pointed", () => {
  const dir = sandbox({ ".agent/AGENTS.md": "hi\n" });
  let r = run(dir, "link", "claude");
  assert.match(r.out, /renamed to \.agents\//);
  assert.equal(readFileSync(join(dir, ".agents/AGENTS.md"), "utf8"), "hi\n");
  assert.ok(!existsSync(join(dir, ".agent")));
  assert.equal(readFileSync(join(dir, ".claude/CLAUDE.md"), "utf8"), "hi\n");
  // simulate a link left over from before the rename: broken symlink gets fixed without --force
  const codexMd = join(dir, ".codex/AGENTS.md");
  mkdirSync(join(dir, ".codex"), { recursive: true });
  symlinkSync("../.agent/AGENTS.md", codexMd);
  r = run(dir, "link", "codex");
  assert.equal(readFileSync(codexMd, "utf8"), "hi\n");
});

test("link errors on unknown tool", () => {
  const dir = sandbox({ ".agents/AGENTS.md": "x\n" });
  const r = run(dir, "link", "nope");
  assert.equal(r.status, 1);
  assert.match(r.out, /unknown tool/);
});

test("sot merges identical copies and moves unique ones into .agents", () => {
  const dir = sandbox({
    ".agents/.keep": "",
    ".claude/skills/review/SKILL.md": "same\n",
    ".codex/skills/review/SKILL.md": "same\n",
    ".claude/skills/refactor/SKILL.md": "only claude\n",
  });
  const { status, out } = run(dir, "sot");
  assert.equal(status, 0);
  assert.equal(readFileSync(join(dir, ".agents/skills/review/SKILL.md"), "utf8"), "same\n");
  assert.equal(readFileSync(join(dir, ".agents/skills/refactor/SKILL.md"), "utf8"), "only claude\n");
  assert.ok(lstatSync(join(dir, ".claude/skills")).isSymbolicLink());
  assert.ok(lstatSync(join(dir, ".codex/skills")).isSymbolicLink());
  assert.doesNotMatch(out, /conflict/);
});

test("sot reports conflicts and leaves both copies untouched", () => {
  const dir = sandbox({
    ".agents/.keep": "",
    ".claude/CLAUDE.md": "claude version\n",
    ".codex/AGENTS.md": "codex version\n",
  });
  const { out } = run(dir, "sot");
  assert.match(out, /conflict/);
  assert.equal(readFileSync(join(dir, ".claude/CLAUDE.md"), "utf8"), "claude version\n");
  assert.equal(readFileSync(join(dir, ".codex/AGENTS.md"), "utf8"), "codex version\n");
  assert.ok(!existsSync(join(dir, ".agents/AGENTS.md")));
});

test("sot is idempotent", () => {
  const dir = sandbox({ ".agents/AGENTS.md": "x\n", ".claude/skills/a/SKILL.md": "a\n" });
  run(dir, "sot");
  const { status, out } = run(dir, "sot");
  assert.equal(status, 0);
  assert.doesNotMatch(out, /conflict/);
});

test("graph shows link status", () => {
  const dir = sandbox({ ".agents/AGENTS.md": "x\n", ".claude/CLAUDE.md": "local\n" });
  const { status, out } = run(dir, "graph");
  assert.equal(status, 0);
  assert.match(out, /AGENTS\.md/);
  assert.match(out, /not linked/);
});

test("--help exits 0, unknown command/flag exit 1", () => {
  const dir = sandbox();
  assert.equal(run(dir, "--help").status, 0);
  assert.equal(run(dir, "--version").status, 0);
  assert.equal(run(dir, "bogus").status, 1);
  assert.equal(run(dir, "link", "--bogus").status, 1);
});
