// Installs the Roc release pinned in test/roc-version.txt with the extension's own installer into
// .vscode-test/roc and prints the roc executable path. CI uses this both to exercise the installer
// and to get a roc for the integration tests.
import { appendFileSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchLatestRelease, fetchRelease, installRelease, removeOtherInstalls } from "../../src/install";

const storageDir = fileURLToPath(new URL("../../.vscode-test/roc", import.meta.url));
const tag = readFileSync(new URL("../../test/roc-version.txt", import.meta.url), "utf8").trim();
const token = process.env["GITHUB_TOKEN"];
const release = await fetchRelease(tag, undefined, token);
const installed = await installRelease({ release, storageDir, platform: process.platform, arch: process.arch });
await removeOtherInstalls(storageDir, installed.tag);

// A digest that doesn't match the download must be rejected.
const tampered = structuredClone(release);
for (const asset of tampered.assets) asset.digest = `sha256:${"0".repeat(64)}`;
const accepted = await installRelease({ release: tampered, storageDir, platform: process.platform, arch: process.arch }).then(
	() => true,
	(error: Error) => !error.message.startsWith("Checksum mismatch"),
);
if (accepted) throw new Error("A download with a mismatching sha256 digest was not rejected.");

// The pin can lag behind the latest release, but not be newer, unless it is a prerelease.
const latest = await fetchLatestRelease(process.platform, process.arch, undefined, token);
if (!release.prerelease && latest.published_at < release.published_at) {
	throw new Error(`Found ${latest.tag_name} as the latest release, but ${release.tag_name} is newer.`);
}

console.log(`Installed ${installed.tag}: ${installed.executable}`);
if (process.env["GITHUB_OUTPUT"]) appendFileSync(process.env["GITHUB_OUTPUT"], `roc=${path.resolve(installed.executable)}\n`);
