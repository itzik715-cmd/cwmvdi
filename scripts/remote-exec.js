// Helper script to run commands on remote server via SSH
const {Client} = require('ssh2');

const HOST = '91.228.126.46';
const USER = 'root';
const PASS = 'Omci295729572957';

function exec(cmd, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = '', stderr = '';
    const timer = setTimeout(() => {
      conn.end();
      resolve({ stdout, stderr, timedOut: true });
    }, timeout);

    conn.on('ready', () => {
      conn.exec(cmd, (err, stream) => {
        if (err) { clearTimeout(timer); conn.end(); reject(err); return; }
        stream.on('data', d => { stdout += d; process.stdout.write(d); });
        stream.stderr.on('data', d => { stderr += d; process.stderr.write(d); });
        stream.on('close', (code) => {
          clearTimeout(timer);
          conn.end();
          resolve({ stdout, stderr, code });
        });
      });
    }).on('error', e => {
      clearTimeout(timer);
      reject(e);
    }).connect({
      host: HOST,
      port: 22,
      username: USER,
      password: PASS,
      readyTimeout: 15000,
    });
  });
}

const cmd = process.argv.slice(2).join(' ');
if (!cmd) { console.error('Usage: node remote-exec.js <command>'); process.exit(1); }
exec(cmd, parseInt(process.env.TIMEOUT || '120000')).then(r => {
  if (r.timedOut) { console.log('\n[TIMED OUT - partial output above]'); }
  process.exit(r.code || 0);
}).catch(e => { console.error('Error:', e.message); process.exit(1); });
