const fs = require('fs');
const path = require('path');

const cwd = '/home/ubuntu/RipsPriceX';
const node = '/home/ubuntu/.nvm/versions/node/v20.20.1/bin/node';

function loadEnv(file) {
  const env = {};
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    env[t.slice(0, i)] = t.slice(i + 1);
  }
  return env;
}

const fileEnv = loadEnv(path.join(cwd, '.env'));
const baseEnv = {
  ...fileEnv,
  NODE_ENV: 'production',
  NODE_OPTIONS: '--max-old-space-size=256',
  PATH: '/home/ubuntu/.nvm/versions/node/v20.20.1/bin:' + (process.env.PATH || ''),
};

module.exports = {
  apps: [
    {
      name: 'ripspricex-api',
      cwd,
      script: 'server/src/app.js',
      interpreter: node,
      env: baseEnv,
      max_memory_restart: '280M',
      restart_delay: 4000,
      autorestart: true,
    },
    {
      name: 'ripspricex-admin',
      cwd,
      script: 'node_modules/@react-router/serve/bin.js',
      args: './build/server/index.js',
      interpreter: node,
      env: { ...baseEnv, PORT: '3010' },
      max_memory_restart: '320M',
      restart_delay: 4000,
      autorestart: true,
    },
  ],
};
