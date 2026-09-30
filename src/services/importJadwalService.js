import db from '../config/db.js';
import XLSX from 'xlsx';
import { getSumber } from '../utils/lembagaHelper.js';

// Import jadwal KBM dari Excel/CSV — mirror form ScheduleManager.vue
// Kolom wajib: Hari, Jam Mulai, Jam Selesai, Kelas, Mata Pelajaran (subject_name), Guru Pengampu (name)
// Opsional: Jenjang, Rombel, Tahun Ajaran
// Sesi = 'Sesi Pelajaran' (sesuai jawaban user), lembaga terscope

export const TEMPLATE_COLUMNS_JADWAL = [
    { key: 'hari', label: 'Hari', required: true, desc: 'SENIN/SELASA/RABU/KAMIS/JUMAT/SABTU/AHAD' },
    { key: 'jam_mulai', label: 'Jam Mulai', required: true, desc: 'HH:MM, contoh 07:30' },
    { key: 'jam_selesai', label: 'Jam Selesai', required: true, desc: 'HH:MM, contoh 09:00' },
    { key: 'kelas', label: 'Kelas', required: true, desc: 'Nama kelas persis sesuai Data Ruang Kelas' },
    { key: 'mapel', label: 'Mata Pelajaran', required: true, desc: 'Nama mapel sesuai Data Mapel (subject_name)' },
    { key: 'guru', label: 'Guru Pengampu', required: true, desc: 'Nama guru sesuai Data Guru (name)' },
    { key: 'jp', label: 'Jumlah JP', required: true, desc: 'Integer 1-4, contoh 1 atau 2' },
    { key: 'jenjang', label: 'Jenjang', required: false, desc: 'Contoh: MTs / MA / MDT (opsional, fallback default)' },
    { key: 'rombel', label: 'Rombel', required: false, desc: 'Nama rombel (opsional)' },
    { key: 'tahun_ajaran', label: 'Tahun Ajaran', required: false, desc: 'Contoh: 2025/2026 (opsional, fallback tahun aktif)' },
];

const HEADER_ALIASES_JADWAL = {
    hari: ['hari', 'hari efektif', 'day', 'day_of_week'],
    jam_mulai: ['jam mulai', 'jam_mulai', 'start_time', 'jam awal', 'jam masuk', 'waktu mulai', 'mulai'],
    jam_selesai: ['jam selesai', 'jam_selesai', 'end_time', 'jam akhir', 'jam keluar', 'waktu selesai', 'selesai'],
    jp: ['jumlah jp', 'jp', 'jml jp', 'jam pelajaran', 'jumlah jam pelajaran', 'jp pelajaran'],
    kelas: ['kelas', 'nama kelas', 'ruang kelas', 'class_name'],
    mapel: ['mata pelajaran', 'mapel', 'pelajaran', 'subject', 'subject_name', 'kitab', 'nama mapel'],
    guru: ['guru', 'guru pengampu', 'pengampu', 'ustadz', 'ustadzah', 'teacher', 'nama guru'],
    jenjang: ['jenjang'],
    rombel: ['rombel', 'nama rombel'],
    tahun_ajaran: ['tahun ajaran', 'tahun_ajaran', 'tahun', 'year_name', 'ta'],
};

const DAY_ENUM = ['SENIN','SELASA','RABU','KAMIS','JUMAT','SABTU','AHAD'];

const norm = (v) => {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'number') return String(v).trim();
    return String(v).trim();
};

const normalizeTime = (v) => {
    const s = norm(v).trim();
    if (!s) return '';
    // handle excel decimal time (0.xxx fraction of day) - if passed as number already stringified
    // also handle "07.30" with dot
    let t = s.replace('.', ':');
    // if contains : already
    const m = t.match(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/);
    if (m) {
        const hh = String(Number(m[1])).padStart(2,'0');
        const mm = String(Number(m[2])).padStart(2,'0');
        if (Number(hh) <= 23 && Number(mm) <= 59) return `${hh}:${mm}`;
        return '';
    }
    // handle "730" without colon
    if (/^\d{3,4}$/.test(t)) {
        const padded = t.padStart(4,'0');
        const hh = padded.slice(0,2);
        const mm = padded.slice(2,4);
        if (Number(hh) <= 23 && Number(mm) <= 59) return `${hh}:${mm}`;
    }
    return '';
};

const isValidTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const timeOverlap = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && aEnd > bStart;
// Rombel tak terbedakan bila salah satu NULL (konservatif) atau sama persis.
const rombelTakTerbedakan = (r1, r2) => r1 == null || r2 == null || r1 === r2;

const findHeaderJadwal = (rows) => {
    for (let i = 0; i < rows.length; i++) {
        const cells = (rows[i] || []).map(norm);
        const joined = cells.join('|').toLowerCase();
        if (/hari|jam|kelas|mapel|mata pelajaran|guru|pengampu/.test(joined)) return i;
    }
    return -1;
};

const mapColumnsJadwal = (headerCells) => {
    const map = {};
    const entries = Object.entries(HEADER_ALIASES_JADWAL);
    const mappedIdx = new Set();
    headerCells.forEach((cell, idx) => {
        const key = norm(cell).toLowerCase();
        if (!key) return;
        for (const [field, aliases] of entries) {
            if (aliases.includes(key)) {
                if (!(field in map)) map[field] = idx;
                mappedIdx.add(idx);
                break;
            }
        }
    });
    headerCells.forEach((cell, idx) => {
        const key = norm(cell).toLowerCase();
        if (!key || mappedIdx.has(idx)) return;
        for (const [field, aliases] of entries) {
            if (aliases.some((a) => key.includes(a) || a.includes(key))) {
                if (!(field in map)) map[field] = idx;
                mappedIdx.add(idx);
                break;
            }
        }
    });
    return map;
};

const parseWorkbookJadwal = (buffer) => {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error('File tidak berisi sheet data.');
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!rows.length) throw new Error('File Excel/CSV kosong.');
    const headerIdx = findHeaderJadwal(rows);
    if (headerIdx === -1) throw new Error('Header tidak ditemukan. Pastikan kolom Hari/Jam/Kelas/Mapel/Guru/Jumlah JP ada di baris pertama.');
    const map = mapColumnsJadwal(rows[headerIdx]);
    const required = ['hari','jam_mulai','jam_selesai','kelas','mapel','guru','jp'];
    const missing = required.filter(k => !(k in map));
    if (missing.length) {
        throw new Error(`Kolom wajib tidak ditemukan di header: ${missing.join(', ')}. Gunakan template import jadwal.`);
    }
    const records = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
        const cells = rows[i] || [];
        const rec = {};
        for (const [field, idx] of Object.entries(map)) {
            let val = norm(cells[idx]);
            // handle time cells that may be Date or number
            if (field === 'jam_mulai' || field === 'jam_selesai') {
                const raw = cells[idx];
                if (raw instanceof Date) {
                    const hh = String(raw.getHours()).padStart(2,'0');
                    const mm = String(raw.getMinutes()).padStart(2,'0');
                    val = `${hh}:${mm}`;
                } else if (typeof raw === 'number' && raw > 0 && raw < 1) {
                    // excel time fraction
                    const totalMin = Math.round(raw * 24 * 60);
                    const hh = String(Math.floor(totalMin/60)).padStart(2,'0');
                    const mm = String(totalMin%60).padStart(2,'0');
                    val = `${hh}:${mm}`;
                } else {
                    val = norm(cells[idx]);
                }
            } else {
                val = norm(cells[idx]);
            }
            rec[field] = val;
        }
        records.push(rec);
    }
    // filter empty rows (at least hari or kelas or mapel)
    return records.filter((r) => norm(r.hari) !== '' || norm(r.kelas) !== '' || norm(r.mapel) !== '');
};

const loadLookupsJadwal = async (s, lembaga) => {
    const kelasScope = s.kelasFilter ? ` WHERE ${s.kelasFilter}` : '';
    const rombelScope = s.rombelFilter ? ` WHERE ${s.rombelFilter}` : '';
    const l = (lembaga || 'ALL').toUpperCase();
    const teacherWhere = l === 'ALL' ? '' : 'WHERE lembaga IN (?, ?)';
    const teacherArgs = l === 'ALL' ? [] : [l, 'ALL'];
    const [jenjangs, kelas, rombels, subjects, teachers, years] = await Promise.all([
        db.execute('SELECT id, nama_jenjang FROM jenjang'),
        db.execute(`SELECT id, class_name, jenjang_id, academic_year_id, sumber FROM ${s.kelasTable}${kelasScope}`),
        db.execute(`SELECT id, nama_rombel, jenjang_id FROM ${s.rombelTable}${rombelScope}`),
        db.execute('SELECT id, subject_name, subject_code FROM subjects'),
        db.execute({ sql: `SELECT id, name, username, lembaga FROM teachers ${teacherWhere}`, args: teacherArgs }),
        db.execute('SELECT id, year_name, is_active FROM academic_years'),
    ]);
    let teacherRows = teachers.rows;

    const lookupJenjang = (name) => {
        const target = norm(name).toLowerCase();
        if (!target) return null;
        return jenjangs.rows.find((j) => String(j.nama_jenjang).toLowerCase() === target)
            || jenjangs.rows.find((j) => String(j.nama_jenjang).toLowerCase().includes(target) || target.includes(String(j.nama_jenjang).toLowerCase()))
            || null;
    };
    const lookupKelas = (name, jenjangIdResolved) => {
        const target = norm(name).toLowerCase();
        if (!target) return null;
        let candidates = kelas.rows.filter((k) => String(k.class_name).toLowerCase() === target);
        if (!candidates.length) candidates = kelas.rows.filter((k) => String(k.class_name).toLowerCase().includes(target) || target.includes(String(k.class_name).toLowerCase()));
        if (jenjangIdResolved) {
            const inJenjang = candidates.filter((k) => Number(k.jenjang_id) === Number(jenjangIdResolved));
            if (inJenjang.length) candidates = inJenjang;
        }
        return candidates[0] || null;
    };
    const lookupRombel = (name, jenjangIdResolved) => {
        const target = norm(name).toLowerCase();
        if (!target) return null;
        let candidates = rombels.rows.filter((r) => String(r.nama_rombel).toLowerCase() === target);
        if (!candidates.length) candidates = rombels.rows.filter((r) => String(r.nama_rombel).toLowerCase().includes(target) || target.includes(String(r.nama_rombel).toLowerCase()));
        if (jenjangIdResolved) {
            const inJenjang = candidates.filter((r) => Number(r.jenjang_id) === Number(jenjangIdResolved));
            if (inJenjang.length) candidates = inJenjang;
        }
        return candidates[0] || null;
    };
    const lookupMapel = (name) => {
        const target = norm(name).toLowerCase();
        if (!target) return null;
        return subjects.rows.find((m) => String(m.subject_name).toLowerCase() === target)
            || subjects.rows.find((m) => String(m.subject_name).toLowerCase().includes(target) || target.includes(String(m.subject_name).toLowerCase()))
            || null;
    };
    const lookupGuru = (name) => {
        const target = norm(name).toLowerCase();
        if (!target) return null;
        return teacherRows.find((g) => String(g.name).toLowerCase() === target)
            || teacherRows.find((g) => String(g.name).toLowerCase().includes(target) || target.includes(String(g.name).toLowerCase()))
            || null;
    };
    const lookupTahun = (name) => {
        const target = norm(name).toLowerCase();
        if (!target) return null;
        return years.rows.find((y) => String(y.year_name).toLowerCase() === target)
            || years.rows.find((y) => String(y.year_name).toLowerCase().includes(target))
            || null;
    };
    const activeYear = years.rows.find((y) => Number(y.is_active) === 1) || years.rows[0] || null;

    return { lookupJenjang, lookupKelas, lookupRombel, lookupMapel, lookupGuru, lookupTahun, activeYear, years };
};

const validateJadwalRecord = (rec, lookups, params) => {
    const errors = [];
    const hariRaw = norm(rec.hari).toUpperCase();
    const hari = DAY_ENUM.includes(hariRaw) ? hariRaw : '';
    if (!hariRaw) errors.push('Hari wajib diisi');
    else if (!DAY_ENUM.includes(hariRaw)) errors.push(`Hari tidak valid: ${rec.hari} (harus SENIN/SELASA/RABU/KAMIS/JUMAT/SABTU/AHAD)`);

    const jamMulai = normalizeTime(rec.jam_mulai);
    const jamSelesai = normalizeTime(rec.jam_selesai);
    if (!norm(rec.jam_mulai)) errors.push('Jam Mulai wajib diisi');
    else if (!jamMulai || !isValidTime(jamMulai)) errors.push(`Jam Mulai tidak valid: ${rec.jam_mulai} (format HH:MM)`);
    if (!norm(rec.jam_selesai)) errors.push('Jam Selesai wajib diisi');
    else if (!jamSelesai || !isValidTime(jamSelesai)) errors.push(`Jam Selesai tidak valid: ${rec.jam_selesai} (format HH:MM)`);
    if (jamMulai && jamSelesai && isValidTime(jamMulai) && isValidTime(jamSelesai) && jamMulai >= jamSelesai) {
        errors.push(`Jam Mulai (${jamMulai}) harus sebelum Jam Selesai (${jamSelesai})`);
    }

    // Kelas
    let classroomId = null;
    let classroomLabel = norm(rec.kelas);
    let jenjangId = params.jenjang_id || null;
    let jenjangLabel = rec.jenjang ? norm(rec.jenjang) : '';
    const foundJenjang = rec.jenjang ? lookups.lookupJenjang(rec.jenjang) : null;
    if (rec.jenjang && !foundJenjang) {
        errors.push(`Jenjang tidak dikenal: ${rec.jenjang}`);
    } else if (foundJenjang) {
        jenjangId = foundJenjang.id;
        jenjangLabel = foundJenjang.nama_jenjang;
    }
    const foundKelas = rec.kelas ? lookups.lookupKelas(rec.kelas, jenjangId) : null;
    if (!norm(rec.kelas)) errors.push('Kelas wajib diisi');
    else if (!foundKelas) errors.push(`Kelas tidak dikenal: ${rec.kelas}`);
    else {
        classroomId = foundKelas.id;
        classroomLabel = foundKelas.class_name;
        if (!jenjangId && foundKelas.jenjang_id) jenjangId = foundKelas.jenjang_id;
    }

    // Rombel opsional
    let rombelId = params.rombel_id || null;
    const foundRombel = rec.rombel ? lookups.lookupRombel(rec.rombel, jenjangId) : null;
    if (rec.rombel && !foundRombel) {
        errors.push(`Rombel tidak dikenal: ${rec.rombel}`);
    } else if (foundRombel) {
        rombelId = foundRombel.id;
    }

    // Mapel by subject_name
    const foundMapel = rec.mapel ? lookups.lookupMapel(rec.mapel) : null;
    let subjectId = null;
    let mapelLabel = norm(rec.mapel);
    if (!norm(rec.mapel)) errors.push('Mata Pelajaran wajib diisi');
    else if (!foundMapel) errors.push(`Mata Pelajaran tidak dikenal: ${rec.mapel}`);
    else { subjectId = foundMapel.id; mapelLabel = foundMapel.subject_name; }

    // Guru by name
    const foundGuru = rec.guru ? lookups.lookupGuru(rec.guru) : null;
    let teacherId = null;
    let guruLabel = norm(rec.guru);
    if (!norm(rec.guru)) errors.push('Guru Pengampu wajib diisi');
    else if (!foundGuru) errors.push(`Guru tidak dikenal: ${rec.guru}`);
    else { teacherId = foundGuru.id; guruLabel = foundGuru.name; }

    // JP integer 1-4
    const jpRaw = norm(rec.jp);
    const jp = Number(jpRaw);
    if (!jpRaw) errors.push('Jumlah JP wajib diisi (1-4)');
    else if (!Number.isInteger(jp) || jp < 1 || jp > 4) errors.push(`Jumlah JP tidak valid: ${rec.jp} (harus integer 1-4)`);

    // Tahun Ajaran
    let academicYearId = params.academicYearId || null;
    let tahunLabel = rec.tahun_ajaran ? norm(rec.tahun_ajaran) : '';
    const foundTahun = rec.tahun_ajaran ? lookups.lookupTahun(rec.tahun_ajaran) : null;
    if (rec.tahun_ajaran && !foundTahun) {
        errors.push(`Tahun Ajaran tidak dikenal: ${rec.tahun_ajaran}`);
    } else if (foundTahun) {
        academicYearId = foundTahun.id;
        tahunLabel = foundTahun.year_name;
    } else if (!academicYearId) {
        if (lookups.activeYear) {
            academicYearId = lookups.activeYear.id;
            tahunLabel = lookups.activeYear.year_name;
        } else {
            errors.push('Tahun Ajaran wajib diisi (di file atau pilih tahun aktif)');
        }
    } else {
        const y = lookups.years.rows.find(r => Number(r.id) === Number(academicYearId));
        if (y) tahunLabel = y.year_name;
    }

    return {
        hari,
        hari_raw: norm(rec.hari),
        jam_mulai: jamMulai,
        jam_mulai_raw: norm(rec.jam_mulai),
        jam_selesai: jamSelesai,
        jam_selesai_raw: norm(rec.jam_selesai),
        kelas: classroomLabel,
        classroom_id: classroomId,
        mapel: mapelLabel,
        subject_id: subjectId,
        guru: guruLabel,
        teacher_id: teacherId,
        jenjang: jenjangLabel,
        jenjang_id: jenjangId,
        rombel: foundRombel ? foundRombel.nama_rombel : (rec.rombel ? norm(rec.rombel) : ''),
        rombel_id: rombelId,
        tahun_ajaran: tahunLabel,
        academic_year_id: academicYearId,
        day_of_week: hari,
        start_time: jamMulai,
        end_time: jamSelesai,
        jp: Number.isInteger(jp) && jp>=1 && jp<=4 ? jp : 1,
        status: errors.length ? 'ERROR' : 'VALID',
        errors
    };
};

const checkConflicts = async (validatedRows, lembaga) => {
    const l = (lembaga || 'ALL').toUpperCase();
    // intra-file conflicts
    // also check DB conflicts per row via queries
    for (let i = 0; i < validatedRows.length; i++) {
        const r = validatedRows[i];
        if (r.status === 'ERROR') continue;
        // intra-file: compare with previous valid rows
        for (let j = 0; j < i; j++) {
            const prev = validatedRows[j];
            if (prev.status === 'ERROR') continue;
            if (prev.day_of_week !== r.day_of_week) continue;
            if (!timeOverlap(prev.start_time, prev.end_time, r.start_time, r.end_time)) continue;
            // Kelas sama HANYA bila rombel tak terbedakan (rombel = pembeda jadwal)
            if (prev.classroom_id && r.classroom_id && prev.classroom_id === r.classroom_id && rombelTakTerbedakan(prev.rombel_id, r.rombel_id)) {
                r.errors.push(`Bentrok intra-file: Kelas ${r.kelas} sudah ada jadwal ${prev.mapel} (${prev.start_time}-${prev.end_time}) hari ${r.day_of_week} di baris ${j+1}`);
                r.status = 'ERROR';
                break;
            }
            if (prev.teacher_id && r.teacher_id && prev.teacher_id === r.teacher_id) {
                r.errors.push(`Bentrok intra-file: Guru ${r.guru} sudah mengajar ${prev.mapel} (${prev.start_time}-${prev.end_time}) hari ${r.day_of_week} di baris ${j+1}`);
                r.status = 'ERROR';
                break;
            }
        }
        if (r.status === 'ERROR') continue;
        // DB conflicts
        const whereLembaga = l === 'ALL' ? '' : 'AND s.lembaga IN (?, ?)';
        const argsBase = l === 'ALL' ? [] : [l, 'ALL'];
        // kelas conflict (kelas sama HANYA bila rombel tak terbedakan)
        const kelasQuery = `SELECT s.id, sub.subject_name, s.start_time, s.end_time FROM schedules s LEFT JOIN subjects sub ON s.subject_id = sub.id WHERE s.classroom_id = ? AND s.day_of_week = ? AND s.start_time < ? AND s.end_time > ? AND (s.rombel_id IS NULL OR ? IS NULL OR s.rombel_id = ?) ${whereLembaga}`;
        const kelasArgs = [r.classroom_id, r.day_of_week, r.end_time, r.start_time, r.rombel_id ?? null, r.rombel_id ?? null, ...argsBase];
        const kelasRes = await db.execute({ sql: kelasQuery, args: kelasArgs });
        if (kelasRes.rows.length) {
            const c = kelasRes.rows[0];
            r.errors.push(`Bentrok DB: Kelas ${r.kelas} sudah terjadwal ${c.subject_name || ''} (${c.start_time}-${c.end_time}) hari ${r.day_of_week}`);
            r.status = 'ERROR';
            continue;
        }
        const guruQuery = `SELECT s.id, sub.subject_name, s.start_time, s.end_time FROM schedules s LEFT JOIN subjects sub ON s.subject_id = sub.id WHERE s.day_of_week = ? AND (s.teacher_id = ? OR s.substitute_teacher_id = ?) AND s.start_time < ? AND s.end_time > ? ${whereLembaga}`;
        const guruArgs = [r.day_of_week, r.teacher_id, r.teacher_id, r.end_time, r.start_time, ...argsBase];
        const guruRes = await db.execute({ sql: guruQuery, args: guruArgs });
        if (guruRes.rows.length) {
            const g = guruRes.rows[0];
            r.errors.push(`Bentrok DB: Guru ${r.guru} sudah mengajar ${g.subject_name || ''} (${g.start_time}-${g.end_time}) hari ${r.day_of_week}`);
            r.status = 'ERROR';
        }
    }
    return validatedRows;
};

const resolveLembagaJadwal = (req) => {
    const userLembaga = (req.user?.lembaga || 'ALL').toUpperCase();
    if (userLembaga === 'ALL') {
        return (req.body?.lembaga || 'ALL').toUpperCase();
    }
    return userLembaga;
};

const getParamsJadwal = (req) => ({
    academicYearId: req.body?.academic_year_id ? Number(req.body.academic_year_id) : null,
    jenjang_id: req.body?.jenjang_id ? Number(req.body.jenjang_id) : null,
    rombel_id: req.body?.rombel_id ? Number(req.body.rombel_id) : null
});

export const previewImportJadwalService = async (buffer, params, lembaga) => {
    const s = getSumber(lembaga);
    const records = parseWorkbookJadwal(buffer);
    const lookups = await loadLookupsJadwal(s, lembaga);
    const validated = records.map((rec) => validateJadwalRecord(rec, lookups, params));
    const withConflicts = await checkConflicts(validated, lembaga);
    return {
        lembaga: s.lembaga,
        total: withConflicts.length,
        valid: withConflicts.filter((r) => r.status === 'VALID').length,
        error: withConflicts.filter((r) => r.status === 'ERROR').length,
        rows: withConflicts
    };
};

export const commitImportJadwalService = async (buffer, params, lembaga, selectedIndices = null) => {
    const s = getSumber(lembaga);
    const records = parseWorkbookJadwal(buffer);
    const lookups = await loadLookupsJadwal(s, lembaga);
    const validated = records.map((rec) => validateJadwalRecord(rec, lookups, params));
    const withConflicts = await checkConflicts(validated, lembaga);

    const validRows = withConflicts.map((r, i) => ({ r, i })).filter(({ r }) => r.status === 'VALID');
    const indices = selectedIndices && selectedIndices.length ? new Set(selectedIndices.map((n) => Number(n))) : null;
    const toImport = indices ? validRows.filter(({ i }) => indices.has(i)) : validRows;

    if (!toImport.length) {
        return { lembaga: s.lembaga, imported: 0, skipped: withConflicts.length, errors: withConflicts.filter((r) => r.status === 'ERROR').map((r) => ({ row: r, message: r.errors.join('; ') })) };
    }

    const ops = [];
    toImport.forEach(({ r }) => {
        ops.push({
            sql: `INSERT INTO schedules (academic_year_id, jenjang_id, rombel_id, classroom_id, subject_id, day_of_week, start_time, end_time, teacher_id, session_name, lembaga, jp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [r.academic_year_id, r.jenjang_id, r.rombel_id, r.classroom_id, r.subject_id, r.day_of_week, r.start_time, r.end_time, r.teacher_id, 'Sesi Pelajaran', s.lembaga, Number(r.jp) || 1]
        });
    });

    // Try batch, if conflict occurs per row fallback to per-row try to collect which failed
    let imported = 0;
    const errors = [...withConflicts.filter((r) => r.status === 'ERROR').map((r) => ({ row: r, message: r.errors.join('; ') }))];
    try {
        await db.batch(ops, 'write');
        imported = toImport.length;
    } catch (e) {
        // fallback per-row
        imported = 0;
        for (const { r } of toImport) {
            try {
                await db.execute({
                    sql: `INSERT INTO schedules (academic_year_id, jenjang_id, rombel_id, classroom_id, subject_id, day_of_week, start_time, end_time, teacher_id, session_name, lembaga, jp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    args: [r.academic_year_id, r.jenjang_id, r.rombel_id, r.classroom_id, r.subject_id, r.day_of_week, r.start_time, r.end_time, r.teacher_id, 'Sesi Pelajaran', s.lembaga, Number(r.jp) || 1]
                });
                imported++;
            } catch (err2) {
                errors.push({ row: r, message: err2.message });
            }
        }
    }

    return {
        lembaga: s.lembaga,
        imported,
        skipped: withConflicts.length - imported,
        errors
    };
};

export const buildTemplateJadwalService = () => {
    const header = TEMPLATE_COLUMNS_JADWAL.map((c) => c.label);
    const aoa = [
        header,
        ['SENIN', '07:30', '09:00', 'Kelas 7A', 'Fiqih', 'Ustadz Ahmad', 2, 'MTs', '7A-1', '2025/2026'],
        ['SELASA', '09:00', '10:30', 'Kelas 8A', 'Aqidah', 'Ustadz Budi', 1, '', '', '2025/2026'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Import Jadwal');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return buffer;
};
