import cron from 'node-cron';
import { getGoogleSettings, importKalenderFromUrl, setLastPulled } from '../services/kalenderGoogleService.js';

// Pull terjadwal agenda Kalender Pendidikan dari Public iCal URL Google Calendar.
// Hanya berjalan saat proses backend hidup (lokal/VPS). Di Vercel serverless gunakan
// Vercel Cron yang memanggil POST /api/kalender/google/import (lihat AGENTS.md).
export const scheduleKalenderGoogleSync = () => {
    cron.schedule('0 6 * * *', async () => {
        try {
            const settings = await getGoogleSettings();
            if (!settings.gcal_url) {
                console.log('[kaldik-google] URL iCal Google belum dipasang — pull di-skip.');
                return;
            }
            const result = await importKalenderFromUrl(settings.gcal_url, 'ALL');
            await setLastPulled(new Date().toISOString());
            console.log(`[kaldik-google] Pull harian selesai: ${result.added} baru, ${result.updated} diperbarui, ${result.skipped} dilewati.`);
        } catch (e) {
            console.error('[kaldik-google] Pull harian gagal:', e?.message || e);
        }
    }, { timezone: 'Asia/Jakarta' });
    console.log('🕐 Cron Kaldik ↔ Google Calendar terdaftar (setiap hari 06:00 WIB).');
};