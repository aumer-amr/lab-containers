#!/usr/bin/env python3
"""Run with Python 3, Docker, openssl, and Kopia 0.23.1. Uses only a local fixture."""

import hashlib
import http.server
import json
import os
from pathlib import Path
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.parse
import uuid
import xml.etree.ElementTree as ET


def serve(root):
    """Minimal read-only S3 fixture: TLS, list, HEAD and ranged GET."""
    repo = root / "repo"

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def reject_write(self):
            print("UNEXPECTED_WRITE", self.command, flush=True)
            self.send_error(405)

        do_PUT = do_POST = do_DELETE = reject_write

        def do_HEAD(self):
            self.do_GET(head=True)

        def do_GET(self, head=False):
            print(self.command, self.path, flush=True)
            url = urllib.parse.urlsplit(self.path)
            query = urllib.parse.parse_qs(url.query, keep_blank_values=True)
            if "location" in query:
                data = b'<LocationConstraint xmlns="http://s3.amazonaws.com/doc/2006-03-01/">us-east-1</LocationConstraint>'
            elif url.path.rstrip("/") == "/fixture":
                listing = ET.Element("ListBucketResult", xmlns="http://s3.amazonaws.com/doc/2006-03-01/")
                ET.SubElement(listing, "Name").text = "fixture"
                ET.SubElement(listing, "IsTruncated").text = "false"
                for path in sorted(repo.iterdir()):
                    if path.is_file() and path.name.startswith(query.get("prefix", [""])[0]):
                        item = ET.SubElement(listing, "Contents")
                        ET.SubElement(item, "Key").text = path.name
                        ET.SubElement(item, "LastModified").text = "2026-11-10T00:00:00Z"
                        ET.SubElement(item, "ETag").text = '"fixture"'
                        ET.SubElement(item, "Size").text = str(path.stat().st_size)
                data = ET.tostring(listing)
            else:
                key = urllib.parse.unquote(url.path.removeprefix("/fixture/"))
                path = repo / key
                if not key or "/" in key or not path.is_file():
                    self.send_error(404, "NoSuchKey")
                    return
                size = path.stat().st_size
                start, end = 0, size - 1
                if self.headers.get("Range"):
                    start_text, end_text = self.headers["Range"].removeprefix("bytes=").split("-", 1)
                    start = int(start_text)
                    end = min(int(end_text), size - 1) if end_text else size - 1
                self.send_response(206 if self.headers.get("Range") else 200)
                self.send_header("Content-Length", str(end - start + 1))
                self.send_header("ETag", '"fixture"')
                self.send_header("Last-Modified", "Tue, 10 Nov 2026 00:00:00 GMT")
                if self.headers.get("Range"):
                    self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                self.end_headers()
                if not head:
                    with path.open("rb") as stream:
                        stream.seek(start)
                        remaining = end - start + 1
                        while remaining:
                            chunk = stream.read(min(65536, remaining))
                            self.wfile.write(chunk)
                            remaining -= len(chunk)
                return
            self.send_response(200)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            if not head:
                self.wfile.write(data)

    server = http.server.ThreadingHTTPServer(("0.0.0.0", 443), Handler)
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.load_cert_chain(root / "cert.pem", root / "key.pem")
    server.socket = tls.wrap_socket(server.socket, server_side=True)
    print("READY", flush=True)
    server.serve_forever()


def command(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True, **kwargs).stdout.strip()


def test(image):
    assert command("kopia", "--version").startswith("0.23.1 ")
    network = "kopia-verify-test-" + uuid.uuid4().hex[:10]
    server = network + "-s3"
    containers = []
    with tempfile.TemporaryDirectory(prefix="kopia-verify-test-") as directory:
        root = Path(directory)
        source = root / "source"
        source.mkdir()
        block = os.urandom(16 * 1024 * 1024)
        with (source / "larger-than-memory.bin").open("wb") as stream:
            for _ in range(128):
                stream.write(block)
        (source / "empty").touch()
        for index in range(10):
            (source / f"unique-{index}.bin").write_bytes(os.urandom(16 * 1024 * 1024))
        (source / "old-snapshot-only.txt").write_text("Only the older snapshot contains this file.\n")
        env = dict(os.environ, KOPIA_PASSWORD="local-fixture-only", KOPIA_CONFIG_PATH=str(root / "repository.config"),
                   KOPIA_CACHE_DIRECTORY=str(root / "seed-cache"))

        def kopia(*args):
            return command("kopia", "--disable-file-logging", "--no-auto-maintenance", *args, env=env)

        kopia("repository", "create", "filesystem", "--path=" + str(root / "repo"), "--flat")
        kopia("snapshot", "create", str(source))
        (source / "old-snapshot-only.txt").unlink()
        (source / "second-snapshot.txt").write_text("The second snapshot must also be verified.\n")
        kopia("snapshot", "create", str(source))
        # Filesystem storage appends .f; S3 uses the original blob IDs.
        for path in (root / "repo").glob("*.f"):
            path.rename(path.with_suffix(""))
        command("openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                "-subj", "/CN=fixture.test", "-addext", "subjectAltName=DNS:fixture.test",
                "-keyout", str(root / "key.pem"), "-out", str(root / "cert.pem"))
        (root / "cert.pem").chmod(0o644)
        command("docker", "network", "create", network)
        try:
            command("docker", "run", "-d", "--name", server, "--network", network, "--network-alias", "fixture.test",
                    "--memory=128m", "--cpus=1", "--read-only", "-v", f"{root}:/fixture:ro",
                    "-v", f"{Path(__file__).resolve()}:/server.py:ro", "python:3.13-alpine",
                    "python", "-u", "/server.py", "--serve", "/fixture")
            containers.append(server)
            for _ in range(100):
                if "READY" in command("docker", "logs", server):
                    break
                time.sleep(0.1)
            else:
                raise AssertionError("S3 fixture did not start")

            def run(label, *, extra_env=(), args=(), stop=False, entrypoint=None):
                name = network + "-" + label
                report_path = root / (label + ".json")
                report_path.touch(mode=0o666)
                report_path.chmod(0o666)
                options = ["docker", "run", "-d", "--name", name, "--network", network,
                           "--memory=1g", "--memory-swap=1g", "--cpus=1", "--read-only",
                           "--cap-drop=ALL", "--security-opt=no-new-privileges",
                           "--tmpfs=/scratch:rw,nosuid,nodev,noexec,size=512m,uid=65532,gid=65532,mode=700",
                           "-v", f"{root / 'cert.pem'}:/fixture-ca.pem:ro",
                           "-v", f"{report_path}:/dev/termination-log",
                           "-e", "SSL_CERT_FILE=/fixture-ca.pem", "-e", "KOPIA_PASSWORD=local-fixture-only",
                           "-e", "AWS_ACCESS_KEY_ID=fixture", "-e", "AWS_SECRET_ACCESS_KEY=fixture",
                           "-e", "KOPIA_VERIFY_BUCKET=fixture", "-e", "KOPIA_VERIFY_ENDPOINT=fixture.test",
                           "-e", "KOPIA_VERIFY_REGION=us-east-1", "-e", "KOPIA_VERIFY_MAX_DOWNLOAD_BYTES_PER_SECOND=67108864",
                           "-e", "KOPIA_VERIFY_TERMINATION_PATH=/dev/termination-log"]
                for value in extra_env:
                    options += ["-e", value]
                if entrypoint:
                    options += ["--entrypoint", entrypoint]
                command(*options, image, *args)
                containers.append(name)
                peak_memory, peak_scratch = 0, 0
                deadline = time.monotonic() + 240
                while time.monotonic() < deadline:
                    state = json.loads(command("docker", "inspect", "--format={{json .State}}", name))
                    if not state["Running"]:
                        break
                    measurement = subprocess.run(["docker", "exec", name, "/bin/sh", "-c",
                        "cat /sys/fs/cgroup/memory.peak; df -B1 --output=used /scratch | tail -1"],
                        text=True, capture_output=True)
                    if measurement.returncode == 0:
                        memory, scratch = map(int, measurement.stdout.split())
                        peak_memory, peak_scratch = max(peak_memory, memory), max(peak_scratch, scratch)
                    if stop:
                        progress = subprocess.run(["docker", "logs", name], text=True, capture_output=True)
                        rows = [json.loads(line) for line in (progress.stdout + progress.stderr).splitlines()
                                if line.startswith('{"processedObjectCount":')]
                        if any(row["readBytes"] > 0 for row in rows):
                            command("docker", "stop", "--time=20", name)
                    time.sleep(0.25)
                else:
                    raise AssertionError(f"{label}: fixture timeout")
                logs = subprocess.run(["docker", "logs", name], text=True, capture_output=True)
                assert "local-fixture-only" not in logs.stdout + logs.stderr
                if state["ExitCode"] != 0:
                    print(f"{label} stderr: {logs.stderr[-2000:]}", flush=True)
                assert not state["OOMKilled"], label
                assert peak_memory < 1024**3, label
                assert peak_scratch <= 512 * 1024**2, label
                if entrypoint:
                    return state["ExitCode"]
                report = json.loads(report_path.read_text())
                assert report["exitCode"] == state["ExitCode"], (label, report, state)
                assert len(report_path.read_bytes()) <= 4096
                print(json.dumps({"case": label, "peakMemoryBytes": peak_memory,
                                  "peakScratchBytes": peak_scratch, "report": report}), flush=True)
                return report

            before = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (root / "repo").iterdir() if p.is_file()}
            healthy = run("healthy")
            if not healthy["completed"]:
                print("Fixture keys:", sorted(p.name for p in (root / "repo").iterdir()), flush=True)
                print(command("docker", "logs", server), flush=True)
            assert healthy["completed"] and healthy["result"]["errorCount"] == 0
            assert healthy["result"]["stats"]["readBytes"] >= 2 * 1024**3
            assert healthy["result"]["stats"]["readFileCount"] == 14
            after = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (root / "repo").iterdir() if p.is_file()}
            assert before == after, "Verification modified the repository"
            invalid = run("invalid", extra_env=("KOPIA_VERIFY_MAX_DOWNLOAD_BYTES_PER_SECOND=0",))
            assert invalid["exitCode"] == 2 and not invalid["completed"]
            rejected = run("arguments", args=("maintenance", "run"))
            assert rejected["exitCode"] == 2 and not rejected["completed"]
            pack = next(p for p in (root / "repo").iterdir() if p.name.startswith("p"))
            original = pack.read_bytes()
            pack.unlink()
            missing = run("missing")
            assert not missing["completed"] and missing["result"]["errorCount"] > 0
            pack.write_bytes(bytes(byte ^ 0xFF for byte in original))
            corrupt = run("corrupt")
            assert not corrupt["completed"] and corrupt["result"]["errorCount"] > 0
            pack.write_bytes(original)
            cancelled = run("cancelled", stop=True)
            assert cancelled["exitCode"] == 143 and not cancelled["completed"]
            assert cancelled["lastProgress"]["readBytes"] > 0
            full = run("scratch-full", entrypoint="/bin/sh", args=("-c", "dd if=/dev/zero of=/scratch/full bs=1M count=513"))
            assert full != 0, "The scratch filesystem did not enforce its size limit"
            assert "UNEXPECTED_WRITE" not in command("docker", "logs", server)
            print("PASS: streaming, read-only access, corruption, missing data, cancellation, input safety, and scratch limit", flush=True)
        finally:
            for name in reversed(containers):
                subprocess.run(["docker", "rm", "-f", "-v", name], capture_output=True)
            subprocess.run(["docker", "network", "rm", network], capture_output=True)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--serve":
        serve(Path(sys.argv[2]))
    else:
        test(sys.argv[1] if len(sys.argv) > 1 else "kopia-verify:task209")
