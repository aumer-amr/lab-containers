# Codex proxy

This image packages [mehdic/codex-proxy](https://github.com/mehdic/codex-proxy) v0.4.8 and Codex CLI 0.163.0.
Both build stages use Node.js 24.22.3 on Debian Bookworm, pinned by image digest.
GitHub Actions discovers its Dockerfile and publishes `ghcr.io/aumer-amr/codex-proxy`.
The build pins the upstream source and applies exact security fixes to three dependencies.
The builder compiles the proxy and runs its upstream tests.

The proxy listens on `0.0.0.0:3466` and starts without a Codex login.
It disables worker prewarming so you can complete the first login before sending requests.
The default Codex sandbox permits reads and denies writes.

## Kubernetes deployment

- Run one replica with the `Recreate` deployment strategy.
- Mount a writable PersistentVolumeClaim (PVC) at `/home/node/.codex`, the default `CODEX_HOME`.
- Set `runAsUser: 1000`, `runAsGroup: 1000`, and `fsGroup: 1000` so the process can write to the volume.
- If you set `readOnlyRootFilesystem: true`, mount an `emptyDir` volume at `/tmp`.
- Use HTTP `GET /health` on port 3466 for liveness and startup probes. This endpoint does not require login.
- Protect access with an authenticated gateway and a NetworkPolicy. The proxy has no client authentication.

Keep the Deployment, Service, configuration, and PVC declaration in GitOps.
Keep `auth.json` on the PVC and outside Git.
Codex updates that file when it refreshes credentials.
The entrypoint creates `config.toml` only when it is absent and preserves existing configuration.
For GitOps-managed configuration, mount your ConfigMap at `$CODEX_HOME/config.toml` with `subPath`.

The `/health` endpoint confirms that HTTP is available, not that Codex can answer requests.
Avoid `/healthz/deep` for routine probes because it sends a model request.

## Initial login

After the pod starts, use a machine with cluster access.
Replace `NAMESPACE` with the deployment namespace.
These commands assume that the deployment and container are named `codex-proxy`.

```sh
kubectl -n NAMESPACE exec -it deployment/codex-proxy -c codex-proxy -- codex login --device-auth
kubectl -n NAMESPACE exec deployment/codex-proxy -c codex-proxy -- codex login status
```

Complete the browser flow before you run the status command.
If device login is disabled, enable it in your ChatGPT security settings or workspace permissions.
See the [Codex authentication documentation](https://learn.chatgpt.com/docs/auth#login-on-headless-devices).

## Optional local smoke test

On a machine with Docker and Python 3, run:

```sh
docker build -t codex-proxy:test -f apps/codex-proxy/Dockerfile apps/codex-proxy
python3 apps/codex-proxy/test_image.py codex-proxy:test
```

The smoke test uses no credentials or network access.
It exercises startup before login, file permissions, configuration preservation, and shutdown.
