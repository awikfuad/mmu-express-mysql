import crypto from 'node:crypto';
import ical from 'node-ical';
import db from '../config/db.js';
import { masehiToHijri } from '../utils/hijriyahHelper.js';

// Integrasi Kalender Pendidikan dengan Google Calendar (via ICS).
//
// Arah:
//  - App -> Google : feed langganan URL (.ics) + unduh file .ics (import manual di Google).
//  - Google -> App : tarik agenda dari Public iCal URL kalender MMU lalu import (posts `source='GOOGLE'`).
// Keterbatasan: langganan Google bersifat read-only mirror (edit di Google tidak kembali ke app).

export const KATEGORI_KALENDER = ['EFEKTIF', 'LIBUR', 'UJIAN', 'KEGIATAN'];
const SEMESTER_KALENDER = ['IMDA 1', 'IMDA 2', 'IMDA 3'];
const PRODID = '-//MMU A-44//Kalender Pendidikan//ID';
const CAL_NAME = 'Kalender Pendidikan MMU A-44';

const pad2 = (n) => String(n).padStart(2, '0');
const isValidDate = (s) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
    const d = new Date(`${s}T00:00:00`);
    return !isNaN(d.getTime());
};

// Tambah N hari pada YYYY-MM-DD (aritmetika UTC murni)
const addDaysISO = (iso, days) => {
    const [y, m, d] = String(iso).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

// Escape teks RFC 5545 (`\`, `;`, `,`, newline)
const escapeICS = (text) =>
    String(text == null ? '' : text)
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');

// Folding baris ICS (RFC 5545): maks 75 oktet/baris, sambungan diawali spasi
const foldLine = (line) => {
    const buf = [];
    if (line.length <= 75) return line;
    buf.push(line.slice(0, 75));
    let rest = line.slice(75);
    while (rest.length > 74) {
        buf.push(' ' + rest.slice(0, 74));
        rest = rest.slice(74);
    }
    if (rest.length) buf.push(' ' + rest);
    return buf.join('\r\n');
};

const icsDate = (iso) => String(iso).replace(/-/g, '');
const icsDateTime = (d) => {
    const s = d instanceof Date ? d : new Date(d);
    return `${s.getUTCFullYear()}${pad2(s.getUTCMonth() + 1)}${pad2(s.getUTCDate())}T${pad2(s.getUTCHours())}${pad2(s.getUTCMinutes())}${pad2(s.getUTCSeconds())}Z`;
};

// ============================== SETTINGS ==============================

export const getGoogleSettings = async () => {
    const r = await db.execute({
        sql: 'SELECT kalender_feed_key, kalender_gcal_url, kalender_last_pulled FROM sekolah_settings WHERE lembaga = \'ALL\'',
        args: []
    });
    const row = r.rows[0] || {};
    return {
        feed_key: row.kalender_feed_key || null,
        gcal_url: row.kalender_gcal_url || null,
        last_pulled: row.kalender_last_pulled || null
    };
};

export const getOrCreateFeedKey = async () => {
    const s = await getGoogleSettings();
    if (s.feed_key) return s.feed_key;
    const key = crypto.randomBytes(24).toString('hex');
    await db.execute({
        sql: `UPDATE sekolah_settings SET kalender_feed_key = ?, updated_at = CURRENT_TIMESTAMP WHERE lembaga = 'ALL'`,
        args: [key]
    });
    return key;
};

export const setFeedKey = async (key) => {
    await db.execute({
        sql: `UPDATE sekolah_settings SET kalender_feed_key = ?, updated_at = CURRENT_TIMESTAMP WHERE lembaga = 'ALL'`,
        args: [key]
    });
};

// Putar kunci feed baru (random 24-byte hex)
export const rotateFeedKey = async () => {
    const key = crypto.randomBytes(24).toString('hex');
    await setFeedKey(key);
    return key;
};

export const setGcalUrl = async (url) => {
    await db.execute({
        sql: `UPDATE sekolah_settings SET kalender_gcal_url = ?, updated_at = CURRENT_TIMESTAMP WHERE lembaga = 'ALL'`,
        args: [url || null]
    });
};

export const setLastPulled = async (ts) => {
    await db.execute({
        sql: `UPDATE sekolah_settings SET kalender_last_pulled = ?, updated_at = CURRENT_TIMESTAMP WHERE lembaga = 'ALL'`,
        args: [ts || null]
    });
};

// ============================== FEED DATA ==============================

// Ambil agenda untuk feed/ekspor berdasarkan filter opsional.
// lembagaFilter: 'ALL' → semua | 'MADRASAH'/'TPQ' → k.lembaga IN (lembaga, 'ALL')
export const getKalenderFeedRows = async ({ lembaga = 'ALL', academic_year_id, kategori, tanggal_mulai, tanggal_selesai } = {}) => {
    const conditions = [];
    const args = [];

    const lembagaUp = String(lembaga || 'ALL').toUpperCase();
    if (lembagaUp !== 'ALL') {
        conditions.push('k.lembaga IN (?, ?)');
        args.push(lembagaUp, 'ALL');
    }
    if (academic_year_id) {
        conditions.push('k.academic_year_id = ?');
        args.push(Number(academic_year_id));
    }
    if (kategori) {
        const kat = String(kategori).toUpperCase();
        conditions.push('k.kategori = ?');
        args.push(kat);
    }
    if (isValidDate(tanggal_mulai) && isValidDate(tanggal_selesai)) {
        conditions.push('k.tanggal_selesai >= ? AND k.tanggal_mulai <= ?');
        args.push(tanggal_mulai, tanggal_selesai);
    }

    const sql = `
        SELECT k.id, k.academic_year_id, k.semester, k.kategori, k.judul,
               k.tanggal_mulai, k.tanggal_selesai, k.hijriyah_mulai, k.hijriyah_selesai,
               k.keterangan, k.lembaga, k.source, k.external_uid
        FROM kalender_pendidikan k
        ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
        ORDER BY k.tanggal_mulai ASC, k.id ASC
    `;
    const result = await db.execute({ sql, args });
    return result.rows;
};

// ============================== RENDER ICS ==============================

export const renderKalenderICS = (rows, { includePrivateMarker = true } = {}) => {
    const now = new Date();
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        `PRODID:${PRODID}`,
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `X-WR-CALNAME:${escapeICS(CAL_NAME)}`,
        'X-WR-TIMEZONE:Asia/Jakarta'
    ];

    for (const r of rows) {
        if (!r || !isValidDate(r.tanggal_mulai) || !isValidDate(r.tanggal_selesai)) continue;
        const uid = `kal-${r.id}@mmu-a44`;
        const keterangan = [
            r.keterangan ? escapeICS(r.keterangan) : '',
            includePrivateMarker ? `[kategori ${r.kategori}]` : ''
        ].filter(Boolean).join(' / ');
        const event = [
            'BEGIN:VEVENT',
            `UID:${uid}`,
            `DTSTAMP:${icsDateTime(now)}`,
            `DTSTART;VALUE=DATE:${icsDate(r.tanggal_mulai)}`,
            `DTEND;VALUE=DATE:${icsDate(addDaysISO(r.tanggal_selesai, 1))}`,
            `SUMMARY:${escapeICS(r.judul)}`,
            keterangan ? `DESCRIPTION:${keterangan}` : null,
            `CATEGORIES:${escapeICS(r.kategori || 'KEGIATAN')}`,
            `X-MMU-KATEGORI:${escapeICS(r.kategori || 'KEGIATAN')}`,
            `X-MMU-LEMBAGA:${escapeICS(r.lembaga || 'ALL')}`,
            `X-MMU-SEMESTER:${escapeICS(r.semester || 'IMDA 1')}`,
            `X-MMU-KAL-ID:${r.id}`,
            `X-MMU-SOURCE:${escapeICS(r.source || 'LOCAL')}`,
            'STATUS:CONFIRMED',
            'END:VEVENT'
        ].filter((l) => l !== null);
        lines.push(...event);
    }

    lines.push('END:VCALENDAR');
    return lines.map(foldLine).join('\r\n') + '\r\n';
};

// ============================== PARSE ICS ==============================

// Konversi Date node-ical → 'YYYY-MM-DD'. All-day DATE disimpan node-ical sebagai
// tengah malam *lokal*, jadi pakai getter lokal agar tanggal kalender tidak bergeser.
const toDateOnly = (d) => {
    if (!d) return '';
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt.getTime())) return '';
    return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
};

const sha1hex = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16);

const inferKategori = (vevent) => {
    const cats = Array.isArray(vevent.categories) ? vevent.categories.join(' ') : String(vevent.categories || '');
    const tags = [
        String(vevent['x-mmu-kategori'] || '').toUpperCase(),
        cats,
        String(vevent.summary || ''),
        String(vevent.description || '')
    ].join(' ');
    for (const k of KATEGORI_KALENDER) {
        if (tags.includes(k)) return k;
    }
    return 'KEGIATAN';
};

// Parse VEVENT → daftar agenda {judul, tanggal_mulai, tanggal_selesai, kategori, semester, keterangan, external_uid}
export const parseKalenderICS = (text) => {
    const out = [];
    let parsed;
    try {
        parsed = ical.parseICS(String(text || ''));
    } catch (e) {
        throw new Error(`Gagal memparse ICS: ${e.message}`);
    }
    const vevents = Object.values(parsed || {}).filter((ev) => ev && ev.type === 'VEVENT');
    if (!vevents.length) {
        throw new Error('File/teks ICS tidak mengandung agenda (VEVENT) — pastikan ini berkas iCalendar yang valid');
    }
    for (const ev of vevents) {
        const judul = String(ev.summary || '').trim();
        if (!judul) continue;

        const isAllDay = String(ev.datetype || '').toLowerCase() === 'date';
        const mulai = toDateOnly(ev.start);
        let selesai = toDateOnly(ev.end);
        if (isAllDay && selesai) selesai = addDaysISO(selesai, -1); // DTEND eksklusif
        if (!selesai) selesai = mulai;

        if (!isValidDate(mulai) || !isValidDate(selesai)) continue;
        if (mulai > selesai) selesai = mulai;

        const externalUid = String(ev.uid || '').trim() || `google-${sha1hex(`${judul}|${mulai}|${selesai}`)}`;

        out.push({
            judul,
            tanggal_mulai: mulai,
            tanggal_selesai: selesai,
            kategori: inferKategori(ev),
            semester: String(ev['x-mmu-semester'] || '').toUpperCase() || null,
            keterangan: String(ev.description || '').trim() || null,
            external_uid: externalUid
        });
    }
    return out;
};

// ============================== IMPORT / UPSERT ==============================

// Import daftar agenda ICS dengan dedup per external_uid (baris source='GOOGLE').
// Row yang sudah ada → update; baru → insert source='GOOGLE'. Return ringkasan.
export const importKalenderICS = async (text, lembagaPemanggil = 'ALL') => {
    const rows = parseKalenderICS(text);
    const lembaga = String(lembagaPemanggil || 'ALL').toUpperCase() || 'ALL';
    let added = 0;
    let updated = 0;
    let skipped = 0;

    for (const r of rows) {
        const existing = await db.execute({
            sql: `SELECT id FROM kalender_pendidikan WHERE external_uid = ? LIMIT 1`,
            args: [r.external_uid]
        });
        const row = existing.rows[0];
        const semester = r.semester && SEMESTER_KALENDER.includes(r.semester) ? r.semester : 'IMDA 1';
        const kategori = KATEGORI_KALENDER.includes(r.kategori) ? r.kategori : 'KEGIATAN';
        const hm = masehiToHijri(r.tanggal_mulai);
        const hs = masehiToHijri(r.tanggal_selesai);

        if (row) {
            await db.execute({
                sql: `UPDATE kalender_pendidikan
                      SET judul = ?, kategori = ?, semester = ?, tanggal_mulai = ?, tanggal_selesai = ?,
                          hijriyah_mulai = ?, hijriyah_selesai = ?, keterangan = ?
                      WHERE id = ?`,
                args: [
                    r.judul, kategori, semester,
                    r.tanggal_mulai, r.tanggal_selesai,
                    hm ? hm.full : null, hs ? hs.full : null,
                    r.keterangan,
                    Number(row.id)
                ]
            });
            updated += 1;
        } else {
            await db.execute({
                sql: `INSERT INTO kalender_pendidikan
                        (academic_year_id, semester, kategori, judul, tanggal_mulai, tanggal_selesai,
                         hijriyah_mulai, hijriyah_selesai, keterangan, lembaga, source, external_uid)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'GOOGLE', ?)`,
                args: [
                    null, semester, kategori, r.judul,
                    r.tanggal_mulai, r.tanggal_selesai,
                    hm ? hm.full : null, hs ? hs.full : null,
                    r.keterangan, lembaga, r.external_uid
                ]
            });
            added += 1;
        }
    }

    const total = rows.length;
    skipped = Math.max(0, total - added - updated);
    return { added, updated, skipped, total };
};

// Ambil agenda dari Public iCal URL kalender Google lalu import (untuk pull / cron)
export const importKalenderFromUrl = async (url, lembagaPemanggil = 'ALL') => {
    if (!/^https?:\/\//i.test(String(url || ''))) {
        throw new Error('URL iCal tidak valid — harus diawali http:// atau https://');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    let res;
    try {
        res = await fetch(url, { signal: controller.signal, headers: { Accept: 'text/calendar, text/plain, */*' } });
    } finally {
        clearTimeout(timer);
    }
    if (!res.ok) {
        throw new Error(`Gagal mengambil iCal: HTTP ${res.status} ${res.statusText}`);
    }
    const text = await res.text();
    return importKalenderICS(text, lembagaPemanggil);
};
