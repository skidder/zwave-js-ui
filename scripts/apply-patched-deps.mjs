#!/usr/bin/env node
/**
 * Rewrites package.json pnpm.overrides so zwave-js, the internal
 * @zwave-js/* packages and @zwave-js/server resolve to the patched packages
 * in ./vendor instead of the npm registry.
 *
 * Usage: node scripts/apply-patched-deps.mjs
 * Layout expected: vendor/<sanitized-name>/package.json
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
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

const pkgPath = join(process.cwd(), "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.pnpm = pkg.pnpm ?? {};
pkg.pnpm.overrides = Object.assign({}, pkg.pnpm.overrides ?? {}, overrides);
writeFileSync(pkgPath, JSON.stringify(pkg, null, "\t") + "\n");
console.log("Wrote " + count + " overrides into package.json");
