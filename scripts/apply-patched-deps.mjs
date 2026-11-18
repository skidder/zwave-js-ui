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

const rootPkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
const directDeps = Object.assign({}, rootPkg.dependencies ?? {}, rootPkg.devDependencies ?? {});
for (const entry of readdirSync(vendorDir)) {
	const pkgJsonPath = join(vendorDir, entry, "package.json");
	try {
		const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
		if (!pkg.name || !pkg.version) continue;
		// npm requires name@version keys when overriding a direct dependency
		const key = pkg.name in directDeps ? pkg.name + "@" + pkg.version : pkg.name;
		overrides[key] = "file:" + join("vendor", entry);
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

const pkgPath = join(process.cwd(), "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.overrides = Object.assign({}, pkg.overrides ?? {}, overrides);
writeFileSync(pkgPath, JSON.stringify(pkg, null, "\t") + "\n");
console.log("Wrote " + count + " npm overrides into package.json");
