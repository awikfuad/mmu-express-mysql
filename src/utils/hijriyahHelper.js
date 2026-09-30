// Helper konversi kalender Masehi <-> Hijriyah (kalender Islam aritmatik/tabular).
// Konversi Masehi -> Hijriyah memakai Intl (kalender islamic-umalqura),
// sehingga seragam dengan tampilan tanggal Hijriyah di browser.

const BULAN_HIJRIYAH = [
  'Muharram',
  'Safar',
  'Rabiul Awal',
  'Rabiul Akhir',
  'Jumadil Awal',
  'Jumadil Akhir',
  'Rajab',
  "Sya'ban",
  'Ramadhan',
  'Syawal',
  "Dzulqa'dah",
  'Dzulhijjah'
];

const CALENDAR = 'islamic-umalqura';

function parseISO(dateStr) {
  if (typeof dateStr !== 'string') return null;
  const m = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // pastikan tidak bergeser (mis. 2026-02-30)
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

function toISO(dt) {
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

function formatHijriParts(dt) {
  const tryCalendars = ['islamic-umalqura', 'islamic-civil', 'islamic'];
  for (const cal of tryCalendars) {
    try {
      const parts = new Intl.DateTimeFormat(`en-US-u-ca-${cal}`, {
        day: 'numeric',
        month: 'numeric',
        year: 'numeric'
      }).formatToParts(dt);
      const map = {};
      for (const p of parts) map[p.type] = p.value;
      if (map.day && map.month && map.year) {
        return { day: Number(map.day), month: Number(map.month), year: Number(map.year) };
      }
    } catch (e) {
      // coba kalender berikutnya
    }
  }
  return null;
}

// Masehi 'YYYY-MM-DD' -> Hijriyah { day, month, year, monthName, full }
export function masehiToHijri(dateStr) {
  const dt = parseISO(dateStr);
  if (!dt) return null;
  const h = formatHijriParts(dt);
  if (!h) return null;
  const monthName = BULAN_HIJRIYAH[(h.month - 1 + 12) % 12] || `Bulan ${h.month}`;
  return {
    day: h.day,
    month: h.month,
    year: h.year,
    monthName,
    full: `${h.day} ${monthName} ${h.year} H`
  };
}

// Cari tanggal Masehi untuk tanggal Hijriyah (1 .. d) pada bulan/tahun tertentu.
// Estimasi kasar lalu scan harian — akurasi konsisten dgn masehiToHijri.
export function hijriToMasehi(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 30) return null;
  const gYearEst = Math.floor((year * 32) / 33) + 622 - 1;
  const start = new Date(Date.UTC(gYearEst - 1, 6, 1));
  const end = new Date(Date.UTC(gYearEst + 2, 6, 1));
  const MS = 86400000;
  for (let cursor = start.getTime(); cursor < end.getTime(); cursor += MS) {
    const iso = toISO(new Date(cursor));
    const h = masehiToHijri(iso);
    if (h && h.year === year && h.month === month && h.day === day) return iso;
  }
  return null;
}

// Daftar hari Masehi yang menutupi satu bulan Hijriyah (bulan ke-`month` tahun `year`).
export function hijriMonthDays(year, month) {
  if (!Number.isInteger(year) || year < 1) return [];
  if (!Number.isInteger(month) || month < 1 || month > 12) return [];
  const firstISO = hijriToMasehi(year, month, 1);
  if (!firstISO) return [];
  const days = [];
  const cursor = parseISO(firstISO);
  const MS = 86400000;
  let t = cursor.getTime();
  let guard = 0;
  while (guard < 40) {
    const iso = toISO(new Date(t));
    const h = masehiToHijri(iso);
    if (!h || h.year !== year || h.month !== month) break;
    const d = new Date(t);
    const weekday = ['MINGGU', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'][d.getUTCDay()];
    days.push({ date: iso, hijri_day: h.day, weekday });
    t += MS;
    guard++;
  }
  return days;
}

// '2025/2026' -> '1447/1448' (tahun pelajaran Hijriyah).
// Acuan: awal Agustus tahun Masehi pertama → tahun Hijriyah saat itu.
export function hijriahTahunPelajaran(yearName) {
  if (typeof yearName !== 'string') return '';
  const m = yearName.match(/(\d{4})/);
  if (!m) return '';
  const gYear = Number(m[1]);
  const h = masehiToHijri(`${gYear}-08-01`);
  if (!h) return '';
  return `${h.year}/${h.year + 1}`;
}

export const BULAN_HIJRIYAH_NAMES = BULAN_HIJRIYAH;
