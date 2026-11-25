// The VS Code side of the managed roc: installing on request, remembering the install, and weekly update checks.
import { existsSync } from "node:fs";
import * as vscode from "vscode";
import { fetchLatestRelease, installRelease, removeOtherInstalls } from "./install";
import { type InstalledRoc, isUpdate, type Release, shouldCheckForUpdate } from "./platform";

// Named when the extension installed nightlies; kept so those installs are still found.
const MANAGED_KEY = "roc.managedNightly";
const LAST_CHECK_KEY = "roc.lastUpdateCheck";

export function getManagedRoc(context: vscode.ExtensionContext): InstalledRoc | undefined {
	return context.globalState.get<InstalledRoc>(MANAGED_KEY);
}

/**
 * Downloads the latest official release and makes it the managed roc. Returns the new install,
 * or undefined if cancelled, failed (already reported) or already up to date.
 */
export async function installLatestRelease(
	context: vscode.ExtensionContext,
	output: vscode.LogOutputChannel,
): Promise<InstalledRoc | undefined> {
	try {
		return await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: "Roc", cancellable: true },
			async (progress, token) => {
				const abort = new AbortController();
				token.onCancellationRequested(() => abort.abort());

				progress.report({ message: "Checking for the latest release…" });
				const release = await fetchLatestRelease(process.platform, process.arch, abort.signal);
				const current = getManagedRoc(context);
				if (current?.tag === release.tag_name && existsSync(current.executable)) {
					void vscode.window.showInformationMessage(`Roc ${release.tag_name} is already installed.`);
					return undefined;
				}

				output.info(`Installing Roc ${release.tag_name}`);
				let reported = 0;
				const installed = await installRelease({
					release,
					storageDir: context.globalStorageUri.fsPath,
					platform: process.platform,
					arch: process.arch,
					signal: abort.signal,
					onProgress: (fraction) => {
						if (fraction === undefined) {
							progress.report({ message: "Unpacking…" });
							return;
						}
						const percent = Math.floor(fraction * 100);
						progress.report({ message: `Downloading ${release.tag_name}…`, increment: percent - reported });
						reported = percent;
					},
				});
				await context.globalState.update(MANAGED_KEY, installed);
				output.info(`Installed Roc ${installed.tag} at ${installed.executable}`);

				if (vscode.workspace.getConfiguration("roc").get<string>("path", "").trim() !== "") {
					void vscode.window.showWarningMessage(
						`Installed Roc ${installed.tag}, but the roc.path setting takes precedence over it. Clear roc.path to use it.`,
					);
				} else {
					void vscode.window.showInformationMessage(`Installed Roc ${installed.tag}.`);
				}
				return installed;
			},
		);
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") return undefined;
		output.error(`Installing Roc failed: ${String(error)}`);
		void vscode.window.showErrorMessage(`Installing Roc failed: ${errorMessage(error)}`);
		return undefined;
	}
}

/** Deletes installs other than the managed one. Call after the server has switched executables. */
export async function cleanUpOldInstalls(context: vscode.ExtensionContext): Promise<void> {
	const managed = getManagedRoc(context);
	if (managed !== undefined) await removeOtherInstalls(context.globalStorageUri.fsPath, managed.tag);
}

/** At most once a week, offers to update the managed roc to the latest official release. Never downloads without asking. */
export async function maybeOfferUpdate(
	context: vscode.ExtensionContext,
	output: vscode.LogOutputChannel,
	usingManagedRoc: boolean,
	onUpdate: () => Promise<void>,
): Promise<void> {
	const config = vscode.workspace.getConfiguration("roc");
	const installed = getManagedRoc(context);
	const due = shouldCheckForUpdate({
		// The second is the deprecated name of the first.
		enabled: config.get<boolean>("checkForUpdates", true) && config.get<boolean>("nightly.checkForUpdates", true),
		usingManagedRoc,
		lastCheck: context.globalState.get<number>(LAST_CHECK_KEY),
		now: Date.now(),
	});
	if (!due || installed === undefined) return;

	// Stamp first so a failing check (offline, rate limited) isn't retried on every window.
	await context.globalState.update(LAST_CHECK_KEY, Date.now());
	let latest: Release;
	try {
		latest = await fetchLatestRelease(process.platform, process.arch);
	} catch (error) {
		output.warn(`Checking for a newer Roc release failed: ${String(error)}`);
		return;
	}
	if (!isUpdate(latest, installed)) return;

	const choice = await vscode.window.showInformationMessage(
		`Roc ${latest.tag_name} is available (you have ${installed.tag}).`,
		"Update Now",
		"Later",
		"Don't Check Again",
	);
	if (choice === "Update Now") {
		await onUpdate();
	} else if (choice === "Don't Check Again") {
		await config.update("checkForUpdates", false, vscode.ConfigurationTarget.Global);
	}
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
