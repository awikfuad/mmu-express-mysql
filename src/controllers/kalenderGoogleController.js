import crypto from 'node:crypto';
import db from '../config/db.js';
import {
    renderKalenderICS,
    getKalenderFeedRows,
    getGoogleSettings,
    getOrCreateFeedKey,
    rotateFeedKey,
    setGcalUrl,
    setLastPulled,
    importKalenderICS,
    importKalenderFromUrl
} from '../services/kalenderGoogleService.js';

const isValidUrl = (u) => /^https?:\/\//i.test(String(u || ''));

const safeCompare = (a, b) => {
    const sa = String(a || '');
    const sb = String(b || '');
    if (sa.length !== sb.length) return false;
    return crypto.timingSafeEqual(Buffer.from(sa), Buffer.from(sb));
};

const originOf = (req) => `${req.protocol}://${req.get('host')}`;

const feedUrlOf = (req, key) => `${originOf(req)}/api/kalender/feed.ics?key=${encodeURIComponent(key)}`;

const parseFilter = (q) => ({
    akademik: q.academic_year_id ? Number(q.academic_year_id) : undefined,
    kategori: q.kategori ? String(q.kategori).toUpperCase() : undefined,
    tanggal_mulai: q.tanggal_mulai || undefined,
    tanggal_selesai: q.tanggal_selesai || undefined
});

// GET /api/kalender/export.ics — unduh .ics (admin/teacher, terscope lembaga)
export const exportKalenderIcs = async (req, res) => {
    try {
        const callerLembaga = req.user?.lembaga || 'ALL';
        const lembaga = callerLembaga === 'ALL' && req.query.lembaga
            ? String(req.query.lembaga).toUpperCase()
            : callerLembaga;
        const f = parseFilter(req.query);
        const rows = await getKalenderFeedRows({
            lembaga,
            academic_year_id: f.akademik,
            kategori: f.kategori,
            tanggal_mulai: f.tanggal_mulai,
            tanggal_selesai: f.tanggal_selesai
        });
        const ics = renderKalenderICS(rows);
        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="kalender-pendidikan-MMU-A44.ics"');
        return res.send(ics);
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// GET /api/kalender/feed.ics — feed langganan (publik, wajib ?key=)
export const feedKalenderIcs = async (req, res) => {
    try {
        const settings = await getGoogleSettings();
        if (!settings.feed_key || !safeCompare(req.query.key, settings.feed_key)) {
            return res.status(403).json({ success: false, message: 'Kunci feed kalender tidak valid' });
        }
        const lembaga = req.query.lembaga ? String(req.query.lembaga).toUpperCase() : 'ALL';
        const f = parseFilter(req.query);
        const rows = await getKalenderFeedRows({
            lembaga,
            academic_year_id: f.akademik,
            kategori: f.kategori,
            tanggal_mulai: f.tanggal_mulai,
            tanggal_selesai: f.tanggal_selesai
        });
        const ics = renderKalenderICS(rows);
        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', 'inline; filename="kalender-pendidikan-MMU-A44.ics"');
        return res.send(ics);
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// GET /api/kalender/google/status — status integrasi (admin/teacher)
export const getKalenderGoogleStatus = async (req, res) => {
    try {
        const settings = await getGoogleSettings();
        const [totalRes, googleRes] = await Promise.all([
            db.execute({ sql: 'SELECT COUNT(*) AS c FROM kalender_pendidikan', args: [] }),
            db.execute({ sql: `SELECT COUNT(*) AS c FROM kalender_pendidikan WHERE source = 'GOOGLE'`, args: [] })
        ]);
        const n = (r) => Number(r?.rows?.[0]?.c || 0);
        const feedKey = await getOrCreateFeedKey();
        return res.json({
            success: true,
            data: {
                feed_url: feedUrlOf(req, feedKey),
                feed_key_set: !!settings.feed_key,
                gcal_url: settings.gcal_url,
                last_pulled: settings.last_pulled,
                total_agenda: n(totalRes),
                agenda_google: n(googleRes)
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// POST /api/kalender/google/feed-key — rotasi kunci feed (admin)
export const setKalenderFeedKey = async (req, res) => {
    try {
        const { rotate = false } = req.body || {};
        const key = rotate ? await rotateFeedKey() : await getOrCreateFeedKey();
        return res.json({
            success: true,
            feed_url: feedUrlOf(req, key),
            message: rotate ? 'Kunci feed berhasil diputar' : 'Kunci feed siap digunakan'
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// POST /api/kalender/google/url — simpan Public iCal URL kalender MMU (admin)
export const setKalenderGoogleUrl = async (req, res) => {
    try {
        const url = String(req.body?.url || '').trim();
        if (url && !isValidUrl(url)) {
            return res.status(400).json({ success: false, message: 'URL iCal tidak valid — harus http:// atau https://' });
        }
        await setGcalUrl(url || null);
        return res.json({ success: true, message: url ? 'URL iCal Google tersimpan' : 'URL iCal Google dihapus' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// POST /api/kalender/google/import — tarik agenda dari Google (url) atau file .ics (multipart)
export const importKalenderGoogle = async (req, res) => {
    try {
        const callerLembaga = req.user?.lembaga || 'ALL';
        let result;
        let from = null;

        if (req.file && req.file.buffer) {
            result = await importKalenderICS(req.file.buffer.toString('utf-8'), callerLembaga);
            from = 'file';
        } else if (isValidUrl(req.body?.url)) {
            result = await importKalenderFromUrl(req.body.url, callerLembaga);
            from = 'url';
            await setGcalUrl(req.body.url);
            await setLastPulled(new Date().toISOString());
        } else {
            return res.status(400).json({
                success: false,
                message: 'Kirim file .ics (multipart "file") atau url iCal Google ({"url": "..."})'
            });
        }

        return res.json({
            success: true,
            message: `Import ${from} selesai: ${result.added} baru, ${result.updated} diperbarui, ${result.skipped} dilewati.`,
            data: result
        });
    } catch (error) {
        const status = /URL iCal tidak valid|Gagal memparse|tidak mengandung agenda|Gagal mengambil iCal/i.test(error.message) ? 400 : 500;
        return res.status(status).json({ success: false, message: error.message });
    }
};