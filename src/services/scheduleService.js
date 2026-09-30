import db from '../config/db.js';

// Error khusus untuk bentrok jadwal (409 Conflict)
export class ScheduleConflictError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ScheduleConflictError';
    }
}

// Overlap waktu: A mulai sebelum B selesai DAN A selesai setelah B mulai (format HH:MM pad zero)
const timeOverlap = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && aEnd > bStart;

// 1. AMBIL JADWAL MENGAJAR GURU HARI INI (Utama maupun Piket)
export const getTeacherScheduleTodayService = async (teacherId, dayName, lembaga = 'ALL') => {
    const l = (lembaga || 'ALL').toUpperCase();
    const whereLembaga = l === 'ALL' ? '' : 'AND LOWER(s.lembaga) IN (LOWER(?), LOWER(?))';
    const isTpq = l === 'TPQ';
    const isMadrasah = l === 'MADRASAH';
    const isAll = l === 'ALL';

    // Kelas kini satu tabel `classes` (id unik global) — join tunggal
    const kelasJoin = isAll
        ? `LEFT JOIN classes c ON s.classroom_id = c.id`
        : `INNER JOIN classes c ON s.classroom_id = c.id`;

    const classNameSelect = 'c.class_name';

    const query = `
        SELECT s.id as schedule_id, sub.subject_name, s.day_of_week, s.start_time, s.end_time, s.session_name, COALESCE(s.jp,1) as jp,
               s.classroom_id, ${classNameSelect},
               s.jenjang_id, s.rombel_id,
               s.subject_id,
               s.teacher_id as main_teacher_id, t1.name as main_teacher_name,
               s.substitute_teacher_id, t2.name as substitute_teacher_name,
               CASE 
                    WHEN s.substitute_teacher_id = ? THEN 'PIKET'
                    ELSE 'UTAMA'
               END as teaching_status
        FROM schedules s
        ${kelasJoin}
        INNER JOIN teachers t1 ON s.teacher_id = t1.id
        LEFT JOIN teachers t2 ON s.substitute_teacher_id = t2.id
        LEFT JOIN subjects sub ON s.subject_id = sub.id
        WHERE (s.teacher_id = ? OR s.substitute_teacher_id = ?) 
          AND s.day_of_week = ?
          ${whereLembaga}
        ORDER BY s.start_time ASC
    `;

    const args = l === 'ALL'
        ? [teacherId, teacherId, teacherId, dayName.toUpperCase()]
        : [teacherId, teacherId, teacherId, dayName.toUpperCase(), l, 'ALL'];
    const result = await db.execute({ sql: query, args });

    return result.rows;
};

export const getSchedules = async (tahunId, hariName, lembaga = 'ALL') => {
   const l = (lembaga || 'ALL').toUpperCase();
   const whereLembaga = l === 'ALL' ? '' : 'AND LOWER(s.lembaga) IN (LOWER(?), LOWER(?))';
   const isTpq = l === 'TPQ';
   const isMadrasah = l === 'MADRASAH';
   const isAll = l === 'ALL';

   const kelasJoin = isAll
       ? `LEFT JOIN classes c ON s.classroom_id = c.id`
       : `LEFT JOIN classes c ON s.classroom_id = c.id`;

   const classNameExpr = 'c.class_name';

    const query = `SELECT 
      s.id AS schedule_id,
      s.academic_year_id,
      s.classroom_id,
      s.jenjang_id,
      s.rombel_id,
      s.subject_id,
      s.day_of_week,
      s.start_time,
      s.end_time,
      s.session_name,
      COALESCE(s.jp,1) as jp,
      s.teacher_id,
      s.substitute_teacher_id,
      
      t1.name AS main_teacher_name,
      t2.name AS substitute_teacher_name,
      
      sub.subject_name,
      
      ${classNameExpr} AS class_name,
      
      ${classNameExpr} AS class_name_full
      
    FROM schedules s
    LEFT JOIN teachers t1 ON s.teacher_id = t1.id
    LEFT JOIN teachers t2 ON s.substitute_teacher_id = t2.id
    LEFT JOIN subjects sub ON s.subject_id = sub.id
    ${kelasJoin}
    
    WHERE  s.academic_year_id = ?
    ${whereLembaga}
    ORDER BY s.start_time ASC
  `;

    const args = l === 'ALL' ? [tahunId] : [tahunId, l, 'ALL'];
    const result = await db.execute({
        sql: query,
        args
    });

    return result.rows;
};

// Urutan pekan (SENIN → AHAD) utk pengelompokan jadwal sepekan — selaras dgn tampilan jadwal santri
const WEEKDAY_ORDER_CASE = `
    CASE s.day_of_week
        WHEN 'SENIN' THEN 0 WHEN 'SELASA' THEN 1 WHEN 'RABU' THEN 2 WHEN 'KAMIS' THEN 3
        WHEN 'JUMAT' THEN 4 WHEN 'SABTU' THEN 5 WHEN 'AHAD' THEN 6
    ELSE 7 END`;

// JADWAL MENGAJAR GURU SEMINGGU (Utama maupun Piket — SENIN s.d. AHAD)
export const getTeacherScheduleWeeklyService = async (teacherId, lembaga = 'ALL') => {
    const l = (lembaga || 'ALL').toUpperCase();
    const whereLembaga = l === 'ALL' ? '' : 'AND LOWER(s.lembaga) IN (LOWER(?), LOWER(?))';
    const isAll = l === 'ALL';

    const kelasJoin = isAll
        ? `LEFT JOIN classes c ON s.classroom_id = c.id`
        : `INNER JOIN classes c ON s.classroom_id = c.id`;

    const query = `
        SELECT s.id as schedule_id, sub.subject_name, s.day_of_week, s.start_time, s.end_time, s.session_name, COALESCE(s.jp,1) as jp,
               s.classroom_id, c.class_name,
               s.jenjang_id, s.rombel_id,
               s.subject_id, r.nama_rombel,
               s.teacher_id as main_teacher_id, t1.name as main_teacher_name,
               s.substitute_teacher_id, t2.name as substitute_teacher_name,
               CASE 
                    WHEN s.substitute_teacher_id = ? THEN 'PIKET'
                    ELSE 'UTAMA'
               END as teaching_status
        FROM schedules s
        ${kelasJoin}
        INNER JOIN teachers t1 ON s.teacher_id = t1.id
         LEFT JOIN rombels r ON s.rombel_id = r.id
        LEFT JOIN teachers t2 ON s.substitute_teacher_id = t2.id
       
        LEFT JOIN subjects sub ON s.subject_id = sub.id
        WHERE (s.teacher_id = ? OR s.substitute_teacher_id = ?) 
        ${whereLembaga}
        ORDER BY ${WEEKDAY_ORDER_CASE}, s.start_time ASC
    `;

    const args = l === 'ALL'
        ? [teacherId, teacherId, teacherId]
        : [teacherId, teacherId, teacherId, l, 'ALL'];
    const result = await db.execute({ sql: query, args });

    return result.rows;
};

// SEMUA JADWAL SEMINGGU (Dashboard Admin). teacherId opsional → hanya jadwal guru tsb.
export const getAllWeekSchedulesService = async (lembaga = 'ALL', teacherId = null) => {
    const l = (lembaga || 'ALL').toUpperCase();
    const whereLembaga = l === 'ALL' ? '' : 'AND LOWER(s.lembaga) IN (LOWER(?), LOWER(?))';
    const isAll = l === 'ALL';
    const isFiltered = Number.isInteger(teacherId) && teacherId > 0;

    const kelasJoin = isAll
        ? `LEFT JOIN classes c ON s.classroom_id = c.id`
        : `INNER JOIN classes c ON s.classroom_id = c.id`;

    const teacherWhere = isFiltered
        ? 'AND (s.teacher_id = ? OR s.substitute_teacher_id = ?)'
        : '';
    const statusExpr = isFiltered
        ? `CASE WHEN s.substitute_teacher_id = ? THEN 'PIKET' ELSE 'UTAMA' END`
        : `CASE WHEN s.substitute_teacher_id IS NOT NULL THEN 'PIKET' ELSE 'UTAMA' END`;

    const query = `
        SELECT s.id as schedule_id, sub.subject_name, s.day_of_week, s.start_time, s.end_time, s.session_name, COALESCE(s.jp,1) as jp,
               s.classroom_id, c.class_name,
               s.jenjang_id, s.rombel_id,
               s.subject_id,
               s.teacher_id as main_teacher_id, t1.name as main_teacher_name,
               s.substitute_teacher_id, t2.name as substitute_teacher_name,
               r.nama_rombel as rombel_name,
               ${statusExpr} as teaching_status
        FROM schedules s
        ${kelasJoin}
        INNER JOIN teachers t1 ON s.teacher_id = t1.id
        LEFT JOIN teachers t2 ON s.substitute_teacher_id = t2.id
        LEFT JOIN subjects sub ON s.subject_id = sub.id
        LEFT JOIN rombels r ON s.rombel_id = r.id
        WHERE 1 = 1
        ${teacherWhere}
        ${whereLembaga}
        ORDER BY ${WEEKDAY_ORDER_CASE}, s.start_time ASC
    `;

    let args;
    if (isFiltered) {
        args = l === 'ALL'
            ? [teacherId, teacherId, teacherId]
            : [teacherId, teacherId, teacherId, l, 'ALL'];
    } else {
        args = l === 'ALL' ? [] : [l, 'ALL'];
    }
    const result = await db.execute({ sql: query, args });

    return result.rows;
};

// AMBIL SEMUA JADWAL HARI INI (Untuk Dashboard Admin)
export const getAllTodaySchedulesService = async (dayName, lembaga = 'ALL') => {
    const l = (lembaga || 'ALL').toUpperCase();
    const whereLembaga = l === 'ALL' ? '' : 'AND LOWER(s.lembaga) IN (LOWER(?), LOWER(?))';
    const isTpq = l === 'TPQ';
    const isMadrasah = l === 'MADRASAH';
    const isAll = l === 'ALL';

    const kelasJoin = isAll
        ? `LEFT JOIN classes c ON s.classroom_id = c.id`
        : `INNER JOIN classes c ON s.classroom_id = c.id`;

    const classNameSelect = 'c.class_name';

    const query = `
        SELECT s.id as schedule_id, sub.subject_name, s.day_of_week, s.start_time, s.end_time, s.session_name, COALESCE(s.jp,1) as jp,
               s.classroom_id, ${classNameSelect},
               s.jenjang_id, s.rombel_id,
               s.subject_id,
               s.teacher_id as main_teacher_id, t1.name as main_teacher_name,
               s.substitute_teacher_id, t2.name as substitute_teacher_name,
               CASE 
                    WHEN s.substitute_teacher_id IS NOT NULL THEN 'PIKET'
                    ELSE 'UTAMA'
               END as teaching_status
        FROM schedules s
        ${kelasJoin}
        INNER JOIN teachers t1 ON s.teacher_id = t1.id
        LEFT JOIN teachers t2 ON s.substitute_teacher_id = t2.id
        LEFT JOIN subjects sub ON s.subject_id = sub.id
        WHERE s.day_of_week = ?
        ${whereLembaga}
        ORDER BY s.start_time ASC
    `;

    const args = l === 'ALL' ? [dayName.toUpperCase()] : [dayName.toUpperCase(), l, 'ALL'];
    const result = await db.execute({ sql: query, args });

    return result.rows;
};

// 2. PLOT GURU PIKET / GURU PENGGANTI (Oleh Admin atau Koordinator Piket)
export const assignSubstituteTeacherService = async (scheduleId, substituteTeacherId) => {
    // 🌟 Cek bentrok: guru piket tidak boleh sudah mengajar di jam yang sama (hari sama)
    if (substituteTeacherId) {
        const sched = await db.execute({
            sql: 'SELECT day_of_week, start_time, end_time, teacher_id, lembaga FROM schedules WHERE id = ?',
            args: [scheduleId]
        });
        if (sched.rows.length > 0) {
            const s = sched.rows[0];
            const result = await db.execute({
                sql: `SELECT s.id, sub.subject_name, s.start_time, s.end_time, s.session_name
                      FROM schedules s
                      LEFT JOIN subjects sub ON s.subject_id = sub.id
                      WHERE s.id != ? AND s.day_of_week = ?
                        AND (s.teacher_id = ? OR s.substitute_teacher_id = ?)
                        AND s.start_time < ? AND s.end_time > ?
                        AND s.lembaga IN (?, ?)`,
                args: [scheduleId, s.day_of_week, substituteTeacherId, substituteTeacherId, s.end_time, s.start_time, s.lembaga, 'ALL']
            });
            if (result.rows.length > 0) {
                const c = result.rows[0];
                throw new ScheduleConflictError(
                    `Bentrok jadwal! Guru piket sudah mengajar ${c.subject_name || ''} (${c.session_name || ''}) ` +
                    `pukul ${c.start_time}–${c.end_time} pada hari ${s.day_of_week}.`
                );
            }
        }
    }
    const query = `
        UPDATE schedules 
        SET substitute_teacher_id = ? 
        WHERE id = ?
    `;
    await db.execute({
        sql: query,
        args: [substituteTeacherId || null, scheduleId] // Jika substituteTeacherId null, berarti guru utama kembali mengajar
    });
    return { schedule_id: scheduleId, substitute_teacher_id: substituteTeacherId };
};


// ==========================================
// 2. SERVICE (scheduleService.js)
// ==========================================
export const createNewScheduleService = async (payload, lembaga = 'ALL') => {
  const l = (lembaga || 'ALL').toUpperCase();
  const jp = Number(payload.jp ?? payload.jumlah_jam ?? 1);
  if (!Number.isInteger(jp) || jp < 1 || jp > 4) {
    throw new Error('Jumlah JP harus berupa angka bulat 1-4');
  }

  // DETEKSI BENTROK JADWAL
  await assertNoConflictService({
    academic_year_id: payload.academic_year_id,
    classroom_id: payload.classroom_id,
    teacher_id: payload.main_teacher_id,
    rombel_id: payload.rombel_id,
    day_of_week: payload.day_of_week,
    start_time: payload.start_time,
    end_time: payload.end_time,
    excludeScheduleId: payload.exclude_schedule_id,
    lembaga: l
  });

  const sql = `
    INSERT INTO schedules 
    (academic_year_id, jenjang_id, rombel_id, classroom_id, subject_id, day_of_week, start_time, end_time, teacher_id, session_name, lembaga, jp) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  
  try {
    const result = await db.execute(sql, [
      payload.academic_year_id, 
      payload.jenjang_id || null, 
      payload.rombel_id || null, 
      payload.classroom_id, 
      payload.subject_id, 
      payload.day_of_week, 
      payload.start_time, 
      payload.end_time, 
      payload.main_teacher_id, 
      payload.session_name || 'Sesi Pelajaran',
      l,
      jp
    ]);
    
    return result; 
  } catch (err) {
    if (err instanceof ScheduleConflictError) throw err;
    throw new Error("Gagal menyimpan jadwal ke database: " + err.message);
  }
};

// Ubah jadwal pelajaran yang sudah ada (set kolom dinamis — hanya yang dikirim).
// Pemeriksaan bentrok tetap dijalankan dengan mengecualikan jadwal yang sedang diedit.
export const updateScheduleService = async (id, payload, lembaga = 'ALL') => {
  const l = (lembaga || 'ALL').toUpperCase();
  const scheduleId = Number(id);

  if (!Number.isFinite(scheduleId)) {
    throw new Error('ID jadwal tidak valid.');
  }

  const existing = await db.execute({
    sql: 'SELECT * FROM schedules WHERE id = ?',
    args: [scheduleId]
  });
  if (existing.rows.length === 0) {
    throw new Error('Jadwal pelajaran tidak ditemukan.');
  }

  const cur = existing.rows[0];
  const rawJp = payload.jp ?? payload.jumlah_jam ?? cur.jp ?? 1;
  const jpFinal = Number(rawJp);
  if (!Number.isInteger(jpFinal) || jpFinal < 1 || jpFinal > 4) throw new Error('Jumlah JP harus integer 1-4');
  const final = {
    academic_year_id: payload.academic_year_id ?? cur.academic_year_id,
    jenjang_id: payload.jenjang_id ?? cur.jenjang_id,
    rombel_id: payload.rombel_id ?? cur.rombel_id,
    classroom_id: payload.classroom_id ?? cur.classroom_id,
    subject_id: payload.subject_id ?? cur.subject_id,
    day_of_week: (payload.day_of_week || cur.day_of_week || '').toUpperCase(),
    start_time: payload.start_time ?? cur.start_time,
    end_time: payload.end_time ?? cur.end_time,
    main_teacher_id: payload.main_teacher_id ?? cur.teacher_id,
    session_name: payload.session_name ?? cur.session_name,
    jp: jpFinal
  };

  // Validasi input wajib (sama dgn create)
  if (!final.classroom_id || !final.subject_id || !final.day_of_week || !final.start_time || !final.end_time || !final.main_teacher_id) {
    throw new Error('Semua kolom jadwal wajib diisi!');
  }

  // Cek bentrok, kecualikan jadwal yang sedang diubah
  await assertNoConflictService({
    classroom_id: final.classroom_id,
    teacher_id: final.main_teacher_id,
    rombel_id: final.rombel_id,
    day_of_week: final.day_of_week,
    start_time: final.start_time,
    end_time: final.end_time,
    excludeScheduleId: scheduleId,
    lembaga: l
  });

  const setCols = [
    'academic_year_id',
    'jenjang_id',
    'rombel_id',
    'classroom_id',
    'subject_id',
    'day_of_week',
    'start_time',
    'end_time',
    'teacher_id',
    'session_name',
    'jp'
  ];
  const args = setCols.map(col => {
    if (col === 'teacher_id') return final.main_teacher_id;
    if (col === 'jp') return final.jp;
    return final[col];
  });

  const sql = `
    UPDATE schedules
    SET ${setCols.map(c => `${c} = ?`).join(', ')}
    WHERE id = ?
  `;

  try {
    const result = await db.execute({ sql, args: [...args, scheduleId] });
    return result;
  } catch (err) {
    if (err instanceof ScheduleConflictError) throw err;
    throw new Error('Gagal memperbarui jadwal: ' + err.message);
  }
};

// ============================================================================
// DETEKSI BENTROK JADWAL (T3.7)
// ============================================================================

// Cek bentrok sebelum insert/update satu jadwal. Lempar ScheduleConflictError bila bentrok.
// Rombel = pembeda jadwal: kelas sama TAPI rombel berbeda (keduanya non-NULL & beda) TIDAK bentrok.
// NULL rombel dianggap "tak terbedakan" (konservatif): bentrok bila salah satu/bisa keduanya NULL.
export const assertNoConflictService = async ({ classroom_id, teacher_id, day_of_week, start_time, end_time, rombel_id, excludeScheduleId, lembaga = 'ALL' }) => {
    const l = (lembaga || 'ALL').toUpperCase();
    const whereLembaga = l === 'ALL' ? '' : 'AND LOWER(lembaga) IN (LOWER(?), LOWER(?))';
    const argsBase = l === 'ALL' ? [] : [l, 'ALL'];

    if (!classroom_id || !teacher_id || !day_of_week || !start_time || !end_time) {
        throw new ScheduleConflictError('Data jadwal tidak lengkap untuk pemeriksaan bentrok.');
    }

    // 1. Bentrok KELAS: kelas sama, rombel tak terbedakan, hari sama, waktu tumpang tindih
    const kelasQuery = `
        SELECT s.id, s.subject_id, sub.subject_name, s.teacher_id, t.name AS teacher_name,
               s.start_time, s.end_time, s.session_name
        FROM schedules s
        LEFT JOIN subjects sub ON s.subject_id = sub.id
        LEFT JOIN teachers t ON s.teacher_id = t.id
        WHERE s.classroom_id = ? AND s.day_of_week = ? 
          AND s.start_time < ? AND s.end_time > ?
          AND (s.rombel_id IS NULL OR ? IS NULL OR s.rombel_id = ?)
          ${excludeScheduleId ? 'AND s.id != ?' : ''}
          ${whereLembaga}
        ORDER BY s.start_time ASC
    `;
    const kelasArgs = [classroom_id, day_of_week.toUpperCase(), end_time, start_time, rombel_id ?? null, rombel_id ?? null];
    if (excludeScheduleId) kelasArgs.push(Number(excludeScheduleId));
    kelasArgs.push(...argsBase);
    const kelasResult = await db.execute({ sql: kelasQuery, args: kelasArgs });

    if (kelasResult.rows.length > 0) {
        const c = kelasResult.rows[0];
        throw new ScheduleConflictError(
            `Bentrok jadwal! Kelas sudah terjadwal ${c.subject_name || 'Mapel'} (${c.session_name || ''}) ` +
            `pukul ${c.start_time}–${c.end_time} pada hari ${day_of_week.toUpperCase()}.`
        );
    }

    // 2. Bentrok GURU: guru yang sama (utama maupun piket) mengajar di jam sama
    const guruQuery = `
        SELECT s.id, s.subject_id, sub.subject_name, s.classroom_id, s.start_time, s.end_time, s.session_name, s.lembaga
        FROM schedules s
        LEFT JOIN subjects sub ON s.subject_id = sub.id
        WHERE s.day_of_week = ? 
          AND (s.teacher_id = ? OR s.substitute_teacher_id = ?)
          AND s.start_time < ? AND s.end_time > ?
          ${excludeScheduleId ? 'AND s.id != ?' : ''}
          ${whereLembaga}
        ORDER BY s.start_time ASC
    `;
    const guruArgs = [day_of_week.toUpperCase(), teacher_id, teacher_id, end_time, start_time];
    if (excludeScheduleId) guruArgs.push(Number(excludeScheduleId));
    guruArgs.push(...argsBase);
    const guruResult = await db.execute({ sql: guruQuery, args: guruArgs });

    if (guruResult.rows.length > 0) {
        const g = guruResult.rows[0];
        throw new ScheduleConflictError(
            `Bentrok jadwal! Guru sudah mengajar ${g.subject_name || ''} (${g.session_name || ''}) ` +
            `pukul ${g.start_time}–${g.end_time} pada hari ${day_of_week.toUpperCase()} di kelas lain.`
        );
    }

    return { ok: true };
};

// Rombel dianggap "tak terbedakan" bila salah satu NULL (konservatif) atau sama persis.
const rombelTakTerbedakan = (r1, r2) => r1 == null || r2 == null || r1 === r2;

// Scan seluruh jadwal satu tahun ajaran: temukan & kembalikan pasangan jadwal yang bentrok (kelas & guru)
export const detectScheduleConflictsService = async (tahunId, lembaga = 'ALL') => {
    const all = await getSchedules(tahunId, null, lembaga);
    const rows = all.map(r => ({
        ...r,
        teacher_ids: new Set([r.teacher_id, r.substitute_teacher_id].filter(Boolean))
    }));

    const classConflicts = [];
    const teacherConflicts = [];
    const seenPairs = new Set();

    for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
            const a = rows[i];
            const b = rows[j];
            if (a.day_of_week !== b.day_of_week) continue;
            if (!timeOverlap(a.start_time, a.end_time, b.start_time, b.end_time)) continue;

            const pairKey = [a.schedule_id, b.schedule_id].sort((x, y) => x - y).join('-');
            if (seenPairs.has(pairKey)) continue;

            // Kelas sama HANYA bila rombel tak terbedakan (rombel = pembeda jadwal)
            const classSame = a.classroom_id === b.classroom_id && rombelTakTerbedakan(a.rombel_id, b.rombel_id);
            const teacherSame = [...a.teacher_ids].some(id => b.teacher_ids.has(id));

            if (classSame || teacherSame) {
                seenPairs.add(pairKey);
                const conflict = {
                    schedule_a: a,
                    schedule_b: b,
                    types: [
                        classSame ? 'KELAS' : null,
                        teacherSame ? 'GURU' : null
                    ].filter(Boolean)
                };
                if (classSame) classConflicts.push(conflict);
                if (teacherSame) teacherConflicts.push(conflict);
            }
        }
    }

    return {
        academic_year_id: Number(tahunId),
        total_conflicts: seenPairs.size,
        class_conflicts: classConflicts,
        teacher_conflicts: teacherConflicts
    };
};