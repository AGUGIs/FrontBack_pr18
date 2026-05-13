/**
 * Настройка доверенного HTTPS для localhost (ПР15)
 * 
 * ВАЖНО: Запускать в PowerShell ОТ ИМЕНИ АДМИНИСТРАТОРА!
 * Иначе certutil не сможет добавить CA в доверенные.
 *
 * Запуск: npm run cert
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const certPath = path.join(__dirname, 'localhost.pem');
const keyPath = path.join(__dirname, 'localhost-key.pem');
const caPath = path.join(__dirname, 'rootCA.pem');
const caKeyPath = path.join(__dirname, 'rootCA-key.pem');
const caDerPath = path.join(__dirname, 'rootCA.crt'); // DER-формат для Windows

// Удаляем старые сертификаты если есть
[certPath, keyPath, caPath, caKeyPath, caDerPath].forEach(f => {
  if (fs.existsSync(f)) fs.unlinkSync(f);
});

// Устанавливаем node-forge
try {
  require.resolve('node-forge');
} catch (e) {
  console.log('Устанавливаем node-forge...');
  execSync('npm install node-forge', { stdio: 'inherit', cwd: __dirname });
}

const forge = require('node-forge');
const pki = forge.pki;

console.log('');
console.log('=== Генерация доверенного HTTPS для localhost ===');
console.log('');

// ШАГ 1: Корневой CA
console.log('[1/4] Генерация корневого CA...');

const caKeys = pki.rsa.generateKeyPair(2048);
const caCert = pki.createCertificate();

caCert.publicKey = caKeys.publicKey;
caCert.serialNumber = '01';
caCert.validity.notBefore = new Date();
caCert.validity.notAfter = new Date();
caCert.validity.notAfter.setFullYear(caCert.validity.notAfter.getFullYear() + 10);

const caAttrs = [
  { name: 'commonName', value: 'KastryulaMarket Dev CA' },
  { name: 'organizationName', value: 'KastryulaMarket' },
  { name: 'countryName', value: 'RU' },
];

caCert.setSubject(caAttrs);
caCert.setIssuer(caAttrs);
caCert.setExtensions([
  { name: 'basicConstraints', cA: true, critical: true },
  { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
  { name: 'subjectKeyIdentifier' },
]);
caCert.sign(caKeys.privateKey, forge.md.sha256.create());

// Сохраняем CA в PEM
fs.writeFileSync(caPath, pki.certificateToPem(caCert));
fs.writeFileSync(caKeyPath, pki.privateKeyToPem(caKeys.privateKey));

// Сохраняем CA в DER (.crt) — Windows лучше принимает этот формат
const caDer = forge.asn1.toDer(pki.certificateToAsn1(caCert)).getBytes();
fs.writeFileSync(caDerPath, Buffer.from(caDer, 'binary'));

console.log('   CA создан: rootCA.pem + rootCA.crt');

// ШАГ 2: Сертификат для localhost
console.log('[2/4] Генерация сертификата для localhost...');

const serverKeys = pki.rsa.generateKeyPair(2048);
const serverCert = pki.createCertificate();

serverCert.publicKey = serverKeys.publicKey;
serverCert.serialNumber = '02';
serverCert.validity.notBefore = new Date();
serverCert.validity.notAfter = new Date();
serverCert.validity.notAfter.setFullYear(serverCert.validity.notAfter.getFullYear() + 1);

serverCert.setSubject([
  { name: 'commonName', value: 'localhost' },
]);

serverCert.setIssuer(caAttrs);

serverCert.setExtensions([
  { name: 'basicConstraints', cA: false },
  { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
  { name: 'extKeyUsage', serverAuth: true },
  { name: 'subjectKeyIdentifier' },
  { name: 'authorityKeyIdentifier', keyIdentifier: true },
  {
    name: 'subjectAltName',
    altNames: [
      { type: 2, value: 'localhost' },
      { type: 7, ip: '127.0.0.1' },
      { type: 7, ip: '::1' },
    ],
  },
]);

serverCert.sign(caKeys.privateKey, forge.md.sha256.create());

fs.writeFileSync(certPath, pki.certificateToPem(serverCert));
fs.writeFileSync(keyPath, pki.privateKeyToPem(serverKeys.privateKey));

console.log('   Сертификат: localhost.pem');
console.log('   Ключ: localhost-key.pem');

// ШАГ 3: Добавление CA в доверенные Windows (через .crt файл)
console.log('[3/4] Добавление CA в доверенные сертификаты Windows...');

let caInstalled = false;
try {
  // Используем .crt (DER) — Windows принимает его надёжнее чем .pem
  execSync(`certutil -addstore -f "Root" "${caDerPath}"`, { stdio: 'pipe', windowsHide: true });
  console.log('   CA успешно добавлен в доверенные!');
  caInstalled = true;
} catch (e) {
  console.log('');
  console.log('   Не удалось добавить CA автоматически.');
  console.log('   Запустите эту команду в PowerShell ОТ АДМИНИСТРАТОРА:');
  console.log('');
  console.log(`   certutil -addstore -f "Root" "${caDerPath}"`);
  console.log('');
}

// ШАГ 4: Готово
console.log('[4/4] Готово!');
console.log('');
if (caInstalled) {
  console.log('ВАЖНО: Полностью закройте Chrome (все окна!) и откройте заново.');
  console.log('');
}
console.log('Запустите сервер:  npm start');
console.log('Откройте:         https://localhost:3000');
console.log('');
