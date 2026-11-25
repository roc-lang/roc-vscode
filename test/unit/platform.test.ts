import assert from "node:assert/strict";
import { test } from "node:test";
import {
	FIRST_SUPPORTED_PUBLISHED_AT,
	isAllowedDownloadUrl,
	isRelease,
	isSafeTag,
	isUpdate,
	parseSha256Digest,
	type Release,
	selectAsset,
	selectLatestRelease,
	shouldCheckForUpdate,
	UPDATE_CHECK_INTERVAL_MS,
} from "../../src/platform";

const platforms = ["linux_arm64.tar.gz", "linux_x86_64.tar.gz", "macos_apple_silicon.tar.gz", "macos_x86_64.tar.gz", "windows_x86_64.zip"];

function makeRelease(tag: string, publishedAt: string, prerelease: boolean, archives = platforms): Release {
	const asset = (name: string) => ({
		name,
		browser_download_url: `https://github.com/roc-lang/roc/releases/download/${tag}/${name}`,
		size: 1,
		digest: `sha256:${"a".repeat(64)}`,
	});
	const names = [...archives, "source.tar.gz", "source.zip"].map((name) => `roc-${name.replace(".", `-${tag}.`)}`);
	return { tag_name: tag, published_at: publishedAt, prerelease, assets: names.map(asset) };
}

// As published in roc-lang/roc.
const tag = "0.1.0_RC1";
const rc1 = makeRelease(tag, "2026-11-21T19:38:08Z", true);
const oldCompiler = [
	makeRelease("alpha4-rolling", "2025-08-26T12:28:38Z", false),
	makeRelease("0.0.0-alpha1", "2025-01-29T17:27:30Z", false),
	makeRelease("nightly", "2021-10-22T17:21:00Z", true),
];
// Made up.
const rc2 = makeRelease("0.1.0_RC2", "2026-12-01T10:00:00Z", true);
const stable = makeRelease("0.1.0", "2026-12-10T10:00:00Z", false);
const nextRc = makeRelease("0.1.1_RC1", "2026-12-20T10:00:00Z", true);

test("selects the archive for each supported platform", () => {
	const cases: [string, string, string][] = [
		["darwin", "arm64", "roc-macos_apple_silicon-0.1.0_RC1.tar.gz"],
		["darwin", "x64", "roc-macos_x86_64-0.1.0_RC1.tar.gz"],
		["linux", "x64", "roc-linux_x86_64-0.1.0_RC1.tar.gz"],
		["linux", "arm64", "roc-linux_arm64-0.1.0_RC1.tar.gz"],
		["win32", "x64", "roc-windows_x86_64-0.1.0_RC1.zip"],
	];
	for (const [platform, arch, expected] of cases) {
		assert.equal(selectAsset(rc1, platform, arch)?.name, expected, `${platform}-${arch}`);
	}
});

test("has no archive for unsupported platforms", () => {
	assert.equal(selectAsset(rc1, "win32", "arm64"), undefined);
	assert.equal(selectAsset(rc1, "freebsd", "x64"), undefined);
	assert.equal(selectAsset(rc1, "linux", "ia32"), undefined);
	assert.equal(selectLatestRelease([rc1], "freebsd", "x64"), undefined);
});

test("selects the newest release since 0.1.0_RC1", () => {
	const latest = (...releases: Release[]) => selectLatestRelease(releases, "linux", "x64")?.tag_name;
	assert.equal(FIRST_SUPPORTED_PUBLISHED_AT, rc1.published_at);
	assert.equal(latest(...oldCompiler), undefined);
	assert.equal(latest(...oldCompiler, rc1), "0.1.0_RC1");
	assert.equal(latest(rc1, rc2, ...oldCompiler), "0.1.0_RC2", "regardless of order");
	assert.equal(latest(rc2, rc1, ...oldCompiler), "0.1.0_RC2");
	assert.equal(latest(nextRc, stable, rc2, rc1), "0.1.0", "no prereleases once there is a stable release");
});

test("skips releases without an archive for this platform", () => {
	const windowsOnly = makeRelease("0.1.0_RC2", rc2.published_at, true, ["windows_x86_64.zip"]);
	assert.equal(selectLatestRelease([windowsOnly, rc1], "linux", "x64"), rc1);
	assert.equal(selectLatestRelease([windowsOnly, rc1], "win32", "x64"), windowsOnly);
});

test("offers newer releases, and official releases over nightlies", () => {
	const installed = { tag: rc1.tag_name, executable: "/roc", publishedAt: rc1.published_at };
	assert.ok(!isUpdate(rc1, installed));
	assert.ok(isUpdate(rc2, installed));
	assert.ok(!isUpdate(rc1, { tag: rc2.tag_name, executable: "/roc", publishedAt: rc2.published_at }));
	assert.ok(isUpdate(rc1, { tag: "nightly-2026-11-23-b5c77fc", executable: "/roc" }));
});

test("recognizes published releases", () => {
	assert.ok(isRelease(rc1));
	assert.ok(!isRelease({ ...rc1, published_at: null }), "draft");
	assert.ok(!isRelease({ ...rc1, assets: undefined }));
	assert.ok(!isRelease(null));
	assert.ok(!isRelease("0.1.0"));
});

test("rejects tags that aren't a plain directory name", () => {
	for (const safe of ["0.1.0_RC1", "0.1.0", "v1.0.0-rc.1"]) assert.ok(isSafeTag(safe), safe);
	for (const unsafe of ["", ".", "..", "../x", "a/b", "a\\b", ".partial-x", "0.1.0\n"]) assert.ok(!isSafeTag(unsafe), JSON.stringify(unsafe));
});

test("only allows downloads from releases of the roc repo", () => {
	assert.ok(isAllowedDownloadUrl(`https://github.com/roc-lang/roc/releases/download/${tag}/roc.tar.gz`));
	assert.ok(!isAllowedDownloadUrl("http://github.com/roc-lang/roc/releases/download/x/roc.tar.gz"));
	assert.ok(!isAllowedDownloadUrl("https://github.com/evil/roc/releases/download/x/roc.tar.gz"));
	assert.ok(!isAllowedDownloadUrl("https://github.com/roc-lang/nightlies/releases/download/x/roc.tar.gz"));
	assert.ok(!isAllowedDownloadUrl("https://github.com/roc-lang/roc/releases/download/../../evil/roc.tar.gz"));
	assert.ok(!isAllowedDownloadUrl("https://github.com.evil.example/roc-lang/roc/releases/download/x/roc.tar.gz"));
});

test("parses sha256 digests", () => {
	const hex = "895d051d693996308f4c72ccd38d8058e367c5b75ea03117c7eb239f1bf360a0";
	assert.equal(parseSha256Digest(`sha256:${hex}`), hex);
	assert.equal(parseSha256Digest(`sha256:${hex.toUpperCase()}`), hex);
	assert.equal(parseSha256Digest(undefined), undefined);
	assert.equal(parseSha256Digest(null), undefined);
	assert.equal(parseSha256Digest(`sha512:${hex}`), undefined);
	assert.equal(parseSha256Digest(`sha256:${hex.slice(1)}`), undefined);
	assert.equal(parseSha256Digest(`sha256:${hex}\n`), undefined);
});

test("checks for updates weekly, only for the managed roc", () => {
	const now = 1_800_000_000_000;
	const state = { enabled: true, usingManagedRoc: true, lastCheck: undefined, now };
	assert.ok(shouldCheckForUpdate(state), "never checked");
	assert.ok(!shouldCheckForUpdate({ ...state, enabled: false }));
	assert.ok(!shouldCheckForUpdate({ ...state, usingManagedRoc: false }));
	assert.ok(!shouldCheckForUpdate({ ...state, lastCheck: now - UPDATE_CHECK_INTERVAL_MS + 1 }));
	assert.ok(shouldCheckForUpdate({ ...state, lastCheck: now - UPDATE_CHECK_INTERVAL_MS }));
	assert.ok(shouldCheckForUpdate({ ...state, lastCheck: now + 60_000 }), "clock moved backwards");
	assert.equal(UPDATE_CHECK_INTERVAL_MS, 7 * 24 * 60 * 60 * 1000);
});
