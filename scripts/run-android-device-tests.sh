#!/usr/bin/env bash
set -euo pipefail

sanitize_output() {
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --input-type=module -e '
    import { readFileSync } from "node:fs";
    import { sanitizeLogText } from "./packages/shared/logSanitizer.ts";
    const output = sanitizeLogText(readFileSync(0, "utf8"))
      .replace(/ci-only-model-key|modeltrace-fixture-key/g, "[fixture-key]");
    process.stdout.write(output);
  '
}

methods=(
  importsUseConfirmationAndPrivateCredentials
  nativeModelAndProviderSelectorsRemainStable
  modelTraceEarlyFinishStopsAtOneResponseAndReleasesAndroidTask
  credentialsSurviveProcessRestart
)

for method in "${methods[@]}"; do
  # Each instrumentation launch owns its process. Keep the app's private data
  # between cases while ending any activity left by the previous test runner.
  adb shell am force-stop com.lich13.studio
  adb logcat -c
  echo "Android device test: ${method}"
  status=0
  output=$(adb shell am instrument -w \
    -e class "com.lich13.studio.MobileSmokeTest#${method}" \
    com.lich13.studio.test/androidx.test.runner.AndroidJUnitRunner 2>&1) || status=$?
  printf '%s\n' "$output" | sanitize_output
  if [[ "$status" -ne 0 ]] || ! grep -q 'OK (1 test)' <<< "$output"; then
    echo 'Android crash diagnostics:'
    adb logcat -b crash -d -v brief | sanitize_output
    exit 1
  fi
done
