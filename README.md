# Дархан Эрхэт Майнинг — Диспетчерийн тайлан систем

Диспетчер Excel файл upload хийхэд автоматаар тайлан үүсгэж, захиралд линк явуулна.

## Хэрхэн ажиллах вэ

1. Диспетчер `yoursite.vercel.app` руу орж Excel файл upload хийнэ
2. Систем файлыг уншиж, тайлан үүсгэнэ
3. Өвөрмөц линк (`yoursite.vercel.app/report/ABC123`) үүснэ
4. Диспетчер тэр линкийг захиралд WhatsApp/email-ээр явуулна
5. Захирал линк дарахад шууд тайлан харагдана

## Тохиргоо

### 1. Supabase тохируулах

1. [supabase.com](https://supabase.com) дээр бүртгүүлэх (үнэгүй)
2. New Project үүсгэх
3. SQL Editor дээр дараах query ажиллуулах:

```sql
create table reports (
  id text primary key,
  report_date date,
  filename text,
  data jsonb,
  created_at timestamptz default now()
);

-- 90 хоногийн дараа автоматаар устгах (сонголт)
create index on reports (created_at);
```

4. Project Settings → API дээрээс авах:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` key → `SUPABASE_SERVICE_KEY`

### 2. Vercel тохируулах

1. [vercel.com](https://vercel.com) дээр GitHub repo холбох
2. Environment Variables нэмэх:
   - `SUPABASE_URL` = `https://xxxx.supabase.co`
   - `SUPABASE_SERVICE_KEY` = `eyJhbGci...` (service_role key)
3. Deploy хийх

### 3. Vercel routing тохируулах

`vercel.json` дотор `/report/:id` URL-ийг `public/report.html` руу чиглүүлэхийн тулд
дараах мөрийг нэмэх (аль хэдийн байгаа):

```json
{ "source": "/report/:id", "destination": "/public/report.html" }
```

## Файлын бүтэц

```
├── api/
│   ├── upload.js      ← Excel хүлээн авах, parse хийх, Supabase-д хадгалах
│   ├── report.js      ← ID-аар тайлан буцаах
│   └── latest.js      ← Хамгийн сүүлийн тайлан буцаах
├── public/
│   ├── index.html     ← Диспетчерийн upload хуудас
│   └── report.html    ← Захирал харах тайлан хуудас
├── package.json
├── vercel.json
└── README.md
```

## Хүлээн авах Excel sheet-үүд

| Sheet нэр | Агуулга |
|-----------|---------|
| `DAILY REPORT pdf` | EXO, ДАМП, туслах техникийн өдрийн тайлан |
| `Survey pdf` | Маркшейдерийн хэмжилт |
| `TRUCK` | Дамп машины дэлгэрэнгүй мото цаг |
| `FUEL Filter` | Түлшний задаргаа |
