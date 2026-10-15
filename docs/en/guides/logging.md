# Logging

Use the shared LoggerService rather than logging user data directly. The maintained guide and redaction boundaries are in [日志使用](../../zh/guides/logging.md).

`packages/shared/logSanitizer.ts` filters recognized credentials and user-content fields before local logging. Callers must still supply minimal safe diagnostics. No raw chat content, credentials, request/response bodies or private URLs belong in a log or test fixture. Redaction is not a substitute for reviewing a report before sharing it.

Only the legacy main logger reads `CSLOGGER_MAIN_LEVEL` and `CSLOGGER_MAIN_SHOW_MODULES`; renderer-specific environment controls are no longer used.
