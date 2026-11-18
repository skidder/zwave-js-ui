#!/usr/bin/env node
/**
 * Writes npm "overrides" into package.json so zwave-js, the internal
 * @zwave-js/* packages and @zwave-js/server resolve to the patched packages
 * in ./vendor instead of the npm registry. This repo is npm-based
 * (package-lock.json); npm supports local overrides via the "overrides".
 *
 * Usage: node scripts/apply-patched-deps.mjs
 * Layout expected: vendor/<sanitized-name>/package.json
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const vendorDir = "vendor";
const overrides = {};
let count = 0;

const pkgPath = join(process.cwd(), "package.json");
const rootPkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const directDeps = Object.assign({}, rootPkg.dependencies ?? {}, rootPkg.devDependencies ?? {});
const direct = {};
for (const entry of readdirSync(vendorDir)) {
	const pkgJsonPath = join(vendorDir, entry, "package.json");
	try {
		const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
		if (!pkg.name || !pkg.version) continue;
		// npm forbids overriding direct deps via "overrides": rewrite the
		// dependency spec itself instead; transitives go through overrides
		if (pkg.name in directDeps) {
			direct[pkg.name] = "file:" + join("vendor", entry);
		} else {
			overrides[pkg.name] = "file:" + join("vendor", entry);
		}
		count++;
		console.log("override " + key + " -> " + overrides[key]);
	} catch {
		// entry without a package.json at its root; skip
	}
}

if (count === 0) {
	console.error("No vendor packages found in ./vendor");
	process.exit(1);
}

for (const [name, target] of Object.entries(direct)) {
	if (rootPkg.dependencies && name in rootPkg.dependencies) rootPkg.dependencies[name] = target;
	else if (rootPkg.devDependencies && name in rootPkg.devDependencies) rootPkg.devDependencies[name] = target;
}
rootPkg.overrides = Object.assign({}, rootPkg.overrides ?? {}, overrides);
writeFileSync(pkgPath, JSON.stringify(rootPkg, null, "\t") + "\n");
console.log("Wrote " + count + " npm overrides into package.json");
