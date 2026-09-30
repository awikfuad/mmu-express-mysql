import db from '../config/db.js';
import { masehiToHijri, BULAN_HIJRIYAH_NAMES } from '../utils/hijriyahHelper.js';
import { getActiveAcademicYearIdService } from './paymentSettingService.js';
import { HIJRI_BULAN_ALIASES } from './tunggakanIuranService.js';
import { verifyGoogleIdToken, findAccountByGoogleSub } from './googleAuthService.js';

const DAY_NAMES = ['AHAD', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'];

// Hari ini dalam format YYYY-MM-DD berdasar waktu LOKAL server (bukan UTC),
// agar konsisten dengan tanggal yang dilihat pengguna.
const todayLocalISO = () => {
    const d = new Date();
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
};

const DAY_NAMES_MAP = { MINGGU: 0, SENIN: 1, SELASA: 2, RABU: 3, KAMIS: 4, JUMAT: 5, SABTU: 6 };

// Resolve tanggal referensi: pakai tanggal LOKAL klien (kiosk) jika dikirim,
// jika tidak jatuh ke tanggal lokal server. Menghindari selisih hari-of-week
// antara server Vercel (UTC) vs perangkat Indonesia (UTC+7) di sekitar tengah malam.
const resolveToday = (date) => {
    const iso = (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))
        ? date
        : todayLocalISO();
    const dayName = DAY_NAMES[new Date(`${iso}T12:00:00`).getDay()];
    return { iso, dayName };
};

// ==================== LEMBAGA SCOPING (v3.35) ====================
// Kiosk dapat di-scope ke lembaga tertentu (`?lembaga=MADRASAH|TPQ|...`).
// Validasi terhadap tabel master `lembaga` (aktif); kode tak dikenal/ALL → tampil SEMUA (lama).

// Resolve scope lembaga: `{ lembaga:'ALL'|kode, sumber:'madrasah'|'tpq'|'', nama }`.
const resolveLembagaScope = async (kode) => {
    if (!kode || String(kode).toUpperCase() === 'ALL') {
        return { lembaga: 'ALL', sumber: '', nama: 'Semua Lembaga' };
    }
    const result = await db.execute({
        sql: 'SELECT kode, sumber, nama, aktif FROM lembaga WHERE UPPER(kode) = ?',
        args: [String(kode).toUpperCase()]
    });
    const r = result.rows[0];
    if (!r || Number(r.aktif) !== 1) {
        return { lembaga: 'ALL', sumber: '', nama: 'Semua Lembaga' };
    }
    return { lembaga: r.kode, sumber: r.sumber ? String(r.sumber).toLowerCase() : '', nama: r.nama };
};

// Clause filter kolom `lembaga` (lembaga sendiri + ALL) utk scope selain ALL.
const lembagaClause = (scope, tableAlias, col = 'lembaga') => {
    if (!scope || scope.lembaga === 'ALL') return { sql: '', args: [] };
    return { sql: ` AND (${tableAlias}.${col} = ? OR ${tableAlias}.${col} = 'ALL')`, args: [scope.lembaga] };
};

// Clause filter kolom `sumber` (madrasah/tpq) — hanya bila scope punya sumber terpetakan.
const sumberClause = (scope, tableAlias) => {
    if (!scope || !scope.sumber) return { sql: '', args: [] };
    return { sql: ` AND ${tableAlias}.sumber = ?`, args: [scope.sumber] };
};

// Info sekolah — data publik per lembaga: nama, alamat, telepon, email, logo.
// Pakai baris lembaga tsb bila ada, fallback ke baris global 'ALL'.
const getSekolah = async (lembaga = 'ALL') => {
    const pick = async (l) => {
        const result = await db.execute({ sql: 'SELECT nama_sekolah, alamat, telepon, email, website, logo_path, footer_text FROM sekolah_settings WHERE lembaga = ? LIMIT 1', args: [l] });
        return result.rows[0] || null;
    };
    let r = await pick(lembaga);
    if (!r && lembaga !== 'ALL') r = await pick('ALL');
    r = r || {};
    return {
        nama_sekolah: r.nama_sekolah || 'MMU A-44',
        alamat: r.alamat || '',
        telepon: r.telepon || '',
        email: r.email || '',
        website: r.website || '',
        logo_path: r.logo_path || null,
        footer_text: r.footer_text || ''
    };
};

// Tanggal hari ini: Masehi + nama hari + Hijriyah
const getTanggal = ({ iso, dayName }) => {
    const hijri = masehiToHijri(iso);
    return {
        iso,
        hariIni: dayName,
        masehi: iso,
        hijriah: hijri ? hijri.full : null
    };
};

// Pengumuman published yang sedang tayang (lembaga sendiri + ALL). Publik — terscope lembaga.
const getPengumuman = async (iso, scope, limit = 5) => {
    const today = iso;
    const lc = lembagaClause(scope, 'p');
    const result = await db.execute({
        sql: `SELECT p.id, p.judul, p.isi, p.kategori, p.tanggal_publish, p.lembaga
              FROM pengumuman p
              WHERE p.is_published = 1
                AND p.tanggal_mulai <= ?
                AND (p.tanggal_selesai IS NULL OR p.tanggal_selesai >= ?)
                ${lc.sql}
              ORDER BY COALESCE(p.tanggal_publish, p.created_at) DESC, p.id DESC
              LIMIT ?`,
        args: [today, today, ...lc.args, Number(limit) > 0 ? Number(limit) : 5]
    });
    return result.rows.map((r) => ({
        id: r.id,
        judul: r.judul,
        isi: r.isi,
        kategori: r.kategori,
        tanggal_publish: r.tanggal_publish
    }));
};

// Agenda mendatang: kegiatan istighosah (target MURID/SEMUA) + kalender akademik — terscope lembaga
const getAgenda = async (iso, scope, limit = 8) => {
    const today = iso;
    const lcK = lembagaClause(scope, 'k');
    const lcKal = lembagaClause(scope, 'kal');
    const [kegiatan, kalender] = await Promise.all([
        db.execute({
            sql: `SELECT k.activity_name, k.activity_date, k.description
                  FROM kegiatan k
                  WHERE k.activity_date >= ?
                    AND (k.target IS NULL OR k.target IN ('MURID', 'SEMUA'))
                    ${lcK.sql}
                  ORDER BY k.activity_date ASC
                  LIMIT ?`,
            args: [today, ...lcK.args, limit]
        }),
        db.execute({
            sql: `SELECT kal.judul, kal.kategori, kal.tanggal_mulai, kal.tanggal_selesai, kal.keterangan
                  FROM kalender_pendidikan kal
                  WHERE kal.tanggal_selesai >= ?
                    ${lcKal.sql}
                  ORDER BY kal.tanggal_mulai ASC
                  LIMIT ?`,
            args: [today, ...lcKal.args, limit]
        })
    ]);

    const kegiatanAgenda = kegiatan.rows.map((r) => ({
        jenis: 'Kegiatan',
        judul: r.activity_name,
        tanggal: r.activity_date,
        keterangan: r.description || ''
    }));
    const kalenderAgenda = kalender.rows.map((r) => ({
        jenis: r.kategori || 'Kegiatan',
        judul: r.judul,
        tanggal: r.tanggal_mulai,
        keterangan: r.keterangan || ''
    }));

    return [...kegiatanAgenda, ...kalenderAgenda]
        .sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal)))
        .slice(0, limit);
};

// Statistik ringan NON-finansial — terscope lembaga (sumber utk santri/kelas/rombel,
// kolom lembaga utk guru/kegiatan). Publik agregat.
const getStatistik = async (scope = { lembaga: 'ALL', sumber: '' }) => {
    const sSumber = sumberClause(scope, 'sp');
    const sGuru = lembagaClause(scope, 't');
    const sKelas = sumberClause(scope, 'c');
    const sRombel = sumberClause(scope, 'r');
    const sKeg = lembagaClause(scope, 'k');
    const [santri, guru, kelas, rombel, kegiatan] = await Promise.all([
        db.execute({ sql: `SELECT COUNT(*) AS c FROM santri_penempatan sp WHERE 1=1${sSumber.sql}`, args: sSumber.args }),
        db.execute({ sql: `SELECT COUNT(*) AS c FROM teachers t WHERE 1=1${sGuru.sql}`, args: sGuru.args }),
        db.execute({ sql: `SELECT COUNT(*) AS c FROM classes c WHERE 1=1${sKelas.sql}`, args: sKelas.args }),
        db.execute({ sql: `SELECT COUNT(*) AS c FROM rombels r WHERE 1=1${sRombel.sql}`, args: sRombel.args }),
        db.execute({ sql: `SELECT COUNT(*) AS c FROM kegiatan k WHERE 1=1${sKeg.sql}`, args: sKeg.args })
    ]);
    const cnt = (r) => Number(r?.rows?.[0]?.c || 0);
    return {
        santri: cnt(santri),
        guru: cnt(guru),
        kelas: cnt(kelas),
        rombel: cnt(rombel),
        kegiatan: cnt(kegiatan)
    };
};

// Guru yang sedang izin hari ini (izin guru AKTIF menabrak tanggal sekarang) — terscope lembaga
const getGuruIzinHariIni = async (iso, scope = { lembaga: 'ALL' }) => {
    const today = iso;
    const lc = lembagaClause(scope, 'z');
    const result = await db.execute({
        sql: `SELECT z.teacher_id, z.jenis, z.status, z.tanggal_mulai, z.tanggal_selesai
              FROM izin_guru z
              WHERE z.status = 'AKTIF'
                AND z.tanggal_mulai <= ?
                AND z.tanggal_selesai >= ?
                ${lc.sql}`,
        args: [today, today, ...lc.args]
    });
    return result.rows;
};

// Jadwal hari ini (semua kelas) — field publik aman (subjek, kelas, rombel, jam, guru efektif, status izin)
const getJadwalHariIni = async ({ iso, dayName, scope }) => {
    const lc = lembagaClause(scope, 's');
    const [result, izinRows] = await Promise.all([
        db.execute({
            sql: `SELECT s.id AS schedule_id, sub.subject_name, s.day_of_week, s.start_time, s.end_time,
                         s.session_name, COALESCE(s.jp, 1) AS jp,
                         s.classroom_id, c.class_name, c.jenjang_id,
                         s.rombel_id, r.nama_rombel,
                         s.teacher_id AS main_teacher_id, t1.name AS main_teacher_name,
                         s.substitute_teacher_id, t2.name AS substitute_teacher_name,
                         CASE WHEN s.substitute_teacher_id IS NOT NULL THEN 'PIKET' ELSE 'UTAMA' END AS teaching_status
                  FROM schedules s
                  LEFT JOIN classes c ON s.classroom_id = c.id
                  LEFT JOIN rombels r ON s.rombel_id = r.id
                  INNER JOIN teachers t1 ON s.teacher_id = t1.id
                  LEFT JOIN teachers t2 ON s.substitute_teacher_id = t2.id
                  LEFT JOIN subjects sub ON s.subject_id = sub.id
                  WHERE s.day_of_week = ?
                    ${lc.sql}
                  ORDER BY s.start_time ASC, c.jenjang_id ASC, c.class_name ASC`,
            args: [dayName, ...lc.args]
        }),
        getGuruIzinHariIni(iso, scope)
    ]);

    // Map teacher_id -> izin hari ini
    const izinMap = new Map();
    for (const z of izinRows) {
        const tid = Number(z.teacher_id);
        if (!izinMap.has(tid) || String(z.jenis).toUpperCase() === 'SAKIT') {
            izinMap.set(tid, { jenis: String(z.jenis || 'IZIN').toUpperCase(), status: z.status });
        }
    }

    return result.rows.map((r) => {
        const mainId = Number(r.main_teacher_id);
        const izin = izinMap.get(mainId) || null;
        return {
            schedule_id: r.schedule_id,
            subject_name: r.subject_name || '—',
            class_name: r.class_name || '—',
            rombel_name: r.nama_rombel || null,
            session_name: r.session_name || 'PAGI',
            start_time: r.start_time,
            end_time: r.end_time,
            jp: r.jp,
            main_teacher_id: r.main_teacher_id,
            main_teacher_name: r.main_teacher_name || '—',
            substitute_teacher_name: r.substitute_teacher_name || null,
            guru: r.substitute_teacher_name || r.main_teacher_name || '—',
            status: r.teaching_status,
            main_teacher_izin: !!izin,
            izin_jenis: izin ? izin.jenis : null
        };
    });
};

// Rekap presensi hari ini per (kelas + sesi) — agregat H/S/I/A, TANPA nama murid — terscope lembaga
const getPresensiHariIni = async (iso, scope = { lembaga: 'ALL', sumber: '' }) => {
    const today = iso;
    const sc = sumberClause(scope, 'sp');
    const result = await db.execute({
        sql: `SELECT c.id AS class_id, c.class_name, a.session_name, a.status, COUNT(*) AS n
              FROM attendances a
              INNER JOIN santri_penempatan sp ON sp.student_id = a.student_id
              INNER JOIN classes c ON c.id = sp.classroom_id
              WHERE a.date = ?
                ${sc.sql}
              GROUP BY c.id, c.class_name, a.session_name, a.status`,
        args: [today, ...sc.args]
    });

    const map = new Map();
    for (const r of result.rows) {
        const key = `${r.class_id}|${r.session_name}`;
        if (!map.has(key)) {
            map.set(key, {
                class_id: r.class_id,
                class_name: r.class_name,
                session_name: r.session_name,
                H: 0, S: 0, I: 0, A: 0,
                total: 0
            });
        }
        const row = map.get(key);
        const status = String(r.status || '').toUpperCase();
        if (status === 'HADIR') row.H = Number(r.n);
        else if (status === 'SAKIT') row.S = Number(r.n);
        else if (status === 'IZIN') row.I = Number(r.n);
        else if (status === 'ALPA') row.A = Number(r.n);
        row.total += Number(r.n);
    }
    return Array.from(map.values()).sort((a, b) => a.class_name.localeCompare(b.class_name));
};

// ==================== GRAFIK (agregat publik non-finansial) ====================
// Semua data berisi agregat/hitungan — TANPA nama murid, TANPA data keuangan.

// Distribusi santri per jenjang (Sifir/Ibtidaiyah/Tsanawiyah/TPQ) — terscope lembaga
const getSantriPerJenjang = async (scope = { lembaga: 'ALL', sumber: '' }) => {
    const sc = sumberClause(scope, 'sp');
    const result = await db.execute({
        sql: `SELECT COALESCE(j.nama_jenjang, 'Tanpa Jenjang') AS jenjang_name, COUNT(*) AS n
              FROM santri_penempatan sp
              LEFT JOIN jenjang j ON sp.jenjang_id = j.id
              WHERE sp.status = 1
                ${sc.sql}
              GROUP BY sp.jenjang_id, j.nama_jenjang
              ORDER BY n DESC`,
        args: sc.args
    });
    return result.rows.map((r) => ({ label: r.jenjang_name, value: Number(r.n) }));
};

// Distribusi santri per kelas (top 8) + sisa digabung "Lainnya" — terscope lembaga
const getSantriPerKelas = async (scope = { lembaga: 'ALL', sumber: '' }) => {
    const sc = sumberClause(scope, 'sp');
    const result = await db.execute({
        sql: `SELECT COALESCE(c.class_name, 'Tanpa Kelas') AS class_name, COUNT(*) AS n
              FROM santri_penempatan sp
              LEFT JOIN classes c ON sp.classroom_id = c.id
              WHERE sp.status = 1
                ${sc.sql}
              GROUP BY sp.classroom_id, c.class_name, sp.rombel_id
              ORDER BY c.id ASC`,
        args: sc.args
    });

    return result.rows.map((r) => ({ label: r.class_name, value: Number(r.n) }));
};
// Distribusi santri per rombel — terscope lembaga
const getSantriPerRombel = async (scope = { lembaga: 'ALL', sumber: '' }) => {
    const sc = sumberClause(scope, 'sp');
    const result = await db.execute({
        sql: `SELECT COALESCE(r.nama_rombel, 'Tanpa Rombel') AS nama_rombel, COUNT(*) AS n
              FROM santri_penempatan sp
              LEFT JOIN rombels r ON sp.rombel_id = r.id
              WHERE sp.status = 1
                ${sc.sql}
              GROUP BY sp.rombel_id
              ORDER BY n DESC`,
        args: sc.args
    });
    return result.rows.map((r) => ({ label: r.nama_rombel, value: Number(r.n) }));
};

// Proporsi status presensi hari ini (H/S/I/A agregat seluruh kelas) — terscope lembaga
const getPresensiStatusGrafik = async (iso, scope = { lembaga: 'ALL', sumber: '' }) => {
    const today = iso;
    const sc = sumberClause(scope, 'sp');
    const result = await db.execute({
        sql: `SELECT UPPER(a.status) AS status, COUNT(*) AS n
              FROM attendances a
              INNER JOIN santri_penempatan sp ON sp.student_id = a.student_id
              WHERE a.date = ?
                ${sc.sql}
              GROUP BY UPPER(a.status)`,
        args: [today, ...sc.args]
    });
    const map = { HADIR: 0, SAKIT: 0, IZIN: 0, ALPA: 0 };
    for (const r of result.rows) {
        const s = String(r.status || '').toUpperCase();
        if (s in map) map[s] = Number(r.n) + map[s];
    }
    return [
        { label: 'Hadir', value: map.HADIR },
        { label: 'Sakit', value: map.SAKIT },
        { label: 'Izin', value: map.IZIN },
        { label: 'Alpa', value: map.ALPA }
    ];
};

// Jumlah sesi jadwal hari ini per mapel (seberapa sering mapel dipelajari) — terscope lembaga
const getMapelCountGrafik = async (dayName, scope = { lembaga: 'ALL' }) => {
    const lc = lembagaClause(scope, 's');
    const result = await db.execute({
        sql: `SELECT COALESCE(sub.subject_name, 'Tanpa Mapel') AS subject_name, COUNT(*) AS n
              FROM schedules s
              LEFT JOIN subjects sub ON s.subject_id = sub.id
              WHERE s.day_of_week = ?
                ${lc.sql}
              GROUP BY s.subject_id, sub.subject_name
              ORDER BY n DESC`,
        args: [dayName, ...lc.args]
    });
    return result.rows.map((r) => ({ label: r.subject_name, value: Number(r.n) }));
};

// Grafik gabungan — masing-masing aman bila gagal (null)
const getGrafikKumpulan = async ({ iso, dayName, scope }) => {
    const apply = async (fn) => {
        try { return await fn(); } catch (e) { return null; }
    };
    return {
        santri_per_jenjang: await apply(() => getSantriPerJenjang(scope)),
        santri_per_kelas: await apply(() => getSantriPerKelas(scope)),
        santri_per_rombel: await apply(() => getSantriPerRombel(scope)),
        presensi_status: await apply(() => getPresensiStatusGrafik(iso, scope)),
        mapel_count: await apply(() => getMapelCountGrafik(dayName, scope))
    };
};

// ==================== ANALISIS KUANTITATIF (agregat JUMLAH ANAK saja) ====================
// Untuk panel rotasi kiosk: jumlah anak menunggak iuran per bulan + jumlah penabung per hari,
// berikut rincian per kelas & rombel. Data hanya BERUPA HITUNGAN (bukan nominal/saldo uang,
// bukan nama murid) sehingga tetap aman ditampilkan publik.

// N (bulan) hijriyah terakhir terhitung bulan sekarang — pasangan {year, month} kronologis.
const lastHijriMonths = (n) => {
    const h = masehiToHijri(todayLocalISO());
    if (!h) return [];
    let y = h.year;
    let m = h.month;
    const out = [];
    for (let i = 0; i < n; i++) {
        out.push({ year: y, month: m });
        m -= 1;
        if (m < 1) { m = 12; y -= 1; }
    }
    return out.reverse();
};

// Label kelompok: awali dgn lembaga (MADRASAH/TPQ) agar tidak ambigu saat gabungan.
const lembagaLabel = (sumber) => (String(sumber).toUpperCase() === 'TPQ' ? 'TPQ' : 'MADRASAH');

// Roster santri aktif (status=1) berikut kelas & rombel — dipakai bersama utk semua bulan.
const getRosterKelas = async (scope = { lembaga: 'ALL', sumber: '' }) => {
    const sc = sumberClause(scope, 'sp');
    const result = await db.execute({
        sql: `SELECT sp.id, sp.sumber, sp.classroom_id, sp.rombel_id,
                     c.class_name, r.nama_rombel
              FROM santri_penempatan sp
              LEFT JOIN classes c ON c.id = sp.classroom_id AND c.sumber = sp.sumber
              LEFT JOIN rombels r ON r.id = sp.rombel_id AND r.sumber = sp.sumber
              WHERE sp.status = 1${sc.sql}`,
        args: sc.args
    });
    return result.rows;
};

// Peta nominal iuran YAUMIYAH per lembaga utk tahun ajaran aktif (fallback ALL).
const getNominalYaumiyahMap = async () => {
    const yearId = await getActiveAcademicYearIdService();
    if (!yearId) return { yearId: null, nominalByLembaga: {} };
    const result = await db.execute({
        sql: `SELECT lembaga, nominal FROM payment_settings
              WHERE academic_year_id = ? AND payment_type = 'YAUMIYAH'`,
        args: [yearId]
    });
    const nominalByLembaga = {};
    for (const r of result.rows) nominalByLembaga[String(r.lembaga || 'ALL').toUpperCase()] = Number(r.nominal) || 0;
    return { yearId, nominalByLembaga };
};

// Ringkas status pembayaran per bulan (hanya hitungan).
const ringkasTunggakan = (roster, paidMap, nominalByLembaga) => {
    const res = { lunas: 0, menunggak: 0, belum_bayar: 0, tanpa_tarif: 0 };
    for (const s of roster) {
        const nominal = nominalByLembaga[lembagaLabel(s.sumber)] ?? nominalByLembaga['ALL'] ?? null;
        if (!nominal || nominal <= 0) { res.tanpa_tarif += 1; continue; }
        const paid = paidMap.get(Number(s.id)) || 0;
        if (paid >= nominal) res.lunas += 1;
        else if (paid > 0) res.menunggak += 1;
        else res.belum_bayar += 1;
    }
    res.belum_lunas = res.menunggak + res.belum_bayar;
    return res;
};

// Jumlah anak menunggak iuran per bulan hijriyah (6 bulan terakhir) + rincian per kelas/rombel
// utk bulan berjalan. Jendela pembayaran ~200 hari membatasi kecocokan nama bulan antar tahun.
const getTunggakanAnalisis = async (scope = { lembaga: 'ALL', sumber: '' }) => {
    const { nominalByLembaga } = await getNominalYaumiyahMap();
    if (!Object.keys(nominalByLembaga).length) {
        return { nominal_ada: false, rincian_bulan: null, tren: [], per_kelas: [], per_rombel: [] };
    }
    const roster = await getRosterKelas(scope);
    const months = lastHijriMonths(6);

    const paidMaps = [];
    for (const m of months) {
        const bulanName = BULAN_HIJRIYAH_NAMES[(m.month - 1) % 12];
        const aliases = HIJRI_BULAN_ALIASES[bulanName] || [bulanName];
        const res = await db.execute({
            sql: `SELECT student_id, SUM(amount) AS total
                  FROM payment_transactions
                  WHERE payment_type = 'YAUMIYAH'
                    AND month IN (${aliases.map(() => '?').join(',')})
                    AND created_at >= (NOW() - INTERVAL 200 DAY)
                  GROUP BY student_id`,
            args: aliases
        });
        const map = new Map();
        for (const r of res.rows) map.set(Number(r.student_id), Number(r.total) || 0);
        paidMaps.push({ year: m.year, bulanName, map });
    }

    // Tren tiap bulan
    const tren = paidMaps.map(({ year, bulanName, map }) => {
        const r = ringkasTunggakan(roster, map, nominalByLembaga);
        return {
            bulan: bulanName,
            tahun: year,
            label: `${bulanName} ${year}`,
            total: roster.length,
            lunas: r.lunas,
            menunggak: r.menunggak,
            belum_bayar: r.belum_bayar,
            belum_lunas: r.belum_lunas,
            tanpa_tarif: r.tanpa_tarif
        };
    });

    // Rincian per kelas & rombel utk bulan berjalan (terakhir)
    const current = paidMaps[paidMaps.length - 1];
    if (!current) {
        return { nominal_ada: true, rincian_bulan: null, tren, per_kelas: [], per_rombel: [] };
    }
    const agg = ({ keyOf, nameOf }) => {
        const map = new Map();
        for (const s of roster) {
            const nominal = nominalByLembaga[lembagaLabel(s.sumber)] ?? nominalByLembaga['ALL'] ?? null;
            const k = keyOf(s);
            if (!map.has(k)) {
                map.set(k, { label: `${lembagaLabel(s.sumber)} · ${nameOf(s)}`, total: 0, lunas: 0, menunggak: 0, belum_bayar: 0, belum_lunas: 0 });
            }
            const row = map.get(k);
            row.total += 1;
            if (!nominal || nominal <= 0) return;
            const paid = current.map.get(Number(s.id)) || 0;
            if (paid >= nominal) row.lunas += 1;
            else if (paid > 0) row.menunggak += 1;
            else row.belum_bayar += 1;
            row.belum_lunas = row.menunggak + row.belum_bayar;
        }
        return Array.from(map.values()).sort((a, b) => b.belum_lunas - a.belum_lunas || a.label.localeCompare(b.label));
    };
    const per_kelas = agg({
        keyOf: (s) => String(s.sumber) + '|' + (s.classroom_id ?? ''), 
        nameOf: (s) => s.class_name || 'Tanpa Kelas'
    });
    const per_rombel = agg({
        keyOf: (s) => String(s.sumber) + '|' + (s.rombel_id ?? ''),
        nameOf: (s) => s.nama_rombel || 'Tanpa Rombel'
    });

    return {
        nominal_ada: true,
        rincian_bulan: tren[tren.length - 1].label,
        tren,
        per_kelas,
        per_rombel
    };
};

// Jumlah penabung (santri yang setor) per hari + rincian per kelas/rombel (14 hari terakhir).
// Offset +7 jam menyesuaikan waktu UTC DB ke hari lokal Indonesia (Asia/Jakarta).
const getPenabungAnalisis = async (scope = { lembaga: 'ALL', sumber: '' }) => {
    const days = 14;
    const d0 = new Date();
    d0.setDate(d0.getDate() - (days - 1));
    const fromISO = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-${String(d0.getDate()).padStart(2, '0')}`;
    const sc = sumberClause(scope, 'sp');

    const result = await db.execute({
        sql: `SELECT st.student_id, DATE(DATE_ADD(st.saving_date, INTERVAL 7 HOUR)) AS tgl,
                     sp.sumber, sp.classroom_id, sp.rombel_id,
                     c.class_name, r.nama_rombel
              FROM savings_transactions st
              INNER JOIN santri_penempatan sp ON sp.id = st.student_id
              LEFT JOIN classes c ON c.id = sp.classroom_id AND c.sumber = sp.sumber
              LEFT JOIN rombels r ON r.id = sp.rombel_id AND r.sumber = sp.sumber
              WHERE st.transaction_type = 'SETORAN'
                AND DATE(DATE_ADD(st.saving_date, INTERVAL 7 HOUR)) >= ?
                ${sc.sql}`,
        args: [fromISO, ...sc.args]
    });

    // Baris per hari: penabung = santri berbeda, setoran = jumlah transaksi key-in.
    const byDay = new Map();
    const kelasAgg = new Map();
    const rombelAgg = new Map();
    const byKelasKey = (s) => String(s.sumber) + '|' + (s.classroom_id ?? '');
    const byRombelKey = (s) => String(s.sumber) + '|' + (s.rombel_id ?? '');
    for (const r of result.rows) {
        const d = r.tgl;
        if (!byDay.has(d)) byDay.set(d, { tanggal: d, savers: new Set(), setoran: 0 });
        const day = byDay.get(d);
        day.savers.add(Number(r.student_id));
        day.setoran += 1;

        for (const [aggMap, key, label] of [
            [kelasAgg, byKelasKey(r), `${lembagaLabel(r.sumber)} · ${r.class_name || 'Tanpa Kelas'}`],
            [rombelAgg, byRombelKey(r), `${lembagaLabel(r.sumber)} · ${r.nama_rombel || 'Tanpa Rombel'}`]
        ]) {
            if (!aggMap.has(key)) aggMap.set(key, { label, savers: new Set(), setoran: 0 });
            const a = aggMap.get(key);
            a.savers.add(Number(r.student_id));
            a.setoran += 1;
        }
    }

    // 14 hari lengkap (hari tanpa setoran tetap muncul, 0)
    const tren = [];
    for (let i = 0; i < days; i++) {
        const d = new Date();
        d.setDate(d.getDate() - (days - 1 - i));
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const day = byDay.get(iso);
        tren.push({
            tanggal: iso,
            label: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
            penabung: day ? day.savers.size : 0,
            setoran: day ? day.setoran : 0
        });
    }

    const sortAgg = (m) => Array.from(m.values())
        .map((a) => ({ label: a.label, penabung: a.savers.size, setoran: a.setoran }))
        .sort((a, b) => b.penabung - a.penabung || a.label.localeCompare(b.label));

    return { tren, per_kelas: sortAgg(kelasAgg), per_rombel: sortAgg(rombelAgg) };
};

// Section analisis gabungan — masing-masing aman bila gagal (null)
const getAnalisis = async (scope) => {
    const apply = async (fn) => {
        try { return await fn(); } catch (e) { return null; }
    };
    return {
        tunggakan: await apply(() => getTunggakanAnalisis(scope)),
        penabung: await apply(() => getPenabungAnalisis(scope))
    };
};

// Resolve lembaga kiosk dari akun Google yang sudah ditautkan (v3.36).
// Kiosk memakai tombol GIS utk "login ringan": verifikasi idToken Google, cari akun
// (admin/guru/orang tua) yang sudah punya google_sub = sub tsb, lalu kembalikan lembaga
// milik akun agar kiosk menampilkan data lembaga tsb. Belum tertaut → 401 {needLink}.
export const resolveLembagaFromGoogleService = async (idToken) => {
    const payload = await verifyGoogleIdToken(idToken);
    const found = await findAccountByGoogleSub(payload.sub);
    if (!found) {
        const err = new Error('Akun Google belum ditautkan ke akun lembaga. Hubungkan dulu lewat menu Profil.');
        err.status = 401;
        err.needLink = true;
        throw err;
    }
    const kode = String(found.account.lembaga || 'ALL').toUpperCase();
    const scope = await resolveLembagaScope(kode);
    return {
        lembaga: scope.lembaga,
        nama: scope.nama,
        sumber: scope.sumber,
        role: found.role,
        account_id: Number(found.account.id)
    };
};

// Endpoint publik dashboard harian — gabungan semua data aman utk tampilan kiosk.
// `lembaga` (opsional): scoping per lembaga (kode pada tabel `lembaga`); kosong/ALL → semua.
export const getPublicDailyService = async ({ date, lembaga } = {}) => {
    const scope = await resolveLembagaScope(lembaga);
    const ctx = { ...resolveToday(date), scope };
    const [sekolah, tanggal, pengumuman, agenda, statistik, jadwal, presensi, grafik, analisis] = await Promise.all([
        getSekolah(scope.lembaga),
        getTanggal(ctx),
        getPengumuman(ctx.iso, scope),
        getAgenda(ctx.iso, scope),
        getStatistik(scope),
        getJadwalHariIni(ctx),
        getPresensiHariIni(ctx.iso, scope),
        getGrafikKumpulan(ctx),
        getAnalisis(scope)
    ]);

    return {
        lembaga: { kode: scope.lembaga, nama: scope.nama, sumber: scope.sumber },
        sekolah,
        tanggal,
        pengumuman,
        agenda,
        statistik,
        jadwal_hariIni: jadwal,
        presensi_hariIni: presensi,
        grafik,
        analisis
    };
};
