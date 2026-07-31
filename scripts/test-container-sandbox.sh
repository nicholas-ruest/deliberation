#!/usr/bin/env sh
set -eu

image_name="deliberation-worker:sandbox-test"
docker build --pull=false -f Dockerfile.worker -t "$image_name" .

user="$(docker image inspect "$image_name" --format '{{.Config.User}}')"
if [ "$user" != "10001:10001" ]; then
  echo "Unexpected runtime user: $user" >&2
  exit 1
fi

docker run --rm \
  --read-only \
  --network none \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  "$image_name" \
  sh -eu -c '
    test -z "${AWS_ACCESS_KEY_ID:-}"
    test -z "${DATABASE_URL:-}"
    test ! -w /
    if wget -q -T 2 -O /dev/null https://example.com; then
      echo "Network unexpectedly available" >&2
      exit 1
    fi
  '

echo "Container sandbox test passed."
