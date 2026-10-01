# Tiny client for the Blender MCP add-on socket (localhost:9876): bl.py <command> [json params]  |  bl.py code <file.py>
import json, socket, sys

def call(kind, params=None, timeout=120):
    s = socket.create_connection(('127.0.0.1', 9876), timeout=timeout)
    s.sendall(json.dumps({'type': kind, 'params': params or {}}).encode())
    buf = b''
    while True:
        chunk = s.recv(65536)
        if not chunk:
            break
        buf += chunk
        try:
            return json.loads(buf.decode())
        except ValueError:
            continue
    return json.loads(buf.decode())

if __name__ == '__main__':
    kind = sys.argv[1]
    if kind == 'code':
        r = call('execute_code', {'code': open(sys.argv[2], encoding='utf-8').read()})
    else:
        r = call(kind, json.loads(sys.argv[2]) if len(sys.argv) > 2 else {})
    print(json.dumps(r, indent=1)[:6000])
