import 'dotenv/config';

const WEAK_SECRETS = [
  'your-secret-key',
  'your-refresh-secret',
  'KunciRahasiaAccessToken123!',
  'KunciRahasiaRefreshTokenSuperRahasia456!',
  'secret',
  'rahasia',
];

export const env = {
  port: Number(process.env.PORT || 5000),
  jwtSecret: process.env.JWT_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  corsOrigin: process.env.CORS_ORIGIN || '*',
  trustProxy: process.env.TRUST_PROXY === 'true',
  isProduction: process.env.NODE_ENV === 'production',
  // Password default (dipakai saat membuat akun santri baru & reset password santri).
  // Fallback 'santri123' utk kompatibilitas akun lama/manual.
  defaultResetPassword: process.env.DEFAULT_RESET_PASSWORD || 'santri123',
  // Google Sign-In (opsional — bila kosong, login Google ditolak dengan pesan konfigurasi)
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  // Database MySQL/MariaDB
  mysql: {
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'mmu_a44',
  },
};

const validateEnv = () => {
  for (const key of ['jwtSecret', 'jwtRefreshSecret']) {
    if (!env[key]) {
      throw new Error(
        `[ENV] '${key}' wajib diset. Salin backend/.env.example lalu isi dengan nilai acak kuat.`
      );
    }
    if (WEAK_SECRETS.includes(env[key])) {
      throw new Error(
        `[ENV] '${key}' masih berisi nilai default yang lemah. Generate dengan:\n` +
        `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
      );
    }
  }
};

validateEnv();

export default env;
