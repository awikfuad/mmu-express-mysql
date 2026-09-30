import 'dotenv/config';
import app from './app.js';
import env from './config/env.js';
import { scheduleKalenderGoogleSync } from './jobs/kalenderGoogleJob.js';

const PORT = env.port || process.env.PORT || 5000;

// Registrasi job terjadwal
scheduleKalenderGoogleSync();

// Jalankan Server dengan menyertakan '0.0.0.0' agar bisa diakses dari jaringan luar/PC lain
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server berjalan lancar di http://0.0.0.0:${PORT}`);
});