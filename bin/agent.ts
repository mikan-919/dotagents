#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

// ponytail: mapping is a hardcoded table, not inferred from directory structure.
// Add a tool by adding an entry here. Auto-inference can come later if the list grows unwieldy.
const TOOLS: Record<string, { dir: string; links: [target: string, source: string][] }> = {
  claude: { dir: ".claude", links: [["CLAUDE.md", "AGENTS.md"], ["skills", "skills"], ["commands", "commands"]] },
  codex: { dir: ".codex", links: [["AGENTS.md", "AGENTS.md"], ["skills", "skills"]] },
  cursor: { dir: ".cursor", links: [["skills", "skills"]] },
};

const AGENT_DIR = ".agent";

function isSymlinkTo(targetPath: string, sourcePath: string): boolean {
  if (!existsSync(targetPath) && !isBrokenSymlink(targetPath)) return false;
  const st = lstatSync(targetPath, { throwIfNoEntry: false });
  if (!st?.isSymbolicLink()) return false;
  const resolved = resolve(dirname(targetPath), readlinkSync(targetPath));
  return resolved === resolve(sourcePath);
}

function isBrokenSymlink(p: string): boolean {
  const st = lstatSync(p, { throwIfNoEntry: false });
  return !!st?.isSymbolicLink();
}

function link(cwd: string, toolNames: string[], force: boolean) {
  const agentDir = join(cwd, AGENT_DIR);
  if (!existsSync(agentDir)) {
    console.error(`${AGENT_DIR}/ not found in ${cwd}`);
    process.exitCode = 1;
    return;
  }

  for (const name of toolNames) {
    const tool = TOOLS[name];
    if (!tool) {
      console.error(`unknown tool: ${name} (known: ${Object.keys(TOOLS).join(", ")})`);
      process.exitCode = 1;
      continue;
    }
    const toolDir = join(cwd, tool.dir);
    for (const [target, source] of tool.links) {
      const sourcePath = join(agentDir, source);
      if (!existsSync(sourcePath)) continue;
      const targetPath = join(toolDir, target);

      if (isSymlinkTo(targetPath, sourcePath)) {
        console.log(`= ${relative(cwd, targetPath)} (already linked)`);
        continue;
      }
      if (existsSync(targetPath) || isBrokenSymlink(targetPath)) {
        if (!force) {
          console.log(`! ${relative(cwd, targetPath)} exists and is not a matching symlink, skipping (use --force)`);
          continue;
        }
        unlinkSync(targetPath);
      }
      mkdirSync(dirname(targetPath), { recursive: true });
      symlinkSync(relative(dirname(targetPath), sourcePath), targetPath);
      console.log(`+ ${relative(cwd, targetPath)} -> ${relative(cwd, sourcePath)}`);
    }
  }
}

function tree(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const lines: string[] = [];
  entries.forEach((entry, i) => {
    const last = i === entries.length - 1;
    const branch = last ? "└── " : "├── ";
    const name = entry.isDirectory() ? `${entry.name}/` : entry.name;
    lines.push(prefix + branch + name);
    if (entry.isDirectory()) {
      lines.push(...tree(join(dir, entry.name), prefix + (last ? "    " : "│   ")));
    }
  });
  return lines;
}

function graph(cwd: string) {
  const agentDir = join(cwd, AGENT_DIR);
  console.log(`${AGENT_DIR}/`);
  console.log(tree(agentDir).join("\n"));

  console.log("\nLinks");
  for (const [name, tool] of Object.entries(TOOLS)) {
    const toolDir = join(cwd, tool.dir);
    if (!existsSync(toolDir)) continue;
    console.log(tool.dir);
    for (const [target, source] of tool.links) {
      const targetPath = join(toolDir, target);
      const sourcePath = join(agentDir, source);
      const linked = isSymlinkTo(targetPath, sourcePath);
      const mark = linked ? "->" : existsSync(targetPath) ? "!! (not linked)" : "  (missing)";
      console.log(`  ${target} ${mark} ${linked ? relative(toolDir, sourcePath) : ""}`.trimEnd());
    }
  }
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    force: { type: "boolean", default: false },
    all: { type: "boolean", default: false },
  },
});

const [command, ...rest] = positionals;
const cwd = process.cwd();

switch (command) {
  case "link": {
    const toolNames = values.all || rest.length === 0 ? Object.keys(TOOLS) : rest;
    link(cwd, toolNames, values.force);
    break;
  }
  case "graph":
    graph(cwd);
    break;
  default:
    console.log(`usage: agent <command>

commands:
  link [tool...] [--all] [--force]   symlink .agent/ into tool config dirs
  graph                              show .agent/ tree and current links

known tools: ${Object.keys(TOOLS).join(", ")}`);
    process.exitCode = command ? 1 : 0;
}
