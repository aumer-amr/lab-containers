#!/usr/bin/env python3
"""Smoke-test the locally built image without credentials or published ports."""

import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time
import uuid


def docker(*args, check=True):
    return subprocess.run(
        ["docker", *args], check=check, capture_output=True, text=True
    )


def main():
    image = sys.argv[1] if len(sys.argv) > 1 else "paseo-codex:task45"
    config = Path(__file__).resolve().parent / "tests" / "config"
    name = "paseo-test-" + uuid.uuid4().hex
    environment = {
        **os.environ,
        "PASEO_PASSWORD": secrets.token_urlsafe(32),
        "LITELLM_API_KEY": "test-only",
        "MEMINI_API_KEY": "test-only",
    }
    command = [
        "docker", "run", "--detach", "--name", name,
        "--network", "none", "--read-only", "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges",
        "--tmpfs", "/tmp", "--tmpfs", "/home/paseo:uid=1000,gid=1000",
        "--mount", f"type=bind,src={config},dst=/etc/paseo,readonly",
        "--env", "PASEO_PASSWORD", "--env", "LITELLM_API_KEY",
        "--env", "MEMINI_API_KEY", "--env", "PASEO_RELAY_ENABLED=false", image,
    ]
    try:
        subprocess.run(command, env=environment, capture_output=True, check=True)
        assert docker("exec", name, "id", "-u").stdout.strip() == "1000"
        probe = """
const http = require('http');
http.get('http://127.0.0.1:6767/api/health', r => {
  process.exit(r.statusCode === 200 ? 0 : 1);
}).on('error', () => process.exit(1));
"""
        for _ in range(60):
            if docker("exec", name, "node", "-e", probe, check=False).returncode == 0:
                break
            time.sleep(1)
        else:
            raise AssertionError("Paseo did not become healthy")
        verify = """
const assert = require('assert/strict');
const http = require('http');
const fs = require('fs');
const config = JSON.parse(fs.readFileSync(process.env.PASEO_HOME + '/config.json'));
assert.equal(config.daemon.relay.enabled, false);
assert.equal(config.agents.providers.codex.options.approval_policy, 'on-request');
assert.equal(config.agents.providers.codex.options.sandbox_mode, 'workspace-write');
for (const skill of ['caveman', 'ponytail']) {
  assert(fs.existsSync(process.env.HOME + '/.agents/skills/' + skill + '/SKILL.md'));
}
http.get('http://127.0.0.1:6767/api/agents', r => {
  assert.equal(r.statusCode, 401);
}).on('error', e => { throw e; });
"""
        docker("exec", name, "node", "-e", verify)
        assert "0.163.0" in docker("exec", name, "codex", "--version").stdout
        for tool in ["flux", "kustomize", "sops", "age", "oxfmt"]:
            docker("exec", name, tool, "--version" if tool != "kustomize" else "version")
        docker("exec", name, "kubectl", "version", "--client")
        servers = json.loads(docker("exec", name, "codex", "mcp", "list", "--json").stdout)
        assert {server["name"] for server in servers} == {"litellm", "memini"}
        # Empty passwords must fail before the entrypoint starts the daemon.
        result = docker(
            "exec", "--env", "PASEO_PASSWORD=", name,
            "/usr/local/bin/paseo-start", check=False
        )
        assert result.returncode != 0
        assert "PASEO_PASSWORD must be non-empty" in result.stderr
        print("Paseo image smoke test passed")
    finally:
        docker("rm", "--force", "--volumes", name, check=False)


if __name__ == "__main__":
    main()
