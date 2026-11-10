#!/bin/bash
set +x
set -euo pipefail
umask 077

child=
stage=configuration
started=$(date -u +%FT%TZ)
result=/scratch/result.json
progress=/scratch/progress.json

report() {
    local status=$? report_json
    trap - EXIT
    report_json=$(jq -nc \
        --arg started "$started" --arg finished "$(date -u +%FT%TZ)" \
        --arg stage "$stage" --argjson exitCode "$status" \
        --slurpfile result "$result" --slurpfile progress "$progress" \
        '{started: $started, finished: $finished, stage: $stage, exitCode: $exitCode,
          completed: ($stage == "verification" and $exitCode == 0),
          lastProgress: ($progress[0] // null),
          result: ($result[0] // null)}') || {
        printf '%s\n' '{"completed":false,"error":"Unable to produce verification report"}' >&2
        exit 1
    }
    printf '%s\n' "$report_json"
    if [[ -n "${KOPIA_VERIFY_TERMINATION_PATH:-}" ]]; then
        # Kubernetes retains at most 4096 bytes of a termination message.
        jq -c 'if .result.errorStrings then .result.errorStrings |= map(.[0:512]) else . end' \
            <<< "$report_json" > "$KOPIA_VERIFY_TERMINATION_PATH" || exit 1
    fi
    exit "$status"
}

stop() {
    trap '' TERM INT
    if [[ -n "$child" ]]; then
        kill -TERM "$child" 2>/dev/null || true
        wait "$child" || true
    fi
    exit 143
}

capture_progress() {
    local line
    while IFS= read -r line || [[ -n "$line" ]]; do
        printf '%s\n' "$line" >&2
        if [[ "$line" == '{"processedObjectCount":'* ]]; then
            printf '%s\n' "$line" > "$progress.tmp"
            mv "$progress.tmp" "$progress"
        fi
    done
}

run_kopia() {
    local log_fd log_pid status=0
    exec {log_fd}> >(capture_progress)
    log_pid=$!
    kopia --disable-file-logging --disable-content-log --no-auto-maintenance \
        --no-persist-credentials --no-use-keyring "$@" < /dev/null 2>&"$log_fd" &
    child=$!
    exec {log_fd}>&-
    wait "$child" || status=$?
    child=
    wait "$log_pid" || status=1
    return "$status"
}

mkdir -p /scratch/tmp /scratch/cache
: > "$result"
: > "$progress"
trap report EXIT
trap stop TERM INT

[[ $# == 0 ]] || { echo 'This image only performs full repository verification; arguments are not accepted.' >&2; exit 2; }
for name in KOPIA_PASSWORD AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY KOPIA_VERIFY_BUCKET KOPIA_VERIFY_ENDPOINT; do
    [[ -n "${!name:-}" ]] || { printf 'Required variable is missing: %s\n' "$name" >&2; exit 2; }
done
[[ "$KOPIA_VERIFY_ENDPOINT" != *'/'* ]] || { echo 'The S3 endpoint must be a hostname with an optional port, without a URL path or scheme.' >&2; exit 2; }
speed=${KOPIA_VERIFY_MAX_DOWNLOAD_BYTES_PER_SECOND:-8388608}
[[ "$speed" =~ ^[1-9][0-9]{0,8}$ ]] || { echo 'The download limit must be a positive integer below 1000000000 bytes per second.' >&2; exit 2; }

stage=connection
run_kopia repository connect s3 \
    --bucket="$KOPIA_VERIFY_BUCKET" --endpoint="$KOPIA_VERIFY_ENDPOINT" \
    --region="${KOPIA_VERIFY_REGION:-auto}" --prefix="${KOPIA_VERIFY_PREFIX:-}" \
    --readonly --no-enable-actions --no-check-for-updates \
    --cache-directory=/scratch/cache \
    --content-cache-size-mb=64 --content-cache-size-limit-mb=128 \
    --metadata-cache-size-mb=64 --metadata-cache-size-limit-mb=128 \
    --content-min-sweep-age=0s --metadata-min-sweep-age=0s \
    --max-download-speed="$speed" > /dev/null

stage=verification
# In 0.23.1, file-parallelism also controls the tree walker; parallel is unused.
# Negative max-errors continues the scan but retains only one error in memory.
run_kopia snapshot verify --verify-files-percent=100 \
    --file-parallelism=1 --file-queue-length=16 --max-errors=-1 --json > "$result"
jq -e '.errorCount == 0 and .stats.readFileCount > 0' "$result" > /dev/null || {
    echo 'Verification did not read any files or reported errors.' >&2
    exit 1
}
