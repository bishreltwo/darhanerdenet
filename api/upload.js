const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
const Busboy = require('busboy');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase env var тохируулаагүй байна (SUPABASE_URL, SUPABASE_SERVICE_KEY)' });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    const fileBuffer = await getFileBuffer(req);
    if (!fileBuffer) return res.status(400).json({ error: 'Файл олдсонгүй' });

    const parsed = parseExcel(fileBuffer.buffer, fileBuffer.filename);
    const reportDate = parsed.daily.reportDate || new Date().toISOString().slice(0, 10);
    const id = Math.random().toString(36).slice(2, 8).toUpperCase();

    const { error } = await supabase.from('reports').insert({
      id,
      report_date: reportDate,
      filename: fileBuffer.filename,
      data: parsed,
      created_at: new Date().toISOString(),
    });

    if (error) throw new Error(error.message);

    return res.status(200).json({ id, reportDate, url: `/report/${id}` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};

function getFileBuffer(req) {
  return new Promise((resolve, reject) => {
    // Collect raw body first — Vercel may not support req.pipe() reliably
    const bodyChunks = [];
    req.on('data', chunk => bodyChunks.push(chunk));
    req.on('error', reject);
    req.on('end', () => {
      const rawBody = Buffer.concat(bodyChunks);
      if (!rawBody.length) return resolve(null);

      const bb = Busboy({ headers: req.headers });
      let result = null;
      bb.on('file', (field, stream, info) => {
        const chunks = [];
        stream.on('data', d => chunks.push(d));
        stream.on('end', () => { result = { buffer: Buffer.concat(chunks), filename: info.filename }; });
      });
      bb.on('finish', () => resolve(result));
      bb.on('error', reject);
      bb.write(rawBody);
      bb.end();
    });
  });
}

function parseExcel(buffer, filename) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheets = wb.SheetNames;

  const findSheet = (...names) => {
    for (const n of names) {
      const found = sheets.find(s => s.toLowerCase().includes(n.toLowerCase()));
      if (found) return XLSX.utils.sheet_to_json(wb.Sheets[found], { header: 1, defval: null });
    }
    return null;
  };

  const dailyRaw  = findSheet('DAILY REPORT');
  const surveyRaw = findSheet('Survey');
  const truckRaw  = findSheet('TRUCK');
  const fuelRaw   = findSheet('FUEL Filter');

  if (!dailyRaw) throw new Error('DAILY REPORT sheet олдсонгүй');

  return {
    daily:  parseDailyReport(dailyRaw),
    survey: surveyRaw ? parseSurvey(surveyRaw) : null,
    trucks: truckRaw  ? parseTrucks(truckRaw)  : null,
    fuel:   fuelRaw   ? parseFuel(fuelRaw)     : null,
  };
}

function excelDateToStr(v) {
  if (v instanceof Date && !isNaN(v)) {
    // getFullYear/Month/Date = local time → UTC shift нөлөөлөхгүй
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'string') {
    let t;
    // YYYY-MM-DD
    t = v.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (t) return `${t[1]}-${t[2]}-${t[3]}`;
    // DD/MM/YYYY эсвэл D/M/YYYY
    t = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (t) return `${t[3]}-${t[2].padStart(2,'0')}-${t[1].padStart(2,'0')}`;
    // YYYY.MM.DD
    t = v.match(/(\d{4})\.(\d{2})\.(\d{2})/);
    if (t) return `${t[1]}-${t[2]}-${t[3]}`;
  }
  return null;
}

function parseDailyReport(rows) {
  let reportDate = '';
  for (let r = 0; r < 8 && !reportDate; r++) {
    for (let c = 0; c < 10 && !reportDate; c++) {
      const parsed = excelDateToStr(rows[r]?.[c]);
      if (parsed) reportDate = parsed;
    }
  }
  const exo = [], auxTech = [], truckDaily = [];
  let totals = null;
  for (const row of rows) {
    const id = row[1];
    if (typeof id !== 'string') continue;
    if (id.match(/^EX-\d+/)) {
      exo.push({ id, model: row[2]||'', udur: +row[3]||0, shunu: +row[4]||0, total: +row[5]||0, cagUdur: +row[6]||0, cagShunu: +row[7]||0, fuelUdur: +row[8]||0, fuelShunu: +row[9]||0, fuelTotal: +row[10]||0 });
    } else if (id.match(/^TR-\d+/)) {
      truckDaily.push({ id, model: row[2]||'', reisUdur: +row[3]||0, reisShunu: +row[4]||0, reisTotal: (+row[3]||0)+(+row[4]||0), buteel: +row[5]||0, cagUdur: +row[6]||0, cagShunu: +row[7]||0, fuelUdur: +row[8]||0, fuelShunu: +row[9]||0, fuelTotal: +row[10]||0 });
    } else if (id === 'НИЙТ') {
      totals = { reisUdur: +row[3]||0, reisShunu: +row[4]||0, buteel: +row[5]||0, fuelUdur: +row[8]||0, fuelShunu: +row[9]||0, fuelTotal: +row[10]||0 };
    } else if (/^[A-Z]{2,4}\d{3,5}$/.test(id)) {
      const note = row[11] != null ? String(row[11]).trim() : '';
      auxTech.push({ id, model: row[2]||'', cagUdur: +row[6]||0, cagShunu: +row[7]||0, fuelUdur: +row[8]||0, fuelShunu: +row[9]||0, fuelTotal: +row[10]||0, note });
    }
  }
  return { reportDate, exo, auxTech, truckDaily, totals };
}

function parseSurvey(rows) {
  const daily = [];
  for (const row of rows) {
    const d = row[0];
    let dateStr = '';
    dateStr = excelDateToStr(d) || '';
    if (!dateStr) continue;
    const dispTotal = (+row[1]||0) + (+row[3]||0);
    const survMark  = +row[7] || null;
    const cumDisp   = +row[8] || 0;
    const diff      = +row[9] || 0;
    const diffPct   = +row[10] || 0;
    if (cumDisp > 0 || dispTotal > 0) daily.push({ dateStr, dispTotal, survMark, cumDisp, diff, diffPct });
  }
  return daily;
}

function parseTrucks(rows) {
  const seen = {};
  for (const row of rows) {
    if (!(row[0] instanceof Date)) continue;
    const pk = row[5];
    if (!pk || typeof pk !== 'string' || !pk.match(/TR-\d+/)) continue;
    if (!seen[pk]) seen[pk] = { id: pk, reis: 0 };
    seen[pk].reis += (+row[8]||0);
  }
  return Object.values(seen);
}

function parseFuel(rows) {
  let totUdur = 0, totShunu = 0;
  for (const row of rows) {
    if (String(row[1]||'').trim() === 'нийт') {
      totUdur  = +row[2]||0;
      totShunu = +row[8]||0;
      break;
    }
  }
  return { totUdur, totShunu, total: totUdur + totShunu };
}
