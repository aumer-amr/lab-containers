#!/usr/bin/env python3
"""Smoke-test a built image without credentials, network access, or published ports."""

import subprocess
import sys
import time
import uuid


def docker(*args, check=True):
    return subprocess.run(
        ["docker", *args], check=check, capture_output=True, text=True
    )


def main():
    image = sys.argv[1] if len(sys.argv) > 1 else "codex-proxy:test"
    name = "codex-proxy-test-" + uuid.uuid4().hex
    try:
        docker(
            "run", "--detach", "--name", name, "--network", "none",
            "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            "--tmpfs", "/tmp", "--tmpfs", "/home/node/.codex:uid=1000,gid=1000",
            image,
        )
        probe = """
const response = await fetch('http://127.0.0.1:3466/health');
const body = await response.json();
if (!response.ok || body.status !== 'ok') process.exit(1);
"""
        for _ in range(30):
            if docker("exec", name, "node", "--input-type=module", "-e", probe,
                      check=False).returncode == 0:
                break
            time.sleep(1)
        else:
            raise AssertionError("Proxy did not become healthy before login")

        verify = """
const assert = require('node:assert/strict');
const fs = require('node:fs');
assert.equal(process.getuid(), 1000);
const home = process.env.CODEX_HOME;
assert.equal(home, '/home/node/.codex');
assert(!fs.existsSync(home + '/auth.json'));
const config = fs.readFileSync(home + '/config.toml', 'utf8');
assert(config.includes('cli_auth_credentials_store = "file"'));
assert.equal(fs.statSync(home + '/config.toml').mode & 0o777, 0o600);
assert.equal(process.env.CODEX_PROXY_HOST, '0.0.0.0');
assert.equal(process.env.CODEX_PROXY_INIT_POOL, '0');
assert.equal(process.env.CODEX_PROXY_SANDBOX, 'read-only');
fs.appendFileSync(home + '/config.toml', '\\n# preserved across startup\\n');
"""
        docker("exec", name, "node", "-e", verify)
        docker("exec", name, "/usr/local/bin/codex-proxy-start", "true")
        docker("exec", name, "node", "-e", """
const assert = require('node:assert/strict');
const fs = require('node:fs');
assert(fs.readFileSync(process.env.CODEX_HOME + '/config.toml', 'utf8')
  .includes('# preserved across startup'));
""")
        assert "0.163.0" in docker("exec", name, "codex", "--version").stdout
        login = docker("exec", name, "codex", "login", "status", check=False)
        assert login.returncode != 0, "The image must not contain a Codex login"
        docker("stop", "--time=15", name)
        assert docker("inspect", "--format={{.State.ExitCode}}", name).stdout.strip() == "0"
        print("Codex proxy image smoke test passed")
    finally:
        docker("rm", "--force", "--volumes", name, check=False)


if __name__ == "__main__":
    main()
