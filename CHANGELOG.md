# Changelog

## Unreleased

- Installs and updates to official Roc releases, starting with 0.1.0_RC1, instead of nightlies. If you have a nightly installed by the extension, it keeps working and you are offered the latest official release.
- Renamed `roc.nightly.checkForUpdates` to `roc.checkForUpdates` (turning off the old one still works), and **Roc: Install or Update Nightly** to **Roc: Install or Update Roc**

## 0.1.0

First release.

- TextMate grammar for Roc, including Roc code blocks in doc comments and Markdown
- Language client for `roc experimental-lsp`, respecting workspace trust
- Finds `roc` via `roc.path`, an extension-managed nightly, or `PATH`
- Downloads and verifies Roc nightlies, with an opt-out weekly update check
- **Roc: Run File**, **Roc: Test File** and a `roc` task type
