#!/usr/bin/env python3
"""No Mac: confirma regras somente após conseguir abrir uma nova sessão SSH."""
import shlex
import subprocess
import sys
import time

host = sys.argv[1] if len(sys.argv) > 1 else 'orbit-staging'
remote = r'''
from pathlib import Path
import re, sys
request=Path('/home/ninja/orbit-bootstrap/firewall-proof-request')
if not request.exists(): sys.exit(3)
value=request.read_text().strip()
if not re.fullmatch(r'/home/ninja/orbit-bootstrap/\.firewall-proof-[a-f0-9]{32}',value): sys.exit(4)
proof=Path(value)
if proof.exists(): sys.exit(3)  # Não confunde confirmação antiga com nova execução.
proof.touch()
print('Nova conexão SSH confirmada; observador root pode cancelar o rollback.')
'''
print('Aguardando aplicação das novas regras no Ubuntu...', flush=True)
deadline = time.monotonic() + 540
while time.monotonic() < deadline:
    result = subprocess.run(
        ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', host,
         'python3 -c ' + shlex.quote(remote)],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        print(result.stdout.strip())
        break
    if result.returncode == 4:
        sys.exit('Nome de confirmação inválido; nenhuma confirmação foi enviada.')
    time.sleep(5)
else:
    sys.exit('Sem confirmação SSH. O rollback permanece agendado; verifique o acesso.')
