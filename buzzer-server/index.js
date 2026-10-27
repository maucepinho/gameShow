'use strict';

const path = require('node:path');
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const { createBuzzerServer } = require('./server');
const { localUrls } = require('./network');

const service = createBuzzerServer();
const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT deve ser um número de 1 a 65535.');
}

service.listen(port, '0.0.0.0').then((address) => {
  console.log('Jogo no notebook: http://localhost:3000');
  const urls = localUrls(address.port);
  if (urls.length) {
    for (const { name, url } of urls) console.log(`Celulares na mesma rede (${name}): ${url}`);
  } else {
    console.log(`Buzzer: http://localhost:${address.port}. Conecte o notebook ao Wi-Fi para acessar pelos celulares.`);
  }
}).catch((error) => {
  console.error('Não foi possível iniciar o servidor:', error.message);
  process.exitCode = 1;
});

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    service.close().then(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
