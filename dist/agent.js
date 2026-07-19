#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
// ponytail: mapping is a hardcoded table, not inferred from directory structure.
// Add a tool by adding an entry here. Auto-inference can come later if the list grows unwieldy.
const TOOLS = {
    claude: { dir: ".claude", links: [["CLAUDE.md", "AGENTS.md"], ["skills", "skills"], ["commands", "commands"]] },
    codex: { dir: ".codex", links: [["AGENTS.md", "AGENTS.md"], ["skills", "skills"]] },
    cursor: { dir: ".cursor", links: [["skills", "skills"]] },
};
const AGENT_DIR = ".agent";
function isSymlinkTo(targetPath, sourcePath) {
    if (!existsSync(targetPath) && !isBrokenSymlink(targetPath))
        return false;
    const st = lstatSync(targetPath, { throwIfNoEntry: false });
    if (!st?.isSymbolicLink())
        return false;
    const resolved = resolve(dirname(targetPath), readlinkSync(targetPath));
    return resolved === resolve(sourcePath);
}
function isBrokenSymlink(p) {
    const st = lstatSync(p, { throwIfNoEntry: false });
    return !!st?.isSymbolicLink();
}
function ensureAgentDir(cwd) {
    const agentDir = join(cwd, AGENT_DIR);
    if (!existsSync(agentDir)) {
        mkdirSync(agentDir);
        console.log(`+ ${AGENT_DIR}/ created`);
    }
    return agentDir;
}
function link(cwd, toolNames, force) {
    const agentDir = ensureAgentDir(cwd);
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
            if (!existsSync(sourcePath))
                continue;
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
// content hash of a file or directory tree, for detecting identical items across tools
function contentHash(path) {
    const hash = createHash("sha256");
    const st = lstatSync(path);
    if (st.isDirectory()) {
        for (const name of readdirSync(path).sort()) {
            hash.update(name).update("\0").update(contentHash(join(path, name))).update("\0");
        }
    }
    else {
        hash.update(readFileSync(path));
    }
    return hash.digest("hex");
}
function moveInto(dest, src) {
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(src, dest);
}
function realCopies(cwd, sourceName) {
    const refs = [];
    let kind = null;
    for (const [toolName, tool] of Object.entries(TOOLS)) {
        for (const [target, source] of tool.links) {
            if (source !== sourceName)
                continue;
            const p = join(cwd, tool.dir, target);
            const st = lstatSync(p, { throwIfNoEntry: false });
            if (!st || st.isSymbolicLink())
                continue; // missing, or already linked -> not local content
            refs.push({ tool: toolName, path: p });
            kind ??= st.isDirectory() ? "dir" : "file";
        }
    }
    return kind ? { kind, refs } : null;
}
// merge `copies` of one item into `agentItemPath` (which doesn't exist yet): move the sole copy,
// or dedupe identical copies, or report a conflict and leave everything untouched.
function mergeNewItem(agentItemPath, copies) {
    if (copies.length === 0)
        return false;
    const hashes = copies.map((c) => contentHash(c.path));
    if (new Set(hashes).size > 1) {
        console.log(`x conflict: ${relative(process.cwd(), agentItemPath)} differs across ${copies.map((c) => c.tool).join(", ")} — resolve manually`);
        return false;
    }
    moveInto(agentItemPath, copies[0].path);
    for (const c of copies.slice(1))
        rmSync(c.path, { recursive: true, force: true });
    console.log(`+ ${relative(process.cwd(), agentItemPath)} (from ${copies.map((c) => c.tool).join(", ")})`);
    return true;
}
// reconcile copies of an item that already exists in .agent: drop matching copies (link() will
// re-symlink them), report conflicts and leave mismatched copies alone.
function reconcileExistingItem(agentItemPath, copies) {
    const canonical = contentHash(agentItemPath);
    for (const c of copies) {
        if (contentHash(c.path) === canonical) {
            rmSync(c.path, { recursive: true, force: true });
        }
        else {
            console.log(`x conflict: ${relative(process.cwd(), c.path)} differs from ${relative(process.cwd(), agentItemPath)} — resolve manually`);
        }
    }
}
function sot(cwd) {
    const agentDir = ensureAgentDir(cwd);
    const sourceNames = new Set(Object.values(TOOLS).flatMap((t) => t.links.map(([, source]) => source)));
    for (const sourceName of sourceNames) {
        const found = realCopies(cwd, sourceName);
        const agentPath = join(agentDir, sourceName);
        if (!found && !existsSync(agentPath))
            continue;
        const kind = found?.kind ?? (lstatSync(agentPath).isDirectory() ? "dir" : "file");
        const refs = found?.refs ?? [];
        if (kind === "file") {
            if (existsSync(agentPath))
                reconcileExistingItem(agentPath, refs);
            else
                mergeNewItem(agentPath, refs);
            continue;
        }
        // dir: merge per top-level item, not the whole directory
        mkdirSync(agentPath, { recursive: true });
        const itemNames = new Set(readdirSync(agentPath));
        for (const ref of refs)
            for (const child of readdirSync(ref.path))
                itemNames.add(child);
        for (const itemName of itemNames) {
            const agentItemPath = join(agentPath, itemName);
            const copies = refs
                .map((r) => ({ tool: r.tool, path: join(r.path, itemName) }))
                .filter((c) => existsSync(c.path));
            if (existsSync(agentItemPath))
                reconcileExistingItem(agentItemPath, copies);
            else
                mergeNewItem(agentItemPath, copies);
        }
        // drop now-empty tool copies so link() can replace them with a whole-directory symlink
        for (const ref of refs) {
            if (existsSync(ref.path) && readdirSync(ref.path).length === 0)
                rmSync(ref.path, { recursive: true });
        }
    }
    console.log("");
    link(cwd, Object.keys(TOOLS), false);
}
function tree(dir, prefix = "") {
    if (!existsSync(dir))
        return [];
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    const lines = [];
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
const color = process.stdout.isTTY && !process.env.NO_COLOR
    ? (code, s) => `\x1b[${code}m${s}\x1b[0m`
    : (_, s) => s;
function graph(cwd) {
    const agentDir = join(cwd, AGENT_DIR);
    const agentTree = tree(agentDir);
    console.log(`${AGENT_DIR}/${agentTree.length ? "" : color("2", "  (empty)")}`);
    if (agentTree.length)
        console.log(agentTree.join("\n"));
    console.log("");
    for (const tool of Object.values(TOOLS)) {
        const toolDir = join(cwd, tool.dir);
        if (!existsSync(toolDir))
            continue;
        console.log(`${tool.dir}/`);
        const width = Math.max(...tool.links.map(([t]) => t.length));
        for (const [target, source] of tool.links) {
            const targetPath = join(toolDir, target);
            const sourcePath = join(agentDir, source);
            const pad = target.padEnd(width);
            if (isSymlinkTo(targetPath, sourcePath)) {
                console.log(`  ${color("32", "✓")} ${pad}  ${color("2", `-> ${relative(toolDir, sourcePath)}`)}`);
            }
            else if (existsSync(targetPath)) {
                console.log(`  ${color("31", "✗")} ${pad}  local copy, not linked ${color("2", "(run: agent sot)")}`);
            }
            else if (existsSync(sourcePath)) {
                console.log(`  ${color("33", "○")} ${pad}  not linked yet ${color("2", "(run: agent link)")}`);
            }
            else {
                console.log(`  ${color("2", `· ${pad}  nothing to link`)}`);
            }
        }
    }
}
const USAGE = `usage: agent <command> [options]

commands:
  link [tool...] [--all] [--force]   symlink .agent/ into tool config dirs
  graph                              show .agent/ tree and current links
  sot                                collect real content scattered across tool dirs back
                                      into .agent (deduping identical items, flagging
                                      conflicting ones), then link it out to every tool

options:
  -h, --help      show this help
  -v, --version   show version

known tools: ${Object.keys(TOOLS).join(", ")}`;
function parseCli() {
    try {
        return parseArgs({
            allowPositionals: true,
            options: {
                force: { type: "boolean", default: false },
                all: { type: "boolean", default: false },
                help: { type: "boolean", short: "h", default: false },
                version: { type: "boolean", short: "v", default: false },
            },
        });
    }
    catch (e) {
        console.error(`${e.message}\n\n${USAGE}`);
        process.exit(1);
    }
}
const { positionals, values } = parseCli();
const [command, ...rest] = positionals;
const cwd = process.cwd();
if (values.version) {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    console.log(pkg.version);
}
else if (values.help || !command) {
    console.log(USAGE);
}
else {
    switch (command) {
        case "link": {
            const toolNames = values.all || rest.length === 0 ? Object.keys(TOOLS) : rest;
            link(cwd, toolNames, values.force);
            break;
        }
        case "graph":
            graph(cwd);
            break;
        case "sot":
            sot(cwd);
            break;
        default:
            console.error(`unknown command: ${command}\n\n${USAGE}`);
            process.exitCode = 1;
    }
}
