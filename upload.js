import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import Busboy from 'busboy';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export const config = { api: { bodyParser: false } };

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', d => chunks.push(d));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function parseExcel(buffer) {
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
    survey: surveyRaw ? parseSurvey(surveyRaw)  : null,
    trucks: truckRaw  ? parseTrucks(truckRaw)   : null,
    fuel:   fuelRaw   ? parseFuel(fuelRaw)       : null,
  };
}

function parseDailyReport(rows) {
  let reportDate = '';
  for (let r = 0; r < 5 && !reportDate; r++) {
    for (let c = 0; c < 6 && !reportDate; c++) {
      const v = rows[r]?.[c];
      if (v instanceof Date) reportDate = v.toISOString().slice(0, 10);
      else if (typeof v === 'string' && v.match(/\d{4}-\d{2}-\d{2}/)) reportDate = v.slice(0, 10);
    }
  }
  const exo = [], truckDaily = [];
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
    }
  }
  return { reportDate, exo, truckDaily, totals };
}

function parseSurvey(rows) {
  const daily = [];
  for (const row of rows) {
    const d = row[0];
    let dateStr = '';
    if (d instanceof Date) dateStr = d.toISOString().slice(0, 10);
    else if (typeof d === 'string' && d.match(/\d{4}-\d{2}-\d{2}/)) dateStr = d.slice(0, 10);
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
    const reis = +row[8]||0;
    if (!seen[pk]) seen[pk] = { id: pk, reis: 0 };
    seen[pk].reis += reis;
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const bb = Busboy({ headers: req.headers });
    let fileBuffer = null;
    let filename = '';

    bb.on('file', (_, stream, info) => {
      filename = info.filename;
      streamToBuffer(stream).then(buf => { fileBuffer = buf; });
    });

    await new Promise((resolve, reject) => {
      bb.on('finish', resolve);
      bb.on('error', reject);
      req.pipe(bb);
    });

    if (!fileBuffer) return res.status(400).json({ error: 'Файл олдсонгүй' });

    const parsed = parseExcel(fileBuffer);
    const reportDate = parsed.daily.reportDate || new Date().toISOString().slice(0, 10);

    // Generate unique 6-char ID
    const id = Math.random().toString(36).slice(2, 8).toUpperCase();

    const { error } = await supabase.from('reports').insert({
      id,
      report_date: reportDate,
      filename,
      data: parsed,
      created_at: new Date().toISOString(),
    });

    if (error) throw new Error(error.message);

    return res.status(200).json({ id, reportDate, url: `/report/${id}` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
