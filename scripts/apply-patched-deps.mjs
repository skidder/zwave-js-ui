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
// pin the toolchain to the lockfile version: TS 6 changes rootDir inference
if (rootPkg.devDependencies && rootPkg.devDependencies.typescript) {
	rootPkg.devDependencies.typescript = "5.9.3";
}
rootPkg.overrides = Object.assign({}, rootPkg.overrides ?? {}, overrides);
writeFileSync(pkgPath, JSON.stringify(rootPkg, null, "\t") + "\n");
// npm does not apply "overrides" inside file: dependency subtrees, so
// rewrite each vendored package's own @zwave-js/* / zwave-js deps to sibling
// vendor dirs before install
const nameToDir = {};
for (const entry of readdirSync(vendorDir)) {
	try {
		const pkg = JSON.parse(readFileSync(join(vendorDir, entry, "package.json"), "utf8"));
		if (pkg.name) nameToDir[pkg.name] = entry;
	} catch {}
}
for (const entry of readdirSync(vendorDir)) {
	const p2 = join(vendorDir, entry, "package.json");
	let pkg;
	try { pkg = JSON.parse(readFileSync(p2, "utf8")); } catch { continue; }
	let changed = false;
	for (const field of ["dependencies", "peerDependencies", "devDependencies"]) {
		if (!pkg[field]) continue;
		for (const dep of Object.keys(pkg[field])) {
			if (dep === pkg.name) continue;
			if (nameToDir[dep]) {
				pkg[field][dep] = "file:../" + nameToDir[dep];
				changed = true;
				continue;
			}
			// normalize yarn-specific protocols npm cannot resolve
			const spec = pkg[field][dep];
			if (spec.startsWith("patch:")) {
				// patch:<inner>#<patchfile> -> <inner> (strip npm: prefix if present)
				let inner = spec.slice("patch:".length).split("#")[0];
				if (inner.startsWith("npm:")) inner = inner.slice(4);
				pkg[field][dep] = inner;
				changed = true;
			} else if (spec.includes("patch:")) {
				// e.g. "^1.2.3(patch:...)" -> range before the parenthetical
				pkg[field][dep] = spec.split("(patch")[0];
				changed = true;
			}
		}
	}
	// vendored tarballs are prebuilt: never let npm run their lifecycle scripts
	pkg.scripts = {};
	writeFileSync(p2, JSON.stringify(pkg, null, "\t") + "\n");
	if (changed) console.log("rewrote internal deps of " + entry);
}
console.log("Wrote " + count + " npm overrides into package.json");
