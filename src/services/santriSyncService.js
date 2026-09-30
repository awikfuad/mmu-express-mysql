import bcrypt from 'bcrypt';
import db from '../config/db.js';
import env from '../config/env.js';
import { getSumber } from '../utils/lembagaHelper.js';

// Sinkronisasi Data Santri (lanjutan E.1) — antisipasi kegagalan sebagian saat Import Data.
// Import menulis ke beberapa tabel sekaligus (santri_penempatan, students, santri_biodata,
// wali_murid) lewat beberapa db.batch terpisah. Bila salah satu batch gagal di tengah, sebuah
// NIM bisa terlanjur masuk satu tabel tapi hilang di tabel lain. Fitur ini menganalisis &
// memperbaiki ketidaksesuaian antar tabel:
//   - santri_penempatan  (murid kelas)   → SUMBER KEBENARAN (roster kelas per tahun)
//   - santri_biodata     (data murid)    → biodata induk (nama, kelas, JK, tgl lahir, ...)
//   - students           (akun mobile)   → akun login santri (NIM unik) + link student_id
// Alur (pola sama Import Data): GET /sync-santri/preview (analisis, belum ubah apa pun)
//   → POST /sync-santri/commit (terapkan perbaikan secara atomik db.batch).
// Tidak pernah menghapus data — hanya create-missing + update-mismatch yang aman.

const norm = (v) => (v === null || v === undefined ? '' : String(v).trim());
const nonEmpty = (v) => norm(v) !== '';

// Akun students boleh 'ALL' (legacy/shared) atau lembaga yang sesuai dgn sumber penempatan.
const isAkunSesuai = (studentsLembaga, sumber) => {
    const l = norm(studentsLembaga).toUpperCase();
    if (!l || l === 'ALL') return true;
    return (l === 'TPQ' ? 'tpq' : 'madrasah') === sumber;
};

// Lembaga utk akun students baru: scoped admin dipaksa ke lembaganya; Super Admin ALL → 'ALL'.
const lembagaAkunBaru = (s) => (s.isAll ? 'ALL' : s.lembaga);

const load = async (s) => {
    const where = s.isAll ? '' : ` WHERE sp.sumber = '${s.sumber}'`;
    const placements = (await db.execute(`
        SELECT sp.id, sp.sumber, sp.nim, sp.name, sp.student_id, sp.jenis_kelamin,
               sp.academic_year_id, sp.jenjang_id, sp.classroom_id, c.class_name
        FROM santri_penempatan sp
        LEFT JOIN classes c ON sp.classroom_id = c.id
        ${where}
        ORDER BY sp.name ASC, sp.id ASC
    `)).rows;

    const bioWhere = s.isAll ? '' : ` WHERE sumber = '${s.sumber}'`;
    const bios = (await db.execute(`SELECT sumber, nim, nama, kelas, jenis_kelamin, tanggal_lahir FROM santri_biodata ${bioWhere}`)).rows;
    const bioByKey = new Map(bios.map((b) => [`${b.sumber}|${norm(b.nim).toLowerCase()}`, b]));

    // Akun students: Super Admin melihat semua; admin scoped melihat akun NIM tsb
    // (termasuk akun berlembaga lain yg konflik — dilaporkan KONFLIK_LEMBAGA & dilewati saat commit).
    const students = s.isAll
        ? (await db.execute(`SELECT id, nim, name, lembaga, tanggal_lahir FROM students`)).rows
        : (await db.execute({
            sql: `SELECT id, nim, name, lembaga, tanggal_lahir FROM students WHERE nim IN (SELECT nim FROM santri_penempatan WHERE sumber = ?)`,
            args: [s.sumber]
        })).rows;
    const studByNim = new Map(students.map((r) => [norm(r.nim).toLowerCase(), r]));

    return { placements, bios, bioByKey, studByNim, students };
};

// Analisis konsistensi → rows (per penempatan + flag perbaikan), summary, dan data yatim.
// `s` di sini juga dipakai utk filter yatim akun sesuai scope lembaga.
const analyze = (s, data) => {
    const { placements, bios, bioByKey, studByNim, students } = data;

    // Set NIM penempatan per sumber (dipakai utk mendeteksi data yatim)
    const nimsPerSumber = new Map();
    placements.forEach((p) => {
        if (!nimsPerSumber.has(p.sumber)) nimsPerSumber.set(p.sumber, new Set());
        nimsPerSumber.get(p.sumber).add(norm(p.nim).toLowerCase());
    });

    const rows = [];
    const summary = {
        total: placements.length,
        selaras: 0,
        bermasalah: 0,
        biodata_hilang: 0,
        akun_hilang: 0,
        link_hilang: 0,
        nama_beda: 0,
        kelas_beda: 0,
        jk_relay: 0,
        tgl_relay: 0,
        konflik_lembaga: 0
    };

    for (const p of placements) {
        const bio = bioByKey.get(`${p.sumber}|${norm(p.nim).toLowerCase()}`);
        const stud = studByNim.get(norm(p.nim).toLowerCase());
        const conflict = !!stud && !isAkunSesuai(stud.lembaga, p.sumber);

        const f = {
            conflict,
            biodataBaru: !bio,
            akunBaru: !stud && !conflict,
            link: !conflict && !!stud && Number(p.student_id) !== Number(stud.id),
            namaBiodata: !!bio && norm(bio.nama).toLowerCase() !== norm(p.name).toLowerCase(),
            namaAkun: !conflict && !!stud && norm(stud.name).toLowerCase() !== norm(p.name).toLowerCase(),
            kelasBiodata: !!bio && nonEmpty(p.class_name) && norm(bio.kelas).toLowerCase() !== norm(p.class_name).toLowerCase(),
            jkBiodata: !!bio && !nonEmpty(bio.jenis_kelamin) && nonEmpty(p.jenis_kelamin),
            tglAkun: !conflict && !!stud && !!bio && nonEmpty(bio.tanggal_lahir) && !nonEmpty(stud.tanggal_lahir),
            tglBiodata: !conflict && !!stud && !!bio && nonEmpty(stud.tanggal_lahir) && !nonEmpty(bio.tanggal_lahir)
        };

        const hasIssue = conflict || Object.values(f).some((v) => !!v);
        if (hasIssue) summary.bermasalah++;
        else summary.selaras++;

        if (f.biodataBaru) summary.biodata_hilang++;
        if (f.akunBaru) summary.akun_hilang++;
        if (f.link) summary.link_hilang++;
        if (f.namaBiodata || f.namaAkun) summary.nama_beda++;
        if (f.kelasBiodata) summary.kelas_beda++;
        if (f.jkBiodata) summary.jk_relay++;
        if (f.tglAkun || f.tglBiodata) summary.tgl_relay++;
        if (conflict) summary.konflik_lembaga++;

        const actions = [];
        if (conflict) actions.push('KONFLIK_LEMBAGA');
        if (f.biodataBaru) actions.push('BIODATA_BARU');
        if (f.akunBaru) actions.push('AKUN_BARU');
        if (f.link) actions.push('LINK_AKUN');
        if (f.namaBiodata) actions.push('NAMA_BIODATA');
        if (f.namaAkun) actions.push('NAMA_AKUN');
        if (f.kelasBiodata) actions.push('KELAS_BIODATA');
        if (f.jkBiodata) actions.push('JK_BIODATA');
        if (f.tglAkun) actions.push('TGL_AKUN');
        if (f.tglBiodata) actions.push('TGL_BIODATA');

        rows.push({
            id: p.id,
            sumber: p.sumber,
            nim: p.nim,
            name: p.name,
            class_name: p.class_name || '',
            jenis_kelamin: p.jenis_kelamin || '',
            academic_year_id: p.academic_year_id,
            jenjang_id: p.jenjang_id,
            status: hasIssue ? 'KETIDAKSESUAIAN' : 'SELARAS',
            actions,
            conflict,
            bioExists: !!bio,
            studExists: !!stud,
            linked: p.student_id != null,
            bioTgl: bio ? (bio.tanggal_lahir || '') : '',
            fix: f
        });
    }

    // Data yatim (hanya laporan, tidak pernah dihapus oleh sinkronisasi)
    const ORPHAN_CAP = 200;
    const biosYatim = bios.filter((b) => !nimsPerSumber.get(b.sumber)?.has(norm(b.nim).toLowerCase()));
    const orphanBiodata = {
        total: biosYatim.length,
        items: biosYatim.slice(0, ORPHAN_CAP).map((b) => ({ sumber: b.sumber, nim: b.nim, nama: b.nama }))
    };

    const siswaYatim = students.filter((st) => {
        const l = norm(st.lembaga).toUpperCase();
        if (s.isAll) return true;           // Super Admin: semua akun
        if (!l || l === 'ALL') return true; // legacy/shared tetap terlihat
        return (l === 'TPQ' ? 'tpq' : 'madrasah') === s.sumber;
    });
    const orphanStudents = {
        total: siswaYatim.length,
        items: siswaYatim.slice(0, ORPHAN_CAP).map((st) => ({ nim: st.nim, name: st.name, lembaga: st.lembaga || 'ALL' }))
    };

    return { rows, summary, orphans: { biodata: orphanBiodata, students: orphanStudents } };
};

export const previewSantriSyncService = async (lembaga = 'ALL') => {
    const s = getSumber(lembaga);
    const data = await load(s);
    const { rows, summary, orphans } = analyze(s, data);
    return { lembaga: s.lembaga, summary, rows, orphans };
};

export const commitSantriSyncService = async (lembaga = 'ALL') => {
    const s = getSumber(lembaga);
    const data = await load(s);
    const { rows, summary, orphans } = analyze(s, data);

    if (!summary.bermasalah) {
        return { lembaga: s.lembaga, total_diperbaiki: 0, applied: {}, summary, orphans };
    }

    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync(env.defaultResetPassword, salt);

    const applied = {
        biodata_baru: 0,
        akun_baru: 0,
        link: 0,
        nama_biodata: 0,
        nama_akun: 0,
        kelas_biodata: 0,
        jk_biodata: 0,
        tgl_akun: 0,
        tgl_biodata: 0,
        konflik_lembaga: summary.konflik_lembaga
    };

    const ops = [];

    // Pass 1 — operasi level biodata (per baris penempatan; santri_biodata UNIQUE per sumber+nim)
    rows.forEach((r) => {
        const f = r.fix;
        if (f.biodataBaru) {
            ops.push({
                sql: `INSERT INTO santri_biodata (sumber, nim, nama, kelas, jenis_kelamin, status) VALUES (?, ?, ?, ?, ?, 1)`,
                args: [r.sumber, r.nim, r.name, r.class_name || null, r.jenis_kelamin || null]
            });
            applied.biodata_baru++;
        }
        if (f.namaBiodata) {
            ops.push({ sql: `UPDATE santri_biodata SET nama = ? WHERE sumber = ? AND nim = ?`, args: [r.name, r.sumber, r.nim] });
            applied.nama_biodata++;
        }
        if (f.kelasBiodata) {
            ops.push({ sql: `UPDATE santri_biodata SET kelas = ? WHERE sumber = ? AND nim = ?`, args: [r.class_name, r.sumber, r.nim] });
            applied.kelas_biodata++;
        }
        if (f.jkBiodata) {
            ops.push({ sql: `UPDATE santri_biodata SET jenis_kelamin = ? WHERE sumber = ? AND nim = ?`, args: [r.jenis_kelamin, r.sumber, r.nim] });
            applied.jk_biodata++;
        }
        if (f.tglBiodata) {
            ops.push({
                sql: `UPDATE santri_biodata SET tanggal_lahir = (SELECT tanggal_lahir FROM students WHERE nim = ? LIMIT 1) WHERE sumber = ? AND nim = ?`,
                args: [r.nim, r.sumber, r.nim]
            });
            applied.tgl_biodata++;
        }
    });

    // Pass 2 — operasi level akun (per NIM unik; students.nim UNIQUE global)
    const seenNim = new Set();
    rows.forEach((r) => {
        const f = r.fix;
        if (f.conflict) return;
        const nk = norm(r.nim).toLowerCase();
        if (seenNim.has(nk)) return;
        seenNim.add(nk);
        const stud = data.studByNim.get(nk);

        if (f.akunBaru) {
            ops.push({
                sql: `INSERT INTO students (nim, name, password, academic_year_id, jenjang_id, lembaga, tanggal_lahir)
                      VALUES (?, ?, ?, ?, ?, ?, ?)`,
                args: [r.nim, r.name, hashedPassword, r.academic_year_id, r.jenjang_id, lembagaAkunBaru(s), r.bioTgl || null]
            });
            applied.akun_baru++;
            // Link akun baru ke santri_penempatan (subquery aman — INSERT berjalan lebih dulu dlm transaksi)
            ops.push({
                sql: `UPDATE santri_penempatan SET student_id = (SELECT id FROM students WHERE nim = ? LIMIT 1) WHERE id = ? AND student_id IS NULL`,
                args: [r.nim, r.id]
            });
            applied.link++;
        } else if (f.link && stud) {
            ops.push({
                sql: `UPDATE santri_penempatan SET student_id = ? WHERE id = ?`,
                args: [stud.id, r.id]
            });
            applied.link++;
        }
        if (f.namaAkun && stud) {
            ops.push({ sql: `UPDATE students SET name = ? WHERE id = ?`, args: [r.name, stud.id] });
            applied.nama_akun++;
        }
        if (f.tglAkun && stud) {
            ops.push({
                sql: `UPDATE students SET tanggal_lahir = (SELECT tanggal_lahir FROM santri_biodata WHERE sumber = ? AND nim = ? LIMIT 1) WHERE id = ?`,
                args: [r.sumber, r.nim, stud.id]
            });
            applied.tgl_akun++;
        }
    });

    if (ops.length) await db.batch(ops, 'write');

    const total_diperbaiki = applied.biodata_baru + applied.akun_baru + applied.link
        + applied.nama_biodata + applied.nama_akun + applied.kelas_biodata
        + applied.jk_biodata + applied.tgl_akun + applied.tgl_biodata;

    return { lembaga: s.lembaga, total_diperbaiki, applied, summary, orphans };
};