import db from '../config/db.js';

/**
 * Haversine formula: hitung jarak (meter) antara 2 titik koordinat GPS.
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // radius bumi dalam meter
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Middleware: validasi geofencing untuk endpoint presensi.
 * 
 * Jika geofence_enabled = 1 di sekolah_settings:
 *   - Request WAJIB menyertakan latitude & longitude di body
 *   - Jarak dari titik sekolah ke lokasi user harus ≤ geofence_radius (meter)
 *   - Jika tidak ada lokasi atau di luar radius → tolak 403
 * 
 * Jika geofence_enabled = 0:
 *   - Middleware bypass (lanjutkan ke handler berikutnya)
 * 
 * Koordinat juga ditempelkan ke req.body agar controller bisa menyimpannya.
 */
export const geofenceGuard = async (req, res, next) => {
    try {
        // Ambil pengaturan geofence dari sekolah_settings lembaga pemanggil
        const lembaga = (req.user?.lembaga || 'ALL').toUpperCase();
        const result = await db.execute({
            sql: `SELECT latitude, longitude, geofence_radius, geofence_enabled 
                  FROM sekolah_settings WHERE lembaga = ? LIMIT 1`,
            args: [lembaga]
        });

        const settings = result.rows[0];

        // Jika geofence tidak aktif, bypass
        if (!settings || !settings.geofence_enabled) {
            return next();
        }

        // Admin di-bypass geofence: admin mengisi presensi massal dari web/dashboard
        // (roster kelas & rekap), bukan presensi real-time via GPS di lokasi.
        if (req.user?.role === 'admin') {
            return next();
        }

        // Koreksi presensi untuk tanggal lampau (body `date` != hari ini) → bypass geofence.
        // Konsep geofence hanya berlaku saat presensi dilakukan hari itu juga; mengisi ulang
        // tanggal yang sudah lewat tidak perlu berada di lokasi sekolah.
        const reqDate = req.body?.date;
        if (reqDate) {
            const d = new Date();
            const off = d.getTimezoneOffset();
            const todayLocal = new Date(d.getTime() - off * 60000).toISOString().split('T')[0];
            if (String(reqDate) !== todayLocal) {
                return next();
            }
        }

        // Geofence hanya wajib utk presensi HADIR. Status IZIN/SAKIT/ALPA justru
        // menandakan orang tsb TIDAK berada di lokasi sekolah, sehingga bisa
        // dicatat dari luar area (tidak perlu koordinat).
        const status = req.body?.status ? String(req.body.status).toUpperCase() : 'HADIR';
        if (status !== 'HADIR') {
            return next();
        }

        const { latitude, longitude, geofence_radius } = settings;

        // Jika sekolah belum set koordinat, bypass (konfigurasi belum lengkap)
        if (!latitude || !longitude) {
            return next();
        }

        // Ambil koordinat dari body request
        const { latitude: reqLat, longitude: reqLng, accuracy } = req.body;

        // Jika user tidak mengirim lokasi, tolak
        if (reqLat == null || reqLng == null) {
            return res.status(403).json({
                success: false,
                message: 'Presensi ditolak: lokasi GPS wajib diaktifkan. Aktifkan layanan lokasi pada perangkat Anda.'
            });
        }

        // Hitung jarak dari sekolah
        const distance = haversineDistance(latitude, longitude, reqLat, reqLng);
        const radius = geofence_radius || 100;

        // Jika di luar radius, tolak
        if (distance > radius) {
            return res.status(403).json({
                success: false,
                message: `Presensi ditolak: Anda berada ${Math.round(distance)}m dari sekolah (maks ${radius}m). Silakan datang ke lokasi sekolah.`
            });
        }

        // Lolos validasi — lanjutkan ke controller
        // Koordinat sudah ada di req.body, controller akan menyimpannya
        next();
    } catch (error) {
        console.error('Geofence middleware error:', error);
        // Jika error DB, bypass saja (jangan blokir presensi karena error middleware)
        next();
    }
}
