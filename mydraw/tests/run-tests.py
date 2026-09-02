#!/usr/bin/env python3
"""
Headless test runner for MyDraw in-browser tests using Firefox Marionette.
"""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time


def main():
    profile_dir = tempfile.mkdtemp()
    proc = subprocess.Popen(
        ['firefox', '--headless', '--marionette', '--profile', profile_dir],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        # Wait for Marionette server to start
        connected = False
        s = None
        for _ in range(30):
            try:
                s = socket.create_connection(('127.0.0.1', 2828), timeout=5)
                s.settimeout(15)
                connected = True
                break
            except (ConnectionRefusedError, OSError):
                time.sleep(0.2)

        if not connected or s is None:
            print('Error: Could not connect to Firefox Marionette on port 2828', file=sys.stderr)
            return 1

        def recv_frame():
            hdr = b''
            while b':' not in hdr:
                chunk = s.recv(1)
                if not chunk:
                    raise ConnectionError('Socket closed while reading header')
                hdr += chunk
            length = int(hdr[:-1])
            data = b''
            while len(data) < length:
                chunk = s.recv(length - len(data))
                if not chunk:
                    raise ConnectionError('Socket closed unexpectedly')
                data += chunk
            return json.loads(data.decode('utf-8'))

        def send_cmd(cmd):
            msg = json.dumps(cmd)
            s.sendall(f'{len(msg)}:{msg}'.encode('utf-8'))
            return recv_frame()

        # Read greeting
        greeting = recv_frame()

        # New session
        send_cmd([0, 1, 'WebDriver:NewSession', {}])

        # Navigate to test runner
        test_file = os.path.abspath(os.path.join(os.path.dirname(__file__), 'test-runner.html'))
        send_cmd([0, 2, 'WebDriver:Navigate', {'url': f'file://{test_file}'}])

        # Poll for test results
        for _ in range(40):
            time.sleep(0.2)
            res = send_cmd([0, 3, 'WebDriver:ExecuteScript', {'script': 'return window.__TEST_RESULTS__;'}])
            data = res[3].get('value') if len(res) > 3 and isinstance(res[3], dict) else None
            if data:
                print(f"Results: {data['passed']}/{data['total']} tests passed ({data['failed']} failed)\n")
                for suite in data['results']:
                    print(f"  Suite: {suite['name']}")
                    for t in suite['tests']:
                        status = '✔' if t['passed'] else '✘'
                        print(f"    {status} {t['name']}")
                        if not t['passed']:
                            print(f"      Error: {t['error']}")
                    print()
                return 0 if data['failed'] == 0 else 1

        print('Timeout waiting for test results', file=sys.stderr)
        return 1

    finally:
        try:
            proc.kill()
            proc.wait(timeout=3)
        except Exception:
            pass


if __name__ == '__main__':
    sys.exit(main())
