import db from '../config/db.js';
import { LEMBAGA } from '../utils/lembagaHelper.js';
import { resolveDateRange, nextDayISO } from '../utils/dateRangeHelper.js';
import { isLembagaValidService } from './lembagaService.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Retry transaksi singkat saat DB file terkunci (SQLITE_BUSY)
const withBusyRetry = async (fn, retries = 3) => {
    let lastErr;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (String(err.message || '').includes('SQLITE_BUSY')) {
                await sleep(150 * (i + 1));
                continue;
            }
            throw err;
        }
    }
    throw lastErr;
};

const DAY_NAMES = ['AHAD', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'];

const toUpper = (v) => (v ? String(v).toUpperCase() : LEMBAGA.ALL);

// Tanggal hari ini dalam zona waktu lokal (bukan UTC — sinkron dgn tanggal yang dikirim frontend)
const todayLocalISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Nama hari dari string tanggal YYYY-MM-DD (aritmetika UTC murni, konsisten pola izinGuruService)
const dayNameOf = (s) => {
    const [y, m, d] = String(s).split('-').map(Number);
    return DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
};

// Durasi jadwal dalam jam (HH:MM → HH:MM)
const durationHours = (startTime, endTime) => {
    const toMin = (t) => {
        if (!t) return 0;
        const parts = String(t).split(':');
        return Number(parts[0] || 0) * 60 + Number(parts[1] || 0);
    };
    const diff = Math.max(0, toMin(endTime) - toMin(startTime));
    return Math.round((diff / 60) * 100) / 100;
};

const parsePeriod = (period) => {
    const m = String(period || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) throw new Error('Periode harus berformat YYYY-MM (mis. 2026-08)');
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (month < 1 || month > 12) throw new Error('Bulan periode tidak valid');
    return { year, month };
};

const lastDayOfMonth = (year, month) => new Date(year, month, 0).getDate();

// Parse JSON dengan aman (return null bila gagal)
const safeJson = (v) => {
    if (v === null || v === undefined || v === '') return null;
    try {
        return JSON.parse(v);
    } catch {
        return null;
    }
};

// Normalisasi daftar tunjangan ({nama, nominal}[]) — buang baris kosong
const normalizeAllowances = (arr) => {
    if (!Array.isArray(arr)) return null;
    const items = arr
        .map((a) => ({ nama: String(a?.nama || '').trim(), nominal: Number(a?.nominal) }))
        .filter((a) => a.nama || (Number.isFinite(a.nominal) && a.nominal > 0));
    return items.length ? items : null;
};

// Jumlah total nominal tunjangan
const sumAllowances = (arr) => (arr || []).reduce((s, a) => s + (Number.isFinite(Number(a.nominal)) ? Number(a.nominal) : 0), 0);

// ============================================================================
// TARIF GAJI PER JENJANG
// ============================================================================

// Resolve nominal tarif sebuah jenjang: prioritas lembaga spesifik, fallback 'ALL'.
export const getTariffNominalService = async (jenjangId, lembaga = LEMBAGA.ALL) => {
    if (jenjangId === null || jenjangId === undefined) return null;
    const l = toUpper(lembaga);
    const result = await db.execute({
        sql: `
            SELECT nominal FROM salary_tariffs
            WHERE jenjang_id = ? AND LOWER(lembaga) IN (LOWER(?), LOWER(?))
            ORDER BY CASE WHEN LOWER(lembaga) = LOWER(?) THEN 0 ELSE 1 END
            LIMIT 1
        `,
        args: [Number(jenjangId), l, LEMBAGA.ALL, l]
    });
    return result.rows.length ? Number(result.rows[0].nominal) : null;
};

// List tarif per jenjang (semua jenjang + tarif ter-resolve untuk lembaga user).
export const getSalaryTariffsService = async (lembaga = LEMBAGA.ALL) => {
    const l = toUpper(lembaga);

    const jenjangResult = await db.execute({
        sql: 'SELECT id, nama_jenjang FROM jenjang ORDER BY id ASC'
    });

    const tariffRows = await db.execute({
        sql: l === LEMBAGA.ALL
            ? 'SELECT jenjang_id, lembaga, nominal FROM salary_tariffs ORDER BY jenjang_id ASC, lembaga ASC'
            : 'SELECT jenjang_id, lembaga, nominal FROM salary_tariffs WHERE LOWER(lembaga) IN (LOWER(?), LOWER(?)) ORDER BY jenjang_id ASC, lembaga ASC',
        args: l === LEMBAGA.ALL ? [] : [l, LEMBAGA.ALL]
    });

    // Peta nominal per jenjang: spesifik lembaga → fallback ALL
    const nominalMap = new Map();
    for (const row of tariffRows.rows) {
        const jid = Number(row.jenjang_id);
        if (!nominalMap.has(jid)) nominalMap.set(jid, {});
        nominalMap.get(jid)[toUpper(row.lembaga)] = Number(row.nominal);
    }

    const data = (jenjangResult.rows || []).map((j) => {
        const per = nominalMap.get(Number(j.id)) || {};
        const spesifik = per[l];
        const nominal = spesifik !== undefined ? spesifik : (per[LEMBAGA.ALL] !== undefined ? per[LEMBAGA.ALL] : null);
        return {
            jenjang_id: Number(j.id),
            nama_jenjang: j.nama_jenjang,
            nominal,
            lembaga: l,
            sumber: Number(j.id) === 100 ? 'tpq' : 'madrasah'
        };
    });

    return data;
};

// Simpan/ubah tarif per jenjang. Admin scoped dipaksa ke lembaganya sendiri.
export const upsertSalaryTariffService = async ({ jenjang_id, nominal, lembaga }, userLembaga) => {
    const jenjangId = Number(jenjang_id);
    if (!Number.isInteger(jenjangId) || jenjangId <= 0) {
        throw new Error('Jenjang wajib diisi');
    }

    const amount = Number(nominal);
    if (!Number.isFinite(amount) || amount < 0) {
        throw new Error('Tarif harus berupa angka >= 0');
    }

    const userL = toUpper(userLembaga);
    let targetLembaga = toUpper(lembaga);
    if (userL !== LEMBAGA.ALL) targetLembaga = userL;
    if (!(await isLembagaValidService(targetLembaga))) {
        throw new Error('Lembaga tidak valid! Pilih ALL, MADRASAH, atau TPQ.');
    }

    await withBusyRetry(() => db.execute({
        sql: `
            INSERT INTO salary_tariffs (jenjang_id, lembaga, nominal, updated_at)
            VALUES (?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                nominal = VALUES(nominal),
                updated_at = NOW()
        `,
        args: [jenjangId, targetLembaga, amount]
    }));

    return { jenjang_id: jenjangId, lembaga: targetLembaga, nominal: amount };
};

// Hapus tarif (terscope lembaga)
export const deleteSalaryTariffService = async (id, userLembaga) => {
    const tariffId = Number(id);
    if (!Number.isInteger(tariffId) || tariffId <= 0) {
        throw new Error('ID tarif tidak valid');
    }
    const l = toUpper(userLembaga);
    const whereClause = l === LEMBAGA.ALL ? 'id = ?' : 'id = ? AND LOWER(lembaga) = LOWER(?)';
    const args = l === LEMBAGA.ALL ? [tariffId] : [tariffId, l];
    const result = await withBusyRetry(() => db.execute({
        sql: `DELETE FROM salary_tariffs WHERE ${whereClause}`,
        args
    }));
    return result.rowsAffected > 0;
};

// ============================================================================
// PERHITUNGAN JAM MENGAJAR & SLIP GAJI
// ============================================================================

// Guru yang terlihat oleh admin (lembaga sendiri + ALL)
export const getTeachersListService = async (userLembaga = LEMBAGA.ALL) => {
    const l = toUpper(userLembaga);
    const whereClause = l === LEMBAGA.ALL ? '' : 'WHERE LOWER(t.lembaga) IN (LOWER(?), LOWER(?))';
    const args = l === LEMBAGA.ALL ? [] : [l, LEMBAGA.ALL];
    const result = await db.execute({
        sql: `
            SELECT t.id, t.username, t.name, t.lembaga
            FROM teachers t
            ${whereClause}
            ORDER BY t.name ASC
        `,
        args
    });
    return result.rows;
};

// Daftar tanggal dalam [start, end] yang jatuh pada nama hari tertentu (UTC-safe, sama dgn pola lain).
// Bila capToToday (rentang menabrak hari ini), hanya tanggal <= hari ini agar sesi yang belum terjadi tidak dihitung.
const datesMatchingDowRange = (start, end, dowName, capToToday = false) => {
    const todayStr = todayLocalISO();
    const out = [];
    let cur = start;
    while (cur <= end) {
        if (!(capToToday && cur > todayStr) && dayNameOf(cur) === dowName) {
            out.push(cur);
        }
        cur = nextDayISO(cur);
    }
    return out;
};

// Hitung jam mengajar + subtotal seorang guru untuk satu periode.
// Jam = jumlah sesi mengajar pada bulan tersbut (gabungan: sesi yang guru catat absensinya
// `attendances.teacher_id` UNION sesi terjadwal kelas guru utama/piket yang di-expand per
// `day_of_week`), dikali durasi jadwal (`schedules.start_time - end_time`) utk hari & sesi
// yang sama. Kompensasi dari jadwal diperlukan karena presensi v4.0 hanya menyimpan murid
// yang TIDAK hadir — sesi dengan semua murid hadir tidak menghasilkan baris attendances.
export const computeTeacherSalaryService = async ({ teacherId, period, tanggal_mulai, tanggal_selesai }, userLembaga = LEMBAGA.ALL) => {
    const tid = Number(teacherId);
    if (!Number.isInteger(tid) || tid <= 0) throw new Error('ID guru wajib diisi');

    const { year, month } = parsePeriod(period);
    const l = toUpper(userLembaga);
    const todayStr = todayLocalISO();

    // Jendela hitung: rentang tanggal opsional (YYYY-MM-DD) lebih diutamakan; fallback satu bulan penuh period.
    const range = resolveDateRange({ tanggal_mulai, tanggal_selesai });
    let rangeStart;
    let rangeEnd;
    let capToToday;
    if (range) {
        rangeStart = range.tanggal_mulai;
        rangeEnd = range.tanggal_selesai;
        // Rentang menabrak hari ini → sesi jadwal hanya dihitung sampai hari ini
        capToToday = rangeStart <= todayStr && todayStr <= rangeEnd;
    } else {
        rangeStart = `${period}-01`;
        rangeEnd = `${period}-${String(lastDayOfMonth(year, month)).padStart(2, '0')}`;
        capToToday = period === todayStr.slice(0, 7);
    }

    // 1. Sesi yang guru benar-benar mengajar (ada catatan absensi oleh guru tsb)
    const attended = await db.execute({
        sql: `
            SELECT date, session_name
            FROM attendances
            WHERE teacher_id = ? AND date >= ? AND date <= ?
            GROUP BY date, session_name
            ORDER BY date ASC
        `,
        args: [tid, rangeStart, rangeEnd]
    });

    // 2. Jadwal guru (utama & piket) untuk pencarian JP per sesi (1 JP = tarif per jenjang)
    const whereLembaga = l === LEMBAGA.ALL ? '' : 'AND LOWER(s.lembaga) IN (LOWER(?), LOWER(?))';
    const schedArgs = l === LEMBAGA.ALL
        ? [tid, tid]
        : [tid, tid, l, LEMBAGA.ALL];
    const schedResult = await db.execute({
        sql: `
            SELECT s.day_of_week, s.session_name, s.start_time, s.end_time, s.jenjang_id, COALESCE(s.jp,1) as jp
            FROM schedules s
            WHERE (s.teacher_id = ? OR s.substitute_teacher_id = ?)
              ${whereLembaga}
        `,
        args: schedArgs
    });

    const schedByDowSession = new Map();
    for (const s of schedResult.rows) {
        const key = `${String(s.day_of_week || '').toUpperCase()}|${String(s.session_name || '').toUpperCase()}`;
        if (!schedByDowSession.has(key)) schedByDowSession.set(key, []);
        schedByDowSession.get(key).push(s);
    }

    // Jenjang utama guru: jenjang dgn total JP terbanyak pada jadwalnya (basis tarif utk hitung manual
    // saat belum ada data absensi). Tie-break: jenjang_id terkecil.
    const jenjangJpTotal = new Map(); // jenjang_id → total JP
    for (const s of schedResult.rows) {
        const jid = s.jenjang_id != null ? Number(s.jenjang_id) : null;
        const key = jid === null ? 'null' : jid;
        if (!jenjangJpTotal.has(key)) jenjangJpTotal.set(key, { jenjang_id: jid, jp: 0 });
        jenjangJpTotal.get(key).jp += Number(s.jp ?? 1);
    }
    let jenjangUtama = null;
    let jenjangUtamaJp = 0;
    for (const e of jenjangJpTotal.values()) {
        if (e.jp > jenjangUtamaJp || (e.jp === jenjangUtamaJp && e.jenjang_id !== null && (jenjangUtama === null || e.jenjang_id < jenjangUtama))) {
            jenjangUtama = e.jenjang_id;
            jenjangUtamaJp = e.jp;
        }
    }
    const tarifUtama = await getTariffNominalService(jenjangUtama, l);

    const daysInPeriod = new Map(); // key `date|session` → {date, session_name, jp, jenjang_id} — hanya sesi yang benar-benar diabsen (guru/admin)
    for (const a of attended.rows) {
        const dow = dayNameOf(a.date);
        const key = `${dow}|${String(a.session_name || '').toUpperCase()}`;
        const candidates = schedByDowSession.get(key) || [];

        // Pilih JP terbesar di antara jadwal yang cocok (penentu jenjang & JP sesi tsb); fallback 1 JP
        let best = null;
        let bestJp = 0;
        for (const c of candidates) {
            const jpVal = Number(c.jp ?? 1);
            if (jpVal > bestJp) {
                bestJp = jpVal;
                best = c;
            }
        }
        // Jika tidak ada jadwal yang cocok (mis. sesi tanpa jadwal), ambil kandidat mana pun untuk jenjang
        if (!best && candidates.length) best = candidates[0];

        const jp = best ? Number(best.jp ?? 1) : 1;
        const jenjangId = best ? (best.jenjang_id != null ? Number(best.jenjang_id) : null) : null;

        daysInPeriod.set(`${a.date}|${a.session_name}`, {
            date: a.date,
            session_name: a.session_name,
            jp,
            hours: jp,
            jenjang_id: jenjangId
        });
    }

    // Tidak ada kompensasi all-present: guru wajib absen tiap sesi/diabsenkan admin.
    // Hanya sesi di `attendances` yang dihitung.

    // 3. Agregasi JP per jenjang + resolve tarif (JP integer)
    const breakdown = new Map(); // jenjang_id → { jam, nominal }
    for (const s of daysInPeriod.values()) {
        const key = s.jenjang_id === null ? 'null' : s.jenjang_id;
        if (!breakdown.has(key)) breakdown.set(key, { jam: 0, jenjang_id: s.jenjang_id });
        breakdown.get(key).jam += Number(s.jp ?? s.hours ?? 1);
    }

    const jenjangNames = await db.execute({ sql: 'SELECT id, nama_jenjang FROM jenjang' });
    const namaMap = new Map(jenjangNames.rows.map((r) => [Number(r.id), r.nama_jenjang]));

    const breakdownList = [];
    let subtotalMengajar = 0;
    let totalJam = 0;
    for (const b of breakdown.values()) {
        const nominal = await getTariffNominalService(b.jenjang_id, l);
        const subtotal = Math.round(b.jam * (nominal || 0) * 100) / 100;
        breakdownList.push({
            jenjang_id: b.jenjang_id,
            nama_jenjang: b.jenjang_id === null ? 'Tanpa Jadwal' : (namaMap.get(b.jenjang_id) || `Jenjang ${b.jenjang_id}`),
            jam: Number(b.jam),
            jp: Number(b.jam),
            tarif: nominal,
            subtotal
        });
        totalJam += Number(b.jam);
        subtotalMengajar += subtotal;
    }

    // 4. Prefill tunjangan dari slip bulan sebelumnya (input manual yang bisa dipakai lagi)
    const prevPeriod = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
    let tunjanganPrefill = 0;
    let tunjanganDetailPrefill = null;
    const prevSlip = await db.execute({
        sql: 'SELECT tunjangan, tunjangan_detail FROM teacher_salaries WHERE teacher_id = ? AND period = ? LIMIT 1',
        args: [tid, prevPeriod]
    });
    if (prevSlip.rows.length) {
        tunjanganDetailPrefill = safeJson(prevSlip.rows[0].tunjangan_detail);
        tunjanganPrefill = tunjanganDetailPrefill
            ? sumAllowances(tunjanganDetailPrefill)
            : Number(prevSlip.rows[0].tunjangan || 0);
    }

    const jamMengajar = Number(totalJam);
    subtotalMengajar = Math.round(subtotalMengajar * 100) / 100;

    // Info guru
    const teacher = await db.execute({
        sql: 'SELECT id, name, lembaga FROM teachers WHERE id = ?',
        args: [tid]
    });
    const tRow = teacher.rows[0];
    if (!tRow) throw new Error('Guru tidak ditemukan');

    // Slip sudah ada?
    const existing = await db.execute({
        sql: 'SELECT id, status, paid_at, tunjangan, tunjangan_detail FROM teacher_salaries WHERE teacher_id = ? AND period = ?',
        args: [tid, period]
    });

    let existingTunjangan = tunjanganPrefill;
    let existingDetail = tunjanganDetailPrefill;
    if (existing.rows.length) {
        existingDetail = safeJson(existing.rows[0].tunjangan_detail);
        existingTunjangan = existingDetail
            ? sumAllowances(existingDetail)
            : Number(existing.rows[0].tunjangan || 0);
    }

    return {
        teacher_id: tid,
        teacher_name: tRow.name,
        teacher_lembaga: toUpper(tRow.lembaga),
        period,
        tanggal_mulai: rangeStart,
        tanggal_selesai: rangeEnd,
        total_sessions: daysInPeriod.size,
        jam_mengajar: jamMengajar,
        breakdown: breakdownList,
        subtotal_mengajar: subtotalMengajar,
        jenjang_utama: jenjangUtama,
        jenjang_utama_nama: jenjangUtama === null ? null : (namaMap.get(jenjangUtama) || `Jenjang ${jenjangUtama}`),
        tarif_utama: tarifUtama,
        tunjangan: existingTunjangan,
        tunjangan_detail: existingDetail,
        total: Math.round((subtotalMengajar + existingTunjangan) * 100) / 100,
        sudah_dibuat: existing.rows.length > 0,
        slip_id: existing.rows.length ? existing.rows[0].id : null,
        slip_status: existing.rows.length ? toUpper(existing.rows[0].status) : null,
        slip_paid_at: existing.rows.length ? existing.rows[0].paid_at : null
    };
};

// Hitung untuk semua guru dalam scope
export const computeAllTeachersSalaryService = async ({ period, tanggal_mulai, tanggal_selesai }, userLembaga = LEMBAGA.ALL) => {
    const teachers = await getTeachersListService(userLembaga);
    const results = [];
    for (const t of teachers) {
        try {
            results.push(await computeTeacherSalaryService({ teacherId: t.id, period, tanggal_mulai, tanggal_selesai }, userLembaga));
        } catch (e) {
            results.push({ teacher_id: t.id, teacher_name: t.name, error: e.message });
        }
    }
    return results;
};

// Riwayat gaji guru sendiri (self-service portal)
export const getMySalarySlipsService = async (teacherId, { period } = {}) => {
    const conditions = ['ts.teacher_id = ?'];
    const args = [Number(teacherId)];

    if (period && String(period).trim()) {
        conditions.push('ts.period = ?');
        args.push(String(period).trim());
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const result = await db.execute({
        sql: `
            SELECT ts.id, ts.period, ts.jam_mengajar, ts.subtotal_mengajar,
                   ts.tunjangan, ts.tunjangan_detail, ts.total, ts.status,
                   ts.paid_at, ts.detail, ts.notes, ts.created_at, ts.updated_at
            FROM teacher_salaries ts
            ${whereClause}
            ORDER BY ts.period DESC, ts.id DESC
        `,
        args
    });

    return result.rows.map((r) => ({
        ...r,
        tunjangan_detail: safeJson(r.tunjangan_detail),
        detail: safeJson(r.detail)
    }));
};

// List slip gaji (filter periode, terscope lembaga)
export const getSalarySlipsService = async ({ period }, userLembaga = LEMBAGA.ALL) => {
    const l = toUpper(userLembaga);
    const conditions = [];
    const args = [];

    if (period && String(period).trim()) {
        parsePeriod(period);
        conditions.push('ts.period = ?');
        args.push(String(period).trim());
    }
    if (l !== LEMBAGA.ALL) {
        conditions.push('LOWER(ts.lembaga) IN (LOWER(?), LOWER(?))');
        args.push(l, LEMBAGA.ALL);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await db.execute({
        sql: `
            SELECT ts.id, ts.teacher_id, t.name AS teacher_name, t.lembaga AS teacher_lembaga,
                   ts.period, ts.jam_mengajar, ts.subtotal_mengajar, ts.tunjangan,
                   ts.tunjangan_detail, ts.total, ts.status, ts.paid_at, ts.detail, ts.notes, ts.lembaga,
                   ts.created_at, ts.updated_at
            FROM teacher_salaries ts
            LEFT JOIN teachers t ON t.id = ts.teacher_id
            ${whereClause}
            ORDER BY ts.period DESC, ts.created_at DESC, ts.id DESC
        `,
        args
    });

    return result.rows.map((r) => ({
        ...r,
        detail: safeJson(r.detail),
        tunjangan_detail: safeJson(r.tunjangan_detail)
    }));
};

// Simpan slip (create/update per guru+periode) — hasil compute + tunjangan manual + override JP editable
// Tunjangan bisa dikirim sebagai daftar item {nama, nominal}[] via `tunjangan_detail`
// (total `tunjangan` = jumlah otomatis) atau sebagai angka tunggal `tunjangan` (kompatibel).
// Jika `jam_mengajar` (JP integer) dikirim, pakai nilai override admin (editable di tabel hasil).
export const saveSalarySlipService = async ({ period, teacher_id, jam_mengajar, breakdown, tunjangan, tunjangan_detail, subtotal_mengajar, notes, status, paid_at }, userLembaga = LEMBAGA.ALL) => {
    parsePeriod(period);
    const tid = Number(teacher_id);
    if (!Number.isInteger(tid) || tid <= 0) throw new Error('ID guru wajib diisi');

    // Hitung ulang dari absensi (otoritatif) — JP integer per sesi absen
    const computed = await computeTeacherSalaryService({ teacherId: tid, period }, userLembaga);

    // Override JP editable: admin bisa menyesuaikan bila ada perubahan (integer 0-999)
    let jamMengajarFinal = computed.jam_mengajar;
    let breakdownFinal = computed.breakdown;
    let subtotalMengajarFinal = computed.subtotal_mengajar;
    let totalSessionsFinal = computed.total_sessions;
    if (jam_mengajar !== undefined && jam_mengajar !== null && jam_mengajar !== '') {
        const jpOverride = Number(jam_mengajar);
        if (!Number.isInteger(jpOverride) || jpOverride < 0 || jpOverride > 999) throw new Error('Jumlah JP harus integer 0-999');
        jamMengajarFinal = jpOverride;
        // Jika breakdown override juga dikirim, pakai itu untuk subtotal per jenjang
        if (Array.isArray(breakdown) && breakdown.length) {
            const normalized = [];
            let sumJp = 0;
            let sumSub = 0;
            for (const b of breakdown) {
                const jid = b.jenjang_id === null || b.jenjang_id === undefined ? null : Number(b.jenjang_id);
                const jpVal = Number(b.jam ?? b.jp ?? 0);
                if (!Number.isInteger(jpVal) || jpVal < 0) throw new Error('JP per jenjang harus integer 0-999');
                const tarif = await getTariffNominalService(jid, userLembaga);
                const sub = Math.round(jpVal * (tarif || 0) * 100) / 100;
                normalized.push({ jenjang_id: jid, nama_jenjang: b.nama_jenjang || (jid===null?'Tanpa Jadwal':`Jenjang ${jid}`), jam: jpVal, jp: jpVal, tarif, subtotal: sub });
                sumJp += jpVal;
                sumSub += sub;
            }
            breakdownFinal = normalized;
            // Jika total breakdown tidak sama dengan jam override, sesuaikan subtotal proporsional atau pakai sum breakdown
            if (sumJp !== jamMengajarFinal) {
                // Prioritaskan breakdown sum jika ada, timpa jamMengajarFinal
                jamMengajarFinal = sumJp;
            }
            subtotalMengajarFinal = Math.round(sumSub * 100) / 100;
            totalSessionsFinal = breakdownFinal.length ? totalSessionsFinal : 0;
        } else {
            // Tanpa breakdown, subtotal proporsional dari breakdown (scale jam per jenjang × tarif)
            if (computed.jam_mengajar > 0) {
                const ratio = jamMengajarFinal / computed.jam_mengajar;
                // Breakdown diskalakan proporsional — subtotal per jenjang dihitung dari tarif asli
                // (bukan dari computed.subtotal_mengajar yang bisa 0 bila tarif belum di-set)
                breakdownFinal = computed.breakdown.map(b => {
                    const scaledJp = Math.round(b.jam * ratio);
                    return { ...b, jam: scaledJp, jp: scaledJp, subtotal: Math.round(scaledJp * (b.tarif || 0) * 100) / 100 };
                });
                // Koreksi rounding sisa
                const sumScaled = breakdownFinal.reduce((s, b) => s + b.jam, 0);
                if (sumScaled !== jamMengajarFinal && breakdownFinal.length) {
                    breakdownFinal[0].jam += (jamMengajarFinal - sumScaled);
                    breakdownFinal[0].jp = breakdownFinal[0].jam;
                    breakdownFinal[0].subtotal = Math.round(breakdownFinal[0].jam * (breakdownFinal[0].tarif || 0) * 100) / 100;
                }
                subtotalMengajarFinal = Math.round(breakdownFinal.reduce((s, b) => s + b.subtotal, 0) * 100) / 100;
            } else {
                // Tidak ada data absensi → subtotal otomatis: jam override × tarif utama guru
                // (resolve spesifik → ALL). tarif_utama null/0 → 0 (admin bisa override via subtotal_mengajar).
                subtotalMengajarFinal = Math.round(jamMengajarFinal * (computed.tarif_utama || 0) * 100) / 100;
                breakdownFinal = computed.tarif_utama
                    ? [{
                        jenjang_id: computed.jenjang_utama ?? null,
                        nama_jenjang: computed.jenjang_utama_nama || 'Tarif Utama',
                        jam: jamMengajarFinal,
                        jp: jamMengajarFinal,
                        tarif: computed.tarif_utama,
                        subtotal: subtotalMengajarFinal
                    }]
                    : [];
            }
        }
    }

    // Override subtotal eksplisit dari admin (kolom subtotal editable) — dipakai saat tanpa
    // breakdown/tarif sehingga hitung otomatis menghasilkan 0. Prioritas hanya bila breakdown tidak dikirim.
    if (subtotal_mengajar !== undefined && subtotal_mengajar !== null && subtotal_mengajar !== '' && !(Array.isArray(breakdown) && breakdown.length)) {
        const subOverride = Number(subtotal_mengajar);
        if (!Number.isFinite(subOverride) || subOverride < 0) throw new Error('Subtotal mengajar harus angka >= 0');
        subtotalMengajarFinal = Math.round(subOverride * 100) / 100;
    }

    let tunjanganDetailFinal = normalizeAllowances(tunjangan_detail);
    let tunjanganFinal;
    if (tunjanganDetailFinal) {
        tunjanganFinal = Math.round(sumAllowances(tunjanganDetailFinal) * 100) / 100;
    } else if (Number.isFinite(Number(tunjangan)) && Number(tunjangan) > 0) {
        tunjanganFinal = Math.round(Number(tunjangan) * 100) / 100;
        tunjanganDetailFinal = [{ nama: 'Tunjangan', nominal: tunjanganFinal }];
    } else {
        tunjanganFinal = 0;
    }
    const totalFinal = Math.round((subtotalMengajarFinal + tunjanganFinal) * 100) / 100;
    const statusFinal = (status || 'DRAFT').toUpperCase();
    const paidAtFinal = statusFinal === 'DIBAYAR' ? (paid_at || new Date().toISOString().split('T')[0]) : null;

    const detail = JSON.stringify({
        total_sessions: totalSessionsFinal,
        breakdown: breakdownFinal
    });
    const tunjanganDetailJson = tunjanganDetailFinal ? JSON.stringify(tunjanganDetailFinal) : null;

    const l = toUpper(userLembaga);
    let lembagaSlip = toUpper(computed.teacher_lembaga);
    if (lembagaSlip === LEMBAGA.ALL) lembagaSlip = l; // guru shared mengikuti lembaga pengelola

    await withBusyRetry(() => db.execute({
        sql: `
            INSERT INTO teacher_salaries
                (teacher_id, period, jam_mengajar, subtotal_mengajar, tunjangan, tunjangan_detail, total, status, paid_at, detail, notes, lembaga, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                jam_mengajar = VALUES(jam_mengajar),
                subtotal_mengajar = VALUES(subtotal_mengajar),
                tunjangan = VALUES(tunjangan),
                tunjangan_detail = VALUES(tunjangan_detail),
                total = VALUES(total),
                status = VALUES(status),
                paid_at = VALUES(paid_at),
                detail = VALUES(detail),
                notes = VALUES(notes),
                lembaga = VALUES(lembaga),
                updated_at = NOW()
        `,
        args: [
            tid, period,
            jamMengajarFinal, subtotalMengajarFinal,
            tunjanganFinal, tunjanganDetailJson, totalFinal, statusFinal, paidAtFinal,
            detail, notes || null, lembagaSlip
        ]
    }));

    return { teacher_id: tid, period, jam_mengajar: jamMengajarFinal, subtotal_mengajar: subtotalMengajarFinal, tunjangan: tunjanganFinal, tunjangan_detail: tunjanganDetailFinal, total: totalFinal, status: statusFinal };
};

// Ubah slip (tunjangan_detail/tunjangan/notes/status/paid_at/jam_mengajar/breakdown) — jam & subtotal bisa override editable
export const updateSalarySlipService = async (id, { jam_mengajar, breakdown, tunjangan, tunjangan_detail, subtotal_mengajar, notes, status, paid_at }, userLembaga = LEMBAGA.ALL) => {
    const slipId = Number(id);
    if (!Number.isInteger(slipId) || slipId <= 0) throw new Error('ID slip tidak valid');

    const slip = await db.execute({ sql: 'SELECT teacher_id, period, notes, tunjangan_detail, jam_mengajar, subtotal_mengajar, detail FROM teacher_salaries WHERE id = ?', args: [slipId] });
    if (!slip.rows.length) return false;

    const computed = await computeTeacherSalaryService(
        { teacherId: slip.rows[0].teacher_id, period: slip.rows[0].period },
        userLembaga
    );

    const hasDetailParam = tunjangan_detail !== undefined;
    let tunjanganDetailFinal = hasDetailParam
        ? normalizeAllowances(tunjangan_detail)
        : (safeJson(slip.rows[0].tunjangan_detail) || null);

    let tunjanganFinal;
    if (tunjanganDetailFinal) {
        tunjanganFinal = Math.round(sumAllowances(tunjanganDetailFinal) * 100) / 100;
    } else if (!hasDetailParam && Number.isFinite(Number(tunjangan))) {
        tunjanganFinal = Math.round(Number(tunjangan) * 100) / 100;
        if (tunjanganFinal > 0) tunjanganDetailFinal = [{ nama: 'Tunjangan', nominal: tunjanganFinal }];
    } else if (hasDetailParam) {
        tunjanganFinal = 0; // daftar tunjangan dikirim kosong → hapus tunjangan
    } else {
        tunjanganFinal = computed.tunjangan;
    }

    // Override JP editable jika dikirim (integer 0-999); subtotal menyesuaikan
    let jamMengajarFinal = computed.jam_mengajar;
    let subtotalMengajarFinal = computed.subtotal_mengajar;
    let breakdownFinal = computed.breakdown;
    let totalSessionsFinal = computed.total_sessions;
    const hasJamParam = jam_mengajar !== undefined && jam_mengajar !== null && jam_mengajar !== '';
    const hasBreakdownParam = breakdown !== undefined;
    if (hasJamParam || hasBreakdownParam) {
        if (hasBreakdownParam && Array.isArray(breakdown) && breakdown.length) {
            const normalized = [];
            let sumJp = 0; let sumSub = 0;
            for (const b of breakdown) {
                const jid = b.jenjang_id === null || b.jenjang_id === undefined ? null : Number(b.jenjang_id);
                const jpVal = Number(b.jam ?? b.jp ?? 0);
                if (!Number.isInteger(jpVal) || jpVal < 0 || jpVal > 999) throw new Error('JP per jenjang harus integer 0-999');
                const tarif = await getTariffNominalService(jid, userLembaga);
                const sub = Math.round(jpVal * (tarif || 0) * 100) / 100;
                normalized.push({ jenjang_id: jid, nama_jenjang: b.nama_jenjang || (jid===null?'Tanpa Jadwal':`Jenjang ${jid}`), jam: jpVal, jp: jpVal, tarif, subtotal: sub });
                sumJp += jpVal; sumSub += sub;
            }
            breakdownFinal = normalized;
            jamMengajarFinal = sumJp;
            subtotalMengajarFinal = Math.round(sumSub * 100) / 100;
            totalSessionsFinal = normalized.length ? totalSessionsFinal : 0;
        } else if (hasJamParam) {
            const jpOverride = Number(jam_mengajar);
            if (!Number.isInteger(jpOverride) || jpOverride < 0 || jpOverride > 999) throw new Error('Jumlah JP harus integer 0-999');
            jamMengajarFinal = jpOverride;
            if (computed.jam_mengajar > 0) {
                const ratio = jpOverride / computed.jam_mengajar;
                // Breakdown diskalakan proporsional — subtotal per jenjang dihitung dari tarif asli
                breakdownFinal = computed.breakdown.map(b => {
                    const scaledJp = Math.round(b.jam * ratio);
                    return { ...b, jam: scaledJp, jp: scaledJp, subtotal: Math.round(scaledJp * (b.tarif || 0) * 100) / 100 };
                });
                const sumScaled = breakdownFinal.reduce((s, b) => s + b.jam, 0);
                if (sumScaled !== jpOverride && breakdownFinal.length) {
                    breakdownFinal[0].jam += (jpOverride - sumScaled);
                    breakdownFinal[0].jp = breakdownFinal[0].jam;
                    breakdownFinal[0].subtotal = Math.round(breakdownFinal[0].jam * (breakdownFinal[0].tarif || 0) * 100) / 100;
                }
                subtotalMengajarFinal = Math.round(breakdownFinal.reduce((s, b) => s + b.subtotal, 0) * 100) / 100;
            } else {
                // Tidak ada data absensi → subtotal otomatis: jam override × tarif utama guru
                // (resolve spesifik → ALL). tarif_utama null/0 → 0 (admin bisa override via subtotal_mengajar).
                subtotalMengajarFinal = Math.round(jamMengajarFinal * (computed.tarif_utama || 0) * 100) / 100;
                breakdownFinal = computed.tarif_utama
                    ? [{
                        jenjang_id: computed.jenjang_utama ?? null,
                        nama_jenjang: computed.jenjang_utama_nama || 'Tarif Utama',
                        jam: jamMengajarFinal,
                        jp: jamMengajarFinal,
                        tarif: computed.tarif_utama,
                        subtotal: subtotalMengajarFinal
                    }]
                    : [];
            }
        }
    }

    // Override subtotal eksplisit dari admin (kolom subtotal editable) — prioritas hanya bila breakdown tidak dikirim
    if (subtotal_mengajar !== undefined && subtotal_mengajar !== null && subtotal_mengajar !== '' && !(hasBreakdownParam && Array.isArray(breakdown) && breakdown.length)) {
        const subOverride = Number(subtotal_mengajar);
        if (!Number.isFinite(subOverride) || subOverride < 0) throw new Error('Subtotal mengajar harus angka >= 0');
        subtotalMengajarFinal = Math.round(subOverride * 100) / 100;
    }

    const totalFinal = Math.round((subtotalMengajarFinal + tunjanganFinal) * 100) / 100;
    const statusFinal = (status || 'DRAFT').toUpperCase();
    const paidAtFinal = statusFinal === 'DIBAYAR' ? (paid_at || new Date().toISOString().split('T')[0]) : null;
    const notesFinal = notes !== undefined && notes !== null ? notes : (slip.rows[0].notes || null);

    const detail = JSON.stringify({
        total_sessions: totalSessionsFinal,
        breakdown: breakdownFinal
    });
    const tunjanganDetailJson = tunjanganDetailFinal ? JSON.stringify(tunjanganDetailFinal) : null;

    const l = toUpper(userLembaga);
    const whereClause = l === LEMBAGA.ALL ? 'id = ?' : 'id = ? AND LOWER(lembaga) IN (LOWER(?), LOWER(?))';
    const args = l === LEMBAGA.ALL
        ? [jamMengajarFinal, subtotalMengajarFinal, tunjanganFinal, tunjanganDetailJson, totalFinal, statusFinal, paidAtFinal, detail, notesFinal, slipId]
        : [jamMengajarFinal, subtotalMengajarFinal, tunjanganFinal, tunjanganDetailJson, totalFinal, statusFinal, paidAtFinal, detail, notesFinal, slipId, l, LEMBAGA.ALL];

    const result = await withBusyRetry(() => db.execute({
        sql: `
            UPDATE teacher_salaries SET
                jam_mengajar = ?, subtotal_mengajar = ?, tunjangan = ?, tunjangan_detail = ?, total = ?,
                status = ?, paid_at = ?, detail = ?, notes = ?,
                updated_at = NOW()
            WHERE ${whereClause}
        `,
        args
    }));

    return result.rowsAffected > 0;
};

// Hapus slip (terscope lembaga)
export const deleteSalarySlipService = async (id, userLembaga = LEMBAGA.ALL) => {
    const slipId = Number(id);
    if (!Number.isInteger(slipId) || slipId <= 0) throw new Error('ID slip tidak valid');

    const l = toUpper(userLembaga);
    const whereClause = l === LEMBAGA.ALL ? 'id = ?' : 'id = ? AND LOWER(lembaga) IN (LOWER(?), LOWER(?))';
    const args = l === LEMBAGA.ALL ? [slipId] : [slipId, l, LEMBAGA.ALL];

    const result = await withBusyRetry(() => db.execute({
        sql: `DELETE FROM teacher_salaries WHERE ${whereClause}`,
        args
    }));
    return result.rowsAffected > 0;
};
