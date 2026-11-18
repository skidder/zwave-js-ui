#!/usr/bin/env node
/**
 * Writes pnpm overrides into pnpm-workspace.yaml so zwave-js, the internal
 * @zwave-js/* packages and @zwave-js/server resolve to the patched packages
 * in ./vendor instead of the npm registry. pnpm >= 10 ignores the "pnpm"
 * field in package.json; overrides live in pnpm-workspace.yaml.
 *
 * Usage: node scripts/apply-patched-deps.mjs
 * Layout expected: vendor/<sanitized-name>/package.json
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const vendorDir = "vendor";
const overrides = {};
let count = 0;

for (const entry of readdirSync(vendorDir)) {
	const pkgJsonPath = join(vendorDir, entry, "package.json");
	try {
		const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
		if (!pkg.name || !pkg.version) continue;
		overrides[pkg.name] = "link:" + join(vendorDir, entry);
		count++;
		console.log("override " + pkg.name + "@" + pkg.version + " -> " + overrides[pkg.name]);
	} catch {
		// entry without a package.json at its root; skip
	}
}

if (count === 0) {
	console.error("No vendor packages found in ./vendor");
	process.exit(1);
}

const wsPath = join(process.cwd(), "pnpm-workspace.yaml");
let ws;
if (existsSync(wsPath)) {
	ws = readFileSync(wsPath, "utf8");
	if (!ws.endsWith("\n")) ws += "\n";
} else {
	ws = "packages:\n  - 'api/*'\n";
}

// Drop any previous overrides block, then prepend a fresh one
ws = ws.replace(/^overrides:\n(?:[ \t].*\n?)*/m, "");
let block = "overrides:\n";
for (const name of Object.keys(overrides)) {
	block += "  '" + name + "': '" + overrides[name] + "'\n";
}
block += "onlyBuiltDependencies:\n";
// dependencies with postinstall scripts that pnpm must be allowed to build
for (const name of ["esbuild", "@serialport/bindings-cpp", "docsify", "vue-demi"]) {
	block += "  - '" + name + "'\n";
}
writeFileSync(wsPath, block + "\n" + ws);
console.log("Wrote " + count + " overrides into pnpm-workspace.yaml");
