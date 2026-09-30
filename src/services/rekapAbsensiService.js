import db from '../config/db.js';
import { getSumber } from '../utils/lembagaHelper.js';
import { resolveDateRange, nextDayISO } from '../utils/dateRangeHelper.js';

// Ambil lembaga & sumber tabel (madrasah/tpq)
const getContext = (lembaga) => {
    const s = getSumber(lembaga);
    return {
        lembaga: s.lembaga,
        isAll: s.isAll,
        isTpq: s.isTpq,
        sumber: s.sumber
    };
};

const STATUSES = ['HADIR', 'SAKIT', 'IZIN', 'ALPA'];

const DAY_NAMES = ['AHAD', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'];

// Tanggal hari ini dalam zona waktu lokal (padan todayISO() frontend — bukan UTC, agar
// frontend yang mengirim tanggal lokal hijri→masehi tetap sinkron saat rentang menabrak hari ini).
const todayLocalISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Nama hari dari string tanggal YYYY-MM-DD (aritmetika UTC murni, konsisten pola izinGuruService)
const dayNameOf = (s) => {
    const [y, m, d] = String(s).split('-').map(Number);
    return DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
};

// Hitung berapa kali tiap nama hari muncul dalam rentang [start, end] (untuk ekspektasi sesi KBM).
// Bila capToToday (rentang menabrak hari ini), hanya menghitung hari <= hari ini agar sesi yang belum terjadi tidak ikut.
const countDowInRange = (start, end, capToToday = false) => {
    const counts = { AHAD: 0, SENIN: 0, SELASA: 0, RABU: 0, KAMIS: 0, JUMAT: 0, SABTU: 0 };
    const todayStr = todayLocalISO();
    let cur = start;
    while (cur <= end) {
        if (!(capToToday && cur > todayStr)) {
            counts[dayNameOf(cur)] += 1;
        }
        cur = nextDayISO(cur);
    }
    return counts;
};

// Rekap absensi KBM per siswa per bulan (sumber data attendances)
// Karena presensi kini hanya menyimpan murid yang TIDAK hadir, baris "hadir"
// tidak selalu ada. Maka hadir dihitung dari EKSPEKTASI SESI jadwal kelas
// (`schedules.day_of_week` × kemunculan hari dalam bulan) dikurangi
// sakit/izin/alpa tercatat. Bila kelas tidak punya jadwal, perilaku lama
// (hitung baris) dipertahankan.
export const getRekapAbsensiService = async ({ bulan, tanggal_mulai, tanggal_selesai, classroom_id, jenjang_id, rombel_id, include_detail }, lembaga = 'ALL') => {
    const ctx = getContext(lembaga);

    // Prioritaskan rentang tanggal (YYYY-MM-DD); fallback bulan (YYYY-MM) sebagai kompatibilitas.
    const range = resolveDateRange({ tanggal_mulai, tanggal_selesai });
    let rangeStart;
    let rangeEnd;
    let bulanFinal = null;
    if (range) {
        rangeStart = range.tanggal_mulai;
        rangeEnd = range.tanggal_selesai;
    } else {
        bulanFinal = bulan ? String(bulan).trim() : new Date().toISOString().slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(bulanFinal)) throw new Error('Format bulan tidak valid! Gunakan YYYY-MM');
        const [tahun, bulanNum] = bulanFinal.split('-').map(Number);
        if (tahun < 2000 || tahun > 2100 || bulanNum < 1 || bulanNum > 12) throw new Error('Bulan tidak valid! Gunakan rentang 2000-2100 dan 01-12');
        const lastDayOfMonth = new Date(tahun, bulanNum, 0).getDate();
        rangeStart = `${bulanFinal}-01`;
        rangeEnd = `${bulanFinal}-${String(lastDayOfMonth).padStart(2, '0')}`;
    }
    const todayStr = todayLocalISO();
    const capToToday = rangeStart <= todayStr && todayStr <= rangeEnd;
    const dowCounts = countDowInRange(rangeStart, rangeEnd, capToToday);

    // Hari tumpang-tindih antara rentang izin & rentang laporan (clamp >= 0)
    const jdFirst = `'${rangeStart}'`;
    const jdLast = `'${rangeEnd}'`;
    const overlapDays = (jenis) => `
        COALESCE((
            SELECT SUM(GREATEST(0, CAST(
                DATEDIFF(LEAST(iz.tanggal_selesai, ${jdLast}), GREATEST(iz.tanggal_mulai, ${jdFirst}))
                + 1 AS SIGNED)))
            FROM izin_sakit iz
            WHERE iz.student_id = s.id AND iz.status = 'DISETUJUI' AND iz.jenis = '${jenis}'
        ), 0)
    `;

    const conditions = [];
    const args = [];

    if (classroom_id) {
        const cid = Number(classroom_id);
        conditions.push(`EXISTS (SELECT 1 FROM santri_penempatan sp WHERE sp.nim = s.nim AND sp.classroom_id = ?)`);
        args.push(cid);
    }
    if (jenjang_id) {
        const jid = Number(jenjang_id);
        conditions.push(`EXISTS (SELECT 1 FROM santri_penempatan sp WHERE sp.nim = s.nim AND sp.jenjang_id = ?)`);
        args.push(jid);
    }
    if (rombel_id) {
        const rid = Number(rombel_id);
        conditions.push(`EXISTS (SELECT 1 FROM santri_penempatan sp WHERE sp.nim = s.nim AND sp.rombel_id = ?)`);
        args.push(rid);
    }
    if (!ctx.isAll) {
        conditions.push('s.lembaga = ?');
        args.push(ctx.lembaga);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // ── Jadwal → ekspektasi sesi per kelas dalam bulan ──
    const whereLembaga = ctx.isAll ? '' : 'AND lembaga IN (?, ?)';
    const schedArgs = ctx.isAll ? [] : [ctx.lembaga, 'ALL'];
    const schedRes = await db.execute({
        sql: `SELECT classroom_id, day_of_week, session_name FROM schedules WHERE classroom_id IS NOT NULL ${whereLembaga}`,
        args: schedArgs
    });
    const expectedByClass = new Map(); // classroom_id → jumlah sesi diharapkan bulan ini
    const seenDowSession = new Set();
    for (const r of schedRes.rows) {
        const cid = Number(r.classroom_id);
        const dow = String(r.day_of_week || '').toUpperCase();
        const sesi = String(r.session_name || '').toUpperCase();
        const key = `${cid}|${dow}|${sesi}`;
        if (seenDowSession.has(key)) continue;
        seenDowSession.add(key);
        expectedByClass.set(cid, (expectedByClass.get(cid) || 0) + (dowCounts[dow] || 0));
    }

    // ── Jumlah murid AKTIF per kelas (santri_penempatan) ──
    const sumberFilter = ctx.isAll ? '' : `AND sumber = '${ctx.sumber}'`;
    const classRes = await db.execute({
        sql: `SELECT classroom_id, COUNT(*) AS n FROM santri_penempatan WHERE status = 1 ${sumberFilter} GROUP BY classroom_id`,
        args: []
    });
    const muridPerKelas = new Map(classRes.rows.map((r) => [Number(r.classroom_id), Number(r.n)]));

    const query = `
        SELECT s.id AS student_id, s.nim, s.name AS student_name,
               (SELECT c.class_name FROM santri_penempatan sp JOIN classes c ON sp.classroom_id = c.id AND c.sumber = sp.sumber WHERE sp.nim = s.nim LIMIT 1) AS class_name,
               (SELECT sp.classroom_id FROM santri_penempatan sp WHERE sp.nim = s.nim LIMIT 1) AS classroom_id,
               COALESCE(SUM(CASE WHEN a.status = 'HADIR' THEN 1 ELSE 0 END), 0) AS hadir,
               COALESCE(SUM(CASE WHEN a.status = 'SAKIT' THEN 1 ELSE 0 END), 0) AS sakit,
               COALESCE(SUM(CASE WHEN a.status = 'IZIN' THEN 1 ELSE 0 END), 0) AS izin,
               COALESCE(SUM(CASE WHEN a.status = 'ALPA' THEN 1 ELSE 0 END), 0) AS alpa,
               COUNT(a.id) AS total,
               ${overlapDays('IZIN')} AS izin_extra,
               ${overlapDays('SAKIT')} AS sakit_extra
        FROM students s
        LEFT JOIN attendances a ON a.student_id = s.id AND a.date >= ? AND a.date <= ?
        ${whereClause}
        GROUP BY s.id, s.nim, s.name
        ORDER BY class_name ASC, s.nim ASC
    `;
    args.unshift(rangeStart, rangeEnd);

    const result = await db.execute({ sql: query, args });
    const rows = result.rows.map((r) => {
        const hadirRaw = Number(r.hadir) || 0;
        const rawTotal = Number(r.total) || 0;
        const sakit = Number(r.sakit) || 0;
        const izin = Number(r.izin) || 0;
        const alpa = Number(r.alpa) || 0;
        // Tambah hari izin/sakit dari catatan izin_sakit DISETUJUI (terintegrasi A.3)
        const sakitFinal = sakit + (Number(r.sakit_extra) || 0);
        const izinFinal = izin + (Number(r.izin_extra) || 0);

        const cid = r.classroom_id != null ? Number(r.classroom_id) : null;
        const jumlahMurid = cid != null ? (muridPerKelas.get(cid) || 0) : 0;
        const expected = cid != null ? (expectedByClass.get(cid) || 0) : 0;

        let hadir;
        let total;
        let hadirPct;
        if (expected > 0) {
            total = expected;
            hadir = Math.max(0, expected - (sakitFinal + izinFinal + alpa));
            hadirPct = total > 0 ? Math.round((hadir / total) * 10000) / 100 : null;
        } else {
            total = rawTotal;
            hadir = hadirRaw;
            hadirPct = total > 0 ? Math.round((hadir / total) * 10000) / 100 : null;
        }

        return {
            student_id: r.student_id,
            nim: r.nim,
            student_name: r.student_name,
            class_name: r.class_name || null,
            classroom_id: cid,
            jumlah_murid: jumlahMurid,
            hadir,
            sakit: sakitFinal,
            izin: izinFinal,
            alpa,
            total,
            hadir_pct: hadirPct
        };
    });

    // ── Detail matriks harian (dipakai ekspor Excel: tanggal memanjang ke samping) ──
    // Hanya dihitung bila include_detail=true agar rekap Laporan (RekapLaporanService)
    // yang memanggil service ini tanpa opsi tsb tidak terbebani.
    let detail;
    if (include_detail) {
        const datesInRange = [];
        let curDate = rangeStart;
        while (curDate <= rangeEnd) {
            if (!(capToToday && curDate > todayStr)) datesInRange.push(curDate);
            curDate = nextDayISO(curDate);
        }

        // Hari-hari yang kelasnya punya jadwal (day_of_week × tanggal efektif)
        const classSchedDays = new Map(); // classroom_id → Set<tanggal>
        for (const r of schedRes.rows) {
            const cid = Number(r.classroom_id);
            const dow = String(r.day_of_week || '').toUpperCase();
            for (const d of datesInRange) {
                if (dayNameOf(d) !== dow) continue;
                let set = classSchedDays.get(cid);
                if (!set) { set = new Set(); classSchedDays.set(cid, set); }
                set.add(d);
            }
        }

        // Catatan absensi per murid per tanggal (semua status → ambil terparah)
        const attRes = await db.execute({
            sql: 'SELECT student_id, date, status FROM attendances WHERE date >= ? AND date <= ?',
            args: [rangeStart, rangeEnd]
        });
        const attByStudent = new Map(); // student_id → Map<tanggal, Set<status>>
        for (const a of attRes.rows) {
            const sid = Number(a.student_id);
            let m = attByStudent.get(sid);
            if (!m) { m = new Map(); attByStudent.set(sid, m); }
            let set = m.get(a.date);
            if (!set) { set = new Set(); m.set(a.date, set); }
            set.add(String(a.status || '').toUpperCase());
        }

        // Overlay izin/sakit DISETUJUI per murid per tanggal
        const izRes = await db.execute({
            sql: `SELECT student_id, jenis, tanggal_mulai, tanggal_selesai FROM izin_sakit
                  WHERE status = 'DISETUJUI' AND tanggal_mulai <= ? AND tanggal_selesai >= ?`,
            args: [rangeEnd, rangeStart]
        });
        const izByStudent = new Map(); // student_id → Map<tanggal, 'I'|'S'>
        for (const z of izRes.rows) {
            const sid = Number(z.student_id);
            const letter = String(z.jenis || '').toUpperCase() === 'SAKIT' ? 'S' : 'I';
            let m = izByStudent.get(sid);
            if (!m) { m = new Map(); izByStudent.set(sid, m); }
            let c2 = z.tanggal_mulai;
            while (c2 <= z.tanggal_selesai) {
                if (rangeStart <= c2 && c2 <= rangeEnd && !(capToToday && c2 > todayStr)) {
                    m.set(c2, m.get(c2) === 'S' ? 'S' : letter);
                }
                c2 = nextDayISO(c2);
            }
        }

        const letterOf = (set) => {
            if (set.has('ALPA')) return 'A';
            if (set.has('SAKIT')) return 'S';
            if (set.has('IZIN')) return 'I';
            if (set.has('HADIR')) return 'H';
            return '';
        };

        detail = {
            dates: datesInRange,
            rows: rows.map((row) => {
                const schedSet = row.classroom_id != null ? classSchedDays.get(Number(row.classroom_id)) : null;
                const attMap = attByStudent.get(row.student_id);
                const izMap = izByStudent.get(row.student_id);
                const cells = {};
                for (const d of datesInRange) {
                    let letter = '';
                    if (attMap) {
                        const set = attMap.get(d);
                        if (set) letter = letterOf(set);
                    }
                    if (!letter && izMap && izMap.has(d)) letter = izMap.get(d);
                    if (!letter && schedSet && schedSet.has(d)) letter = 'H';
                    if (letter) cells[d] = letter;
                }
                return {
                    nim: row.nim,
                    student_name: row.student_name,
                    class_name: row.class_name,
                    cells
                };
            })
        };
    }

    const summary = {
        total_students: rows.length,
        total_hadir: rows.reduce((s, r) => s + r.hadir, 0),
        total_sakit: rows.reduce((s, r) => s + r.sakit, 0),
        total_izin: rows.reduce((s, r) => s + r.izin, 0),
        total_alpa: rows.reduce((s, r) => s + r.alpa, 0),
        total_absensi: rows.reduce((s, r) => s + r.total, 0)
    };
    summary.hadir_pct = summary.total_absensi > 0
        ? Math.round((summary.total_hadir / summary.total_absensi) * 10000) / 100
        : null;

    return {
        data: rows,
        summary,
        detail,
        filter: {
            tanggal_mulai: rangeStart,
            tanggal_selesai: rangeEnd,
            range_label: `${rangeStart} s/d ${rangeEnd}`,
            bulan: bulanFinal
        }
    };
};

export { STATUSES };
