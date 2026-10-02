import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] || '.');
const port = process.argv[3] || '3000';
const varsPath = join(root, '.dev.vars');
const loginDirectory = join(root, '.local');
if (existsSync(varsPath)) {
  console.log('本地管理员已初始化；保留现有配置和考试数据。');
  process.exit(0);
}
const password = randomBytes(18).toString('base64url');
const salt = randomBytes(16).toString('hex');
const hash = pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
mkdirSync(root, { recursive: true, mode: 0o700 });
mkdirSync(loginDirectory, { recursive: true, mode: 0o700 });
writeFileSync(varsPath, `ADMIN_CREDENTIAL="${salt}:${hash}"\nDEMO_MODE="true"\nALLOW_FORMAL_PUBLISH="false"\n`, { mode: 0o600, flag: 'wx' });
writeFileSync(join(loginDirectory, 'admin-login.txt'), `佳音考试管理本地后台\n网址：http://localhost:${port}/\n管理员口令：${password}\n\n此口令仅用于本机开发。不要上传、分享或沿用到生产环境。\n`, { mode: 0o600, flag: 'wx' });
chmodSync(varsPath, 0o600);
console.log('已生成独立管理员配置。登录资料保存在运行目录的 .local/admin-login.txt。');
