// Pure helpers describing roc-lang/roc releases and their assets. No vscode imports, so unit-testable.

export const RELEASES_API = "https://api.github.com/repos/roc-lang/roc/releases";
export const DOWNLOAD_PREFIX = "https://github.com/roc-lang/roc/releases/download/";

/** When 0.1.0_RC1 was published. Older releases are of the old compiler, which this extension doesn't support. */
export const FIRST_SUPPORTED_PUBLISHED_AT = "2026-11-21T19:38:08Z";

export interface ReleaseAsset {
	name: string;
	browser_download_url: string;
	size: number;
	digest?: string | null;
}

export interface Release {
	tag_name: string;
	prerelease: boolean;
	/** UTC, e.g. `2026-11-21T19:38:08Z`, so these compare as strings. */
	published_at: string;
	assets: ReleaseAsset[];
}

/** Whether a GitHub API response item is a published release. Drafts have no `published_at`. */
export function isRelease(value: unknown): value is Release {
	const release = value as Partial<Release> | null;
	return (
		typeof release?.tag_name === "string" &&
		typeof release.prerelease === "boolean" &&
		typeof release.published_at === "string" &&
		Array.isArray(release.assets)
	);
}

/** The tag names a directory on disk, so it must not contain separators or be `..`. */
export function isSafeTag(tag: string): boolean {
	return /^\w[\w.-]*$/.test(tag);
}

/** The platform part of a release archive name, e.g. `macos_apple_silicon`, or undefined if unsupported. */
export function releasePlatformName(platform: string, arch: string): string | undefined {
	switch (`${platform}-${arch}`) {
		case "darwin-arm64":
			return "macos_apple_silicon";
		case "darwin-x64":
			return "macos_x86_64";
		case "linux-x64":
			return "linux_x86_64";
		case "linux-arm64":
			return "linux_arm64";
		case "win32-x64":
			return "windows_x86_64";
		default:
			return undefined;
	}
}

export function rocExecutableName(platform: string): string {
	return platform === "win32" ? "roc.exe" : "roc";
}

/** Picks the archive for this platform from a release, e.g. `roc-linux_x86_64-0.1.0_RC1.tar.gz`. */
export function selectAsset(release: Release, platform: string, arch: string): ReleaseAsset | undefined {
	const name = releasePlatformName(platform, arch);
	if (name === undefined) return undefined;
	const extension = platform === "win32" ? ".zip" : ".tar.gz";
	return release.assets.find((asset) => asset.name === `roc-${name}-${release.tag_name}${extension}`);
}

/**
 * The newest supported release with an archive for this platform.
 * Prereleases, like release candidates, only count until there is a stable release.
 */
export function selectLatestRelease(releases: Release[], platform: string, arch: string): Release | undefined {
	const newestFirst = releases
		.filter((release) => release.published_at >= FIRST_SUPPORTED_PUBLISHED_AT && selectAsset(release, platform, arch) !== undefined)
		.sort((a, b) => (a.published_at < b.published_at ? 1 : -1));
	return newestFirst.find((release) => !release.prerelease) ?? newestFirst[0];
}

/** Only accept downloads from releases of the official roc repo, over https. */
export function isAllowedDownloadUrl(url: string): boolean {
	return url.startsWith(DOWNLOAD_PREFIX) && !url.slice(DOWNLOAD_PREFIX.length).includes("..");
}

/** Parses GitHub's `sha256:<hex>` asset digest into lowercase hex, or undefined if absent or malformed. */
export function parseSha256Digest(digest: string | null | undefined): string | undefined {
	const match = /^sha256:([0-9a-fA-F]{64})$/.exec(digest ?? "");
	return match?.[1]?.toLowerCase();
}

export interface InstalledRoc {
	tag: string;
	executable: string;
	/** Absent for nightlies, which version 0.1.0 of this extension installed. */
	publishedAt?: string;
}

/** Whether to offer `latest` as an update. Nightlies are always offered the move to an official release. */
export function isUpdate(latest: Release, installed: InstalledRoc): boolean {
	if (latest.tag_name === installed.tag) return false;
	return installed.publishedAt === undefined || latest.published_at > installed.publishedAt;
}

export const UPDATE_CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export interface UpdateCheckState {
	enabled: boolean;
	/** Whether the roc in use is the one managed by this extension. */
	usingManagedRoc: boolean;
	/** Milliseconds since the epoch of the last check, if any. */
	lastCheck: number | undefined;
	now: number;
}

export function shouldCheckForUpdate(state: UpdateCheckState): boolean {
	if (!state.enabled || !state.usingManagedRoc) return false;
	const { lastCheck, now } = state;
	// A check stamped in the future means the clock moved backwards; don't wait for it to catch up.
	return lastCheck === undefined || lastCheck > now || now - lastCheck >= UPDATE_CHECK_INTERVAL_MS;
}
