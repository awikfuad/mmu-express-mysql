import db from '../config/db.js';
import bcrypt from 'bcrypt';
import XLSX from 'xlsx';
import env from '../config/env.js';
import { getSumber } from '../utils/lembagaHelper.js';
import { parseTanggalLahir } from '../utils/tanggalLahirHelper.js';

// Import data murid/santri dari Excel/CSV (E.1).
// Alur: POST /import/preview (parse + validasi per baris) → POST /import/commit (simpan atomik).
// Auto-create ke murid_kelas/santri_kelas, students, data_murid/data_santri, dan wali_murid.
// Terscope lembaga (admin scoped dipaksa ke lembaganya).

export const TEMPLATE_COLUMNS = [
    { key: 'nim', label: 'NIM', required: true },
    { key: 'nama', label: 'Nama', required: true },
    { key: 'jenjang', label: 'Jenjang', required: false, desc: 'Contoh: MTs / MA / MDT (madrasah) atau MDT (TPQ)' },
    { key: 'kelas', label: 'Kelas', required: false, desc: 'Nama kelas persis sesuai Data Ruang Kelas' },
    { key: 'rombel', label: 'Rombel', required: false },
    { key: 'jenis_kelamin', label: 'Jenis Kelamin', required: false, desc: 'L / P atau LAKI-LAKI / PEREMPUAN' },
    { key: 'tanggal_lahir', label: 'Tanggal Lahir', required: false, desc: 'DD/MM/YYYY, DD-MM-YYYY, atau YYYY-MM-DD' },
    { key: 'nik', label: 'NIK', required: false },
    { key: 'kk', label: 'No. KK', required: false, desc: '16 digit Nomor Kartu Keluarga' },
    { key: 'foto', label: 'Foto', required: false, desc: 'Nama file / URL foto santri (opsional)' },
    { key: 'nama_ayah', label: 'Nama Ayah', required: false },
    { key: 'nama_ibu', label: 'Nama Ibu', required: false },
    { key: 'telepon_wali', label: 'No. HP Wali', required: false },
    { key: 'alamat', label: 'Alamat', required: false }
];

const HEADER_ALIASES = {
    nim: ['nim', 'nis', 'nisn', 'no induk', 'no. induk', 'noinduk', 'nomor induk'],
    nama: ['nama', 'nama murid', 'nama santri', 'nama siswa', 'nama lengkap'],
    jenjang: ['jenjang'],
    kelas: ['kelas', 'nama kelas', 'ruang kelas', 'kelas (ruang)'],
    rombel: ['rombel', 'nama rombel'],
    jenis_kelamin: ['jenis kelamin', 'jk', 'gender', 'jenkel'],
    tanggal_lahir: ['tanggal lahir', 'tgl lahir', 'tgl lahir', 'ttl'],
    nik: ['nik'],
    kk: ['kk', 'no kk', 'no. kk', 'nokk', 'nomor kk', 'kartu keluarga', 'no kartu keluarga'],
    foto: ['foto', 'photo', 'gambar', 'foto santri', 'pas foto'],
    nama_ayah: ['nama ayah', 'ayah', 'nama orang tua'],
    nama_ibu: ['nama ibu', 'ibu'],
    telepon_wali: ['telepon wali', 'no hp wali', 'no. hp wali', 'no hp', 'no hp ortu', 'telepon ortu', 'kontak wali', 'no. telp'],
    alamat: ['alamat', 'alamat wali', 'alamat orang tua']
};

const norm = (v) => {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'number') return String(v).trim();
    return String(v).trim();
};

const normJK = (v) => {
    const s = norm(v).toUpperCase();
    if (['L', 'LAKI', 'LAKI-LAKI', 'LAKI LAKI', 'M', 'PRIA', 'LKL'].includes(s)) return 'LAKI-LAKI';
    if (['P', 'PEREMPUAN', 'PR', 'WANITA', 'CEWEK'].includes(s)) return 'PEREMPUAN';
    return s ? norm(v) : '';
};

const excelSerialToDate = (serial) => {
    const ms = Math.round((serial - 25569) * 86400 * 1000);
    return new Date(ms).toISOString().slice(0, 10);
};

const toDateStr = (v) => {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'number' && v > 20000 && v < 60000) return excelSerialToDate(v);
    const parsed = parseTanggalLahir(norm(v));
    if (!parsed) return '';
    return `${String(parsed.year).padStart(4, '0')}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`;
};

const findHeader = (rows) => {
    for (let i = 0; i < rows.length; i++) {
        const cells = (rows[i] || []).map(norm);
        const joined = cells.join('|').toLowerCase();
        if (/nim|nisn|nama|no induk|noinduk/.test(joined)) return i;
    }
    return -1;
};

const mapColumns = (headerCells) => {
    const map = {};
    const entries = Object.entries(HEADER_ALIASES);
    const mappedIdx = new Set();
    // Pass 1: cocokkan persis (exact) agar header seperti 'Nama Ayah'/'Nama Ibu' tidak
    // ter-capture oleh kolom 'nama' yang lebih generik.
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
    // Pass 2: fallback fuzzy (contains) untuk kolom yang belum terpetakan
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

const parseWorkbook = (buffer) => {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error('File tidak berisi sheet data.');
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!rows.length) throw new Error('File Excel/CSV kosong.');
    const headerIdx = findHeader(rows);
    if (headerIdx === -1) throw new Error('Header tidak ditemukan. Pastikan kolom NIM/Nama ada di baris pertama.');
    const map = mapColumns(rows[headerIdx]);
    if (!('nim' in map) || !('nama' in map)) {
        throw new Error('Kolom wajib NIM dan Nama tidak ditemukan di header. Gunakan template import.');
    }
    const records = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
        const cells = rows[i] || [];
        const rec = {};
        for (const [field, idx] of Object.entries(map)) {
            rec[field] = norm(cells[idx]);
        }
        rec.tanggal_lahir = toDateStr(rec.tanggal_lahir);
        records.push(rec);
    }
    return records.filter((r) => r.nim !== '' || r.nama !== '');
};

const loadLookups = async (s, { academicYearId, jenjangId, classroomId, rombelId }) => {
    const kelasScope = s.kelasFilter ? ` WHERE ${s.kelasFilter}` : '';
    const rombelScope = s.rombelFilter ? ` WHERE ${s.rombelFilter}` : '';
    const [jenjangs, kelas, rombels, existing] = await Promise.all([
        db.execute('SELECT id, nama_jenjang FROM jenjang'),
        db.execute(`SELECT id, class_name, jenjang_id, academic_year_id FROM ${s.kelasTable}${kelasScope}`),
        db.execute(`SELECT id, nama_rombel, jenjang_id FROM ${s.rombelTable}${rombelScope}`),
        db.execute(`SELECT nim FROM ${s.santriTable} WHERE ${s.sumberFilter || '1=1'}`)
    ]);

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

    return { lookupJenjang, lookupKelas, lookupRombel, existingNims: new Set(existing.rows.map((r) => norm(r.nim).toLowerCase())) };
};

const validateRecord = (rec, { lookupJenjang, lookupKelas, lookupRombel, existingNims }, params) => {
    const errors = [];
    const nim = norm(rec.nim);
    const nama = norm(rec.nama);

    if (!nim) errors.push('NIM wajib diisi');
    if (!nama) errors.push('Nama wajib diisi');
    if (nim && existingNims.has(nim.toLowerCase())) errors.push(`NIM ${nim} sudah terdaftar di sistem`);

    // Jenjang
    let jenjangId = params.jenjang_id || null;
    let jenjangLabel = rec.jenjang ? norm(rec.jenjang) : '';
    const foundJenjang = rec.jenjang ? lookupJenjang(rec.jenjang) : null;
    if (rec.jenjang && !foundJenjang) {
        errors.push(`Jenjang tidak dikenal: ${norm(rec.jenjang)}`);
    } else if (foundJenjang) {
        jenjangId = foundJenjang.id;
        jenjangLabel = foundJenjang.nama_jenjang;
    } else if (!jenjangId) {
        errors.push('Jenjang wajib diisi (di file atau pilih jenjang default)');
    }

    // Kelas
    let classroomId = params.classroom_id || null;
    let classroomLabel = rec.kelas ? norm(rec.kelas) : '';
    const foundKelas = rec.kelas ? lookupKelas(rec.kelas, jenjangId) : null;
    if (rec.kelas && !foundKelas) {
        errors.push(`Kelas tidak dikenal: ${norm(rec.kelas)}`);
    } else if (foundKelas) {
        classroomId = foundKelas.id;
        classroomLabel = foundKelas.class_name;
    } else if (params.classroom_id) {
        classroomLabel = classroomLabel || `Kelas ID ${params.classroom_id}`;
    }

    // Rombel (opsional)
    let rombelId = params.rombel_id || null;
    const foundRombel = rec.rombel ? lookupRombel(rec.rombel, jenjangId) : null;
    if (rec.rombel && !foundRombel) {
        errors.push(`Rombel tidak dikenal: ${norm(rec.rombel)}`);
    } else if (foundRombel) {
        rombelId = foundRombel.id;
    }

    // Jenis kelamin
    const jk = rec.jenis_kelamin ? normJK(rec.jenis_kelamin) : 'LAKI-LAKI';
    if (rec.jenis_kelamin && !['LAKI-LAKI', 'PEREMPUAN'].includes(jk)) {
        errors.push(`Jenis kelamin tidak valid: ${norm(rec.jenis_kelamin)}`);
    }

    // Tanggal lahir
    if (rec.tanggal_lahir && !/^\d{4}-\d{2}-\d{2}$/.test(rec.tanggal_lahir)) {
        errors.push(`Tanggal lahir tidak valid: ${norm(rec.tanggal_lahir)}`);
    }

    // KK (No. Kartu Keluarga): opsional, jika diisi harus 16 digit angka
    const kkRaw = norm(rec.kk);
    const kkDigits = kkRaw.replace(/\D/g, '');
    if (kkRaw && !/^\d{16}$/.test(kkDigits)) {
        errors.push(`No. KK tidak valid: ${kkRaw} (harus 16 digit angka)`);
    }
    const kk = kkDigits || '';

    // Foto: opsional, simpan sebagai string (nama file / URL)
    const foto = norm(rec.foto);

    return {
        nim,
        nama,
        jenjang: jenjangLabel,
        jenjang_id: jenjangId,
        kelas: classroomLabel,
        classroom_id: classroomId,
        rombel: foundRombel ? foundRombel.nama_rombel : (rec.rombel ? norm(rec.rombel) : ''),
        rombel_id: rombelId,
        jenis_kelamin: jk,
        tanggal_lahir: rec.tanggal_lahir || '',
        nik: norm(rec.nik),
        kk,
        foto,
        nama_ayah: norm(rec.nama_ayah),
        nama_ibu: norm(rec.nama_ibu),
        telepon_wali: norm(rec.telepon_wali),
        alamat: norm(rec.alamat),
        status: errors.length ? 'ERROR' : 'VALID',
        errors
    };
};

// Resolve lembaga: admin scoped dipaksa ke lembaganya; Super Admin bebas.
const resolveLembaga = (req) => {
    const userLembaga = (req.user?.lembaga || 'ALL').toUpperCase();
    if (userLembaga === 'ALL') {
        return (req.body?.lembaga || 'ALL').toUpperCase();
    }
    return userLembaga;
};

const getParams = (req) => ({
    academicYearId: req.body?.academic_year_id ? Number(req.body.academic_year_id) : null,
    jenjang_id: req.body?.jenjang_id ? Number(req.body.jenjang_id) : null,
    classroom_id: req.body?.classroom_id ? Number(req.body.classroom_id) : null,
    rombel_id: req.body?.rombel_id ? Number(req.body.rombel_id) : null
});

export const previewImportService = async (buffer, params, lembaga) => {
    const s = getSumber(lembaga);
    const records = parseWorkbook(buffer);
    const lookups = await loadLookups(s, params);
    const rows = records.map((rec) => validateRecord(rec, lookups, params));

    // Info keluarga virtual by KK (tanpa auto-create) — untuk preview di ImportData.vue
    const kkGroups = {};
    rows.filter(r => r.status === 'VALID' && r.kk && /^\d{16}$/.test(r.kk)).forEach(r => {
        if (!kkGroups[r.kk]) kkGroups[r.kk] = [];
        kkGroups[r.kk].push(r.nim);
    });
    const familyGroups = Object.entries(kkGroups)
        .filter(([, nims]) => nims.length > 1)
        .map(([kk, nims]) => ({ kk, count: nims.length, nims }));

    return {
        lembaga: s.lembaga,
        total: rows.length,
        valid: rows.filter((r) => r.status === 'VALID').length,
        error: rows.filter((r) => r.status === 'ERROR').length,
        rows,
        familyGroups
    };
};

export const commitImportService = async (buffer, params, lembaga, selectedIndices = null) => {
    const s = getSumber(lembaga);
    const records = parseWorkbook(buffer);
    const lookups = await loadLookups(s, params);
    const rows = records.map((rec) => validateRecord(rec, lookups, params));

    const validRows = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.status === 'VALID');
    const indices = selectedIndices && selectedIndices.length
        ? new Set(selectedIndices.map((n) => Number(n)))
        : null;
    const toImport = indices ? validRows.filter(({ i }) => indices.has(i)) : validRows;

    if (!toImport.length) {
        return { lembaga: s.lembaga, imported: 0, skipped: 0, errors: rows.filter((r) => r.status === 'ERROR').map((r) => ({ nim: r.nim, message: r.errors.join('; ') })) };
    }

    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync(env.defaultResetPassword, salt);
    const coreOps = [];
    const opIdxByRow = {}; // indeks (per baris) di coreOps utk mengambil lastInsertRowid penempatan

    toImport.forEach(({ r }, idx) => {
        opIdxByRow[idx] = coreOps.length;
        coreOps.push({
            sql: `INSERT INTO ${s.santriTable} (sumber, nim, name, password, academic_year_id, classroom_id, rombel_id, jenjang_id, jenis_kelamin, status)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            args: [s.sumber, r.nim, r.nama, hashedPassword, params.academicYearId, r.classroom_id, r.rombel_id, r.jenjang_id, r.jenis_kelamin]
        });
        coreOps.push({
            sql: `INSERT IGNORE INTO students (nim, name, password, academic_year_id, jenjang_id, lembaga)
                  VALUES (?, ?, ?, ?, ?, ?)`,
            args: [r.nim, r.nama, hashedPassword, params.academicYearId, r.jenjang_id, s.lembaga]
        });
        coreOps.push({
            sql: `INSERT INTO ${s.masterTable} (sumber, nim, nama, kelas, jenis_kelamin, nik, kk, tanggal_lahir, foto)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON DUPLICATE KEY UPDATE nama = VALUES(nama), kelas = COALESCE(NULLIF(VALUES(kelas), ''), kelas), jenis_kelamin = VALUES(jenis_kelamin), nik = COALESCE(NULLIF(VALUES(nik), ''), nik), kk = COALESCE(NULLIF(VALUES(kk), ''), kk), tanggal_lahir = COALESCE(NULLIF(VALUES(tanggal_lahir), ''), tanggal_lahir), foto = COALESCE(NULLIF(VALUES(foto), ''), foto)`,
            args: [s.sumber, r.nim, r.nama, r.kelas, r.jenis_kelamin, r.nik || null, r.kk || null, r.tanggal_lahir || null, r.foto || null]
        });
    });

    // Jalankan batch data inti (tanpa wali) — urutan hasil batch sama persis dgn coreOps.
    const results = await db.batch(coreOps, 'write');

    // Sisipkan wali_murid dengan murid_id = id dari insert santriTable (hasil batch, indeks selaras).
    const waliOps = [];
    toImport.forEach(({ r }, idx) => {
        const id = results[opIdxByRow[idx]]?.lastInsertRowid;
        const hasWali = r.nama_ayah || r.nama_ibu || r.telepon_wali || r.alamat;
        if (hasWali && id != null) {
            const sets = [];
            const setArgs = [];
            if (r.nama_ayah) { sets.push('nama_ayah = ?'); setArgs.push(r.nama_ayah); }
            if (r.nama_ibu) { sets.push('nama_ibu = ?'); setArgs.push(r.nama_ibu); }
            if (r.telepon_wali) { sets.push('telepon_wali = ?'); setArgs.push(r.telepon_wali); }
            if (r.alamat) { sets.push('alamat = ?'); setArgs.push(r.alamat); }
            if (sets.length) {
                waliOps.push({
                    sql: `INSERT INTO wali_murid (murid_id, sumber, nim, lembaga, nama_ayah, nama_ibu, telepon_wali, alamat)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                          ON DUPLICATE KEY UPDATE nim = VALUES(nim), lembaga = VALUES(lembaga), ${sets.join(', ')}`,
                    args: [id, s.sumber, r.nim, s.lembaga, r.nama_ayah || null, r.nama_ibu || null, r.telepon_wali || null, r.alamat || null, ...setArgs]
                });
            }
        }
    });

    if (waliOps.length) await db.batch(waliOps, 'write');

    // Post-batch: link santri_penempatan.student_id → students.id + sinkron tanggal_lahir
    const linkOps = [];
    toImport.forEach(({ r }, idx) => {
        const placementId = results[opIdxByRow[idx]]?.lastInsertRowid;
        if (placementId) {
            // Scope per baris yang baru di-insert (id + sumber) agar tidak menyentuh
            // penempatan lembaga lain yang kebetulan memiliki NIM sama.
            linkOps.push({
                sql: `UPDATE ${s.santriTable} SET student_id = (SELECT id FROM students WHERE nim = ? LIMIT 1) WHERE id = ? AND sumber = ?`,
                args: [r.nim, placementId, s.sumber]
            });
            if (r.tanggal_lahir) {
                // Scoped: hanya akun lembaga sendiri + legacy 'ALL'; Super Admin: semua akun NIM tsb
                const tglScope = s.isAll ? '' : ' AND lembaga IN (?, \'ALL\')';
                linkOps.push({
                    sql: `UPDATE students SET tanggal_lahir = ? WHERE nim = ? AND (tanggal_lahir IS NULL OR tanggal_lahir = '')${tglScope}`,
                    args: s.isAll ? [r.tanggal_lahir, r.nim] : [r.tanggal_lahir, r.nim, s.lembaga]
                });
            }
        }
    });
    if (linkOps.length) await db.batch(linkOps, 'write');

    return {
        lembaga: s.lembaga,
        imported: toImport.length,
        skipped: rows.length - toImport.length,
        errors: rows.filter((r) => r.status === 'ERROR').map((r) => ({ nim: r.nim || '-', message: r.errors.join('; ') }))
    };
};

// Generate template Excel (.xlsx) untuk diunduh pengguna.
export const buildTemplateService = () => {
    const header = TEMPLATE_COLUMNS.map((c) => c.label);
    const aoa = [
        header,
        ['2025-001', 'Ahmad Fauzi', 'MTs', 'Kelas 7A', '7A-1', 'L', '15/03/2014', '3201234567890001', '3201234567890002', 'foto-ahmad.jpg', 'H. Slamet', 'Hj. Siti', '081234567890', 'Jl. Pesantren No. 1'],
        ['2025-002', 'Siti Nurhaliza', 'MDT', 'Kelas 2 TPQ', '', 'P', '2016-08-26', '', '3201234567890003', '', 'Bapak Joko', 'Ibu Dewi', '082198765432', 'Desa Krapyak']
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Import Santri');
    // Baris kedua berisi contoh — beri warna header agar jelas
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return buffer;
};
