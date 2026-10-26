// Compatibility entry point: one parser owns weapons, appearances and images.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const python=process.env.PYTHON||'python';
const result=spawnSync(python,[fileURLToPath(new URL('./parse_client.py',import.meta.url)),...process.argv.slice(2)],{stdio:'inherit'});
if(result.error){console.error('Не удалось запустить Python. Используй: python parse_client.py');process.exitCode=1;}
else process.exitCode=result.status??1;

