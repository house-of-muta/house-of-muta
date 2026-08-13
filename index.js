require('dotenv').config();

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const cron = require('node-cron');
const ExcelJS = require('exceljs');
const vision = require('@google-cloud/vision');
const { google } = require('googleapis');
const OpenAI = require('openai');
const line = require('@line/bot-sdk');

const PORT = Number(process.env.PORT || 3000);
const EXCEL_YEAR = Number(process.env.EXCEL_YEAR || 2026);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const EXCEL_DIR = path.join(ROOT, 'excel');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const WORKBOOK_FILENAME = `FarmBook_${EXCEL_YEAR}.xlsx`;
const WORKBOOK_PATH = path.join(EXCEL_DIR, WORKBOOK_FILENAME);
const REGISTRY_PATH = path.join(DATA_DIR, 'registry.json');
const SESSION_PATH = path.join(DATA_DIR, 'sessions.json');
const LEARNING_RULES_PATH = path.join(DATA_DIR, 'learningRules.json');
const DRIVE_STATE_PATH = path.join(DATA_DIR, 'driveWorkbook.json');

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || process.env.LINE_ACCESS_TOKEN || '',
  channelSecret: process.env.LINE_CHANNEL_SECRET || '',
};

const lineClient = new line.messagingApi.MessagingApiClient({
  channelAccessToken: lineConfig.channelAccessToken,
});

const blobClient = new line.messagingApi.MessagingApiBlobClient({
  channelAccessToken: lineConfig.channelAccessToken,
});

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

function readGoogleCredentialsFromEnv() {
  const rawCredential =
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON_BASE64
      ? Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON_BASE64.trim(), 'base64').toString('utf8')
      : process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

  if (!rawCredential) return null;

  let raw = rawCredential.trim();
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
    raw = raw.slice(1, -1);
  }

  let credentials = JSON.parse(raw);
  if (typeof credentials === 'string') credentials = JSON.parse(credentials);

  if (credentials.private_key) {
    credentials.private_key = credentials.private_key
      .replace(/\\n/g, '\n')
      .replace(/\r\n/g, '\n')
      .trim();
    if (!credentials.private_key.endsWith('\n')) credentials.private_key += '\n';
  }

  return credentials;
}

function createVisionClient() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON_BASE64 || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    try {
      const credentials = readGoogleCredentialsFromEnv();
      const keyFile = path.join(os.tmpdir(), 'muta-farm-google-vision-key.json');
      fs.writeFileSync(keyFile, JSON.stringify(credentials), { mode: 0o600 });
      return new vision.ImageAnnotatorClient({ keyFilename: keyFile });
    } catch (e) {
      log('Google Vision credentials env is invalid:', e.message);
    }
  }

  if (
    process.env.GOOGLE_APPLICATION_CREDENTIALS &&
    fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)
  ) {
    return new vision.ImageAnnotatorClient();
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    log(`GOOGLE_APPLICATION_CREDENTIALS was ignored because the file does not exist: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);
  }

  return null;
}

const visionClient = createVisionClient();

let driveClientPromise = null;
let driveDownloadChecked = false;

function escapeDriveQueryValue(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function createGoogleAuth(scopes) {
  try {
    const credentials = readGoogleCredentialsFromEnv();
    if (credentials) {
      return new google.auth.GoogleAuth({ credentials, scopes });
    }
  } catch (e) {
    log('Google credentials env is invalid for Drive:', e.message);
  }

  if (
    process.env.GOOGLE_APPLICATION_CREDENTIALS &&
    fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)
  ) {
    return new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes,
    });
  }

  return null;
}

async function getDriveClient() {
  if (process.env.GOOGLE_DRIVE_ENABLED === 'false') return null;
  if (!driveClientPromise) {
    driveClientPromise = (async () => {
      const auth = createGoogleAuth(['https://www.googleapis.com/auth/drive.file']);
      if (!auth) return null;
      return google.drive({ version: 'v3', auth });
    })();
  }
  return driveClientPromise;
}

async function findDriveWorkbookFileId(drive) {
  if (process.env.GOOGLE_DRIVE_FILE_ID) return process.env.GOOGLE_DRIVE_FILE_ID;

  const state = await readJson(DRIVE_STATE_PATH, {});
  if (state.fileId) {
    try {
      await drive.files.get({ fileId: state.fileId, fields: 'id,name,trashed' });
      return state.fileId;
    } catch (e) {
      log('Stored Drive file id was not usable:', e.message);
    }
  }

  const escapedName = escapeDriveQueryValue(WORKBOOK_FILENAME);
  const clauses = [
    `name='${escapedName}'`,
    `mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'`,
    'trashed=false',
  ];
  if (process.env.GOOGLE_DRIVE_FOLDER_ID) {
    clauses.push(`'${escapeDriveQueryValue(process.env.GOOGLE_DRIVE_FOLDER_ID)}' in parents`);
  }

  const result = await drive.files.list({
    q: clauses.join(' and '),
    fields: 'files(id,name,modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const fileId = result.data.files?.[0]?.id || '';
  if (fileId) await writeJson(DRIVE_STATE_PATH, { fileId, fileName: WORKBOOK_FILENAME });
  return fileId;
}

async function downloadWorkbookFromDriveIfNeeded() {
  if (driveDownloadChecked || fs.existsSync(WORKBOOK_PATH)) return;
  driveDownloadChecked = true;

  const drive = await getDriveClient();
  if (!drive) return;

  try {
    const fileId = await findDriveWorkbookFileId(drive);
    if (!fileId) return;
    await ensureDir(EXCEL_DIR);
    const response = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' }
    );
    await pipeline(response.data, fs.createWriteStream(WORKBOOK_PATH));
    log(`Downloaded workbook from Google Drive: ${WORKBOOK_FILENAME}`);
  } catch (e) {
    log('Google Drive workbook download skipped:', e.message);
  }
}

async function uploadWorkbookToDrive() {
  const drive = await getDriveClient();
  if (!drive || !fs.existsSync(WORKBOOK_PATH)) return false;

  try {
    const fileId = await findDriveWorkbookFileId(drive);
    const media = {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: fs.createReadStream(WORKBOOK_PATH),
    };

    if (fileId) {
      await drive.files.update({
        fileId,
        media,
        fields: 'id,name,modifiedTime',
        supportsAllDrives: true,
      });
      log(`Updated Google Drive workbook: ${WORKBOOK_FILENAME}`);
      return true;
    }

    const requestBody = {
      name: WORKBOOK_FILENAME,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    if (process.env.GOOGLE_DRIVE_FOLDER_ID) {
      requestBody.parents = [process.env.GOOGLE_DRIVE_FOLDER_ID];
    }

    const created = await drive.files.create({
      requestBody,
      media,
      fields: 'id,name,modifiedTime',
      supportsAllDrives: true,
    });
    await writeJson(DRIVE_STATE_PATH, { fileId: created.data.id, fileName: WORKBOOK_FILENAME });
    log(`Created Google Drive workbook: ${WORKBOOK_FILENAME}`);
    return true;
  } catch (e) {
    log('Google Drive workbook upload failed:', e.message);
    return false;
  }
}

async function saveWorkbook(wb) {
  await wb.xlsx.writeFile(WORKBOOK_PATH);
  await uploadWorkbookToDrive();
}

const accountRules = [
  { account: '肥料費', words: ['肥料', '化成肥料', '堆肥', '石灰', '苦土', '液肥'] },
  { account: '農薬費', words: ['農薬', 'ダコニール', '除草剤', '殺菌剤', '殺虫剤', '展着剤'] },
  { account: '諸材料費', words: ['マルチ', '黒マルチ', '支柱', 'ネット', '培土', 'ポット', '苗箱', '手袋', 'グローブ', '軍手', 'メカニカルグローブ'] },
  { account: '種苗費', words: ['種', '種子', '苗', '苗木'] },
  { account: '農具費', words: ['農具', '鍬', '鎌', 'ハサミ', '噴霧器', '工具'] },
  { account: '修繕費', words: ['修理', '修繕', '部品', '交換', '整備'] },
  { account: '燃料費', words: ['ガソリン', '軽油', '灯油', 'オイル', '燃料'] },
  { account: '交通費', words: ['交通費', '電車', 'バス', '高速', '有料道路', '駐車場', '切符'] },
  { account: '研修費', words: ['研修', '講習', 'セミナー', '受講料', '勉強会'] },
  { account: '接待交際費', words: ['接待', '交際', '手土産', '贈答', '会食'] },
  { account: '雑費', words: ['雑費', '手数料', 'コピー', '文具', '消耗品'] },
];

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

function yen(n) {
  return `${Number(n || 0).toLocaleString('ja-JP')}円`;
}

function onlyNumber(value) {
  if (value === null || value === undefined) return 0;
  const n = String(value).replace(/[^\d.-]/g, '');
  return Number(n || 0);
}

function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function jpDateName(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function parseDate(text) {
  const now = new Date();
  const patterns = [
    /(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/,
    /(\d{2})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/,
    /(\d{1,2})[\/\-.月](\d{1,2})/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (!m) continue;
    let y;
    let mo;
    let da;
    if (m.length === 4) {
      y = Number(m[1]);
      if (y < 100) y += 2000;
      mo = Number(m[2]);
      da = Number(m[3]);
    } else {
      y = now.getFullYear();
      mo = Number(m[1]);
      da = Number(m[2]);
    }
    return formatDate(new Date(y, mo - 1, da));
  }
  return formatDate(now);
}

function readJsonSync(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function normalizeLearningText(text) {
  return String(text || '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[\s　]+/g, '')
    .toLowerCase();
}

function inferLearnedAccount(text) {
  const normalized = normalizeLearningText(text);
  const rules = readJsonSync(LEARNING_RULES_PATH, []);
  const matched = rules
    .filter((rule) => rule.account && rule.keyword && normalized.includes(normalizeLearningText(rule.keyword)))
    .sort((a, b) => normalizeLearningText(b.keyword).length - normalizeLearningText(a.keyword).length);
  return matched[0]?.account || '';
}

function inferAccount(text) {
  const learned = inferLearnedAccount(text);
  if (learned) return learned;

  for (const rule of accountRules) {
    if (rule.words.some((w) => text.includes(w))) return rule.account;
  }
  return '雑費';
}

function inferDocumentType(text) {
  if (/納品書/.test(text)) return '納品書';
  if (/請求書/.test(text)) return '請求書';
  if (/領収書/.test(text)) return '領収書';
  if (/売上|販売|直売|出荷|納品先|販売先/.test(text)) return '売上伝票';
  if (/レシート|領収|合計|小計|消費税/.test(text)) return 'レシート';
  return 'その他';
}

function inferEntryType(text, docType) {
  if (docType === '売上伝票') return 'sale';
  if (/販売先|売上|直売所|出荷|納品先/.test(text) && !/購入|お買上|レシート/.test(text)) return 'sale';
  return 'expense';
}

function findAmount(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const moneyLimit = Number(process.env.MAX_RECEIPT_AMOUNT || 10000000);

  const normalize = (value) => onlyNumber(
    String(value)
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/[，,]/g, '')
  );

  const valid = (n) => Number.isFinite(n) && n > 0 && n <= moneyLimit;

  const looksLikeQuantity = (source, startIndex, raw) => {
    const before = source.slice(Math.max(0, startIndex - 3), startIndex);
    const after = source.slice(startIndex + raw.length, startIndex + raw.length + 3);
    return /[数量点個件枚]/.test(before + after);
  };

  const numbersFrom = (source, mode = 'any') => {
    const re = /(?:￥|¥|円)?\s*([0-9０-９]{1,3}(?:[,，][0-9０-９]{3})+|[0-9０-９]{1,8})\s*(?:円)?/g;
    return [...source.matchAll(re)]
      .filter((m) => {
        const hasCurrency = /[￥¥円]/.test(m[0]);
        if (mode === 'currency' && !hasCurrency) return false;
        if (looksLikeQuantity(source, m.index || 0, m[1])) return false;
        return true;
      })
      .map((m) => normalize(m[1]))
      .filter(valid);
  };

  const priorityWords = /合計|総計|税込|お支払|支払|請求金額|領収金額|現計|合算|小計|計$/;
  const priorityLines = [];
  lines.forEach((line, index) => {
    if (!priorityWords.test(line)) return;
    priorityLines.push([line, lines[index + 1], lines[index + 2]].filter(Boolean).join(' '));
  });

  for (const line of priorityLines) {
    const candidates = numbersFrom(line, 'any');
    if (candidates.length) return Math.max(...candidates);
  }

  const yenCandidates = numbersFrom(text, 'currency');
  if (yenCandidates.length) return Math.max(...yenCandidates);

  return 0;
}

function findTax(text) {
  const m = text.match(/(?:消費税|税)\D{0,8}(\d{1,3}(?:,\d{3})+|\d+)/);
  return m ? onlyNumber(m[1]) : 0;
}

function findName(text, entryType) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const knownStores = [
    ['CAINZ', 'カインズ'],
    ['カインズ', 'カインズ'],
    ['コメリ', 'コメリ'],
    ['JA', 'JA'],
    ['農協', '農協'],
    ['ホームセンター', 'ホームセンター'],
  ];

  for (const [keyword, name] of knownStores) {
    if (text.toUpperCase().includes(keyword.toUpperCase())) return name;
  }

  const skip = /合計|小計|消費税|日付|領収|請求|納品|TEL|電話|登録番号|会員|ポイント|バーコード|QR|LINE|House of MUTA|担当者|返信|\d{1,2}:\d{2}|\d{4}|\d+円|[¥￥]\d+/;
  const candidate = lines.find((l) => !skip.test(l) && l.length >= 2 && l.length <= 30);
  if (entryType === 'sale') return candidate || '販売先不明';
  return candidate || '店舗不明';
}

function findProduct(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const skip = /合計|小計|消費税|日付|領収|請求|納品|TEL|電話|\d{4}/;
  const candidate = lines.find((l) => !skip.test(l) && accountRules.some((r) => r.words.some((w) => l.includes(w))));
  return candidate || lines.find((l) => !skip.test(l) && l.length >= 2 && l.length <= 40) || '摘要未確認';
}

async function extractText(buffer) {
  if (!visionClient) {
    throw new Error('Google Vision credentials are missing. Set GOOGLE_APPLICATION_CREDENTIALS_JSON.');
  }

  const [result] = await visionClient.textDetection({ image: { content: buffer } });
  const text = result.fullTextAnnotation?.text || result.textAnnotations?.[0]?.description || '';
  return text.trim();
}

async function analyzeWithOpenAI(ocrText) {
  if (!openai) return null;
  const prompt = `
OCR結果を農業青色申告用のJSONにしてください。
必ずJSONだけで返してください。
entryTypeは expense または sale。
documentTypeは レシート/納品書/領収書/請求書/売上伝票/その他。
accountは経費の場合だけ、肥料費/農薬費/諸材料費/種苗費/農具費/修繕費/燃料費/交通費/研修費/接待交際費/雑費から選択。
{
  "entryType": "expense",
  "documentType": "レシート",
  "date": "YYYY-MM-DD",
  "store": "",
  "buyer": "",
  "summary": "",
  "product": "",
  "quantity": 1,
  "unitPrice": 0,
  "amount": 0,
  "tax": 0,
  "account": "雑費"
}
OCR:
${ocrText}`;

  const res = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0.1,
    messages: [{ role: 'user', content: prompt }],
  });
  const content = res.choices?.[0]?.message?.content || '';
  const json = content.replace(/```json|```/g, '').trim();
  return JSON.parse(json);
}

function fallbackAnalyze(ocrText) {
  const documentType = inferDocumentType(ocrText);
  const entryType = inferEntryType(ocrText, documentType);
  const amount = findAmount(ocrText);
  const product = findProduct(ocrText);
  return {
    entryType,
    documentType,
    date: parseDate(ocrText),
    store: entryType === 'expense' ? findName(ocrText, entryType) : '',
    buyer: entryType === 'sale' ? findName(ocrText, entryType) : '',
    summary: product,
    product,
    quantity: 1,
    unitPrice: entryType === 'sale' ? amount : 0,
    amount,
    tax: findTax(ocrText),
    account: entryType === 'expense' ? inferAccount(ocrText) : '',
  };
}

async function analyzeText(ocrText) {
  try {
    const ai = await analyzeWithOpenAI(ocrText);
    if (ai && ai.entryType && ai.date) {
      ai.amount = onlyNumber(ai.amount);
      ai.quantity = onlyNumber(ai.quantity) || 1;
      ai.unitPrice = onlyNumber(ai.unitPrice);
      ai.tax = onlyNumber(ai.tax);
      if (ai.entryType === 'expense') {
        const learned = inferLearnedAccount(ocrText);
        ai.account = learned || ai.account || inferAccount(ocrText);
      }
      return ai;
    }
  } catch (e) {
    log('OpenAI analysis fallback:', e.message);
  }
  return fallbackAnalyze(ocrText);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await ensureDir(path.dirname(file));
  await fsp.writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}

async function saveLearningRule({ keyword, account, sourceText }) {
  const cleanKeyword = normalizeLearningText(keyword);
  if (!cleanKeyword || cleanKeyword.length < 2 || !account) return false;

  const rules = await readJson(LEARNING_RULES_PATH, []);
  const existing = rules.find((rule) => normalizeLearningText(rule.keyword) === cleanKeyword);
  if (existing) {
    existing.account = account;
    existing.updatedAt = new Date().toISOString();
    existing.count = Number(existing.count || 1) + 1;
  } else {
    rules.push({
      keyword: String(keyword).trim(),
      account,
      sourceText: String(sourceText || '').slice(0, 300),
      count: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  await writeJson(LEARNING_RULES_PATH, rules);
  return true;
}

function buildLearningKeyword(session, target) {
  const values = [
    session.lastProduct,
    session.lastSummary,
    target?.getCell?.(4)?.value,
  ].map((value) => String(value || '').trim()).filter(Boolean);

  const firstUseful = values.find((value) => value.length >= 2 && value.length <= 40);
  if (firstUseful) return firstUseful;

  const ocrLines = String(session.lastOcrText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 2 && line.length <= 40)
    .filter((line) => !/合計|小計|消費税|領収|請求|納品|TEL|電話|登録番号|会員|ポイント|\d{1,2}:\d{2}|\d+円|[¥￥]\d+/.test(line));

  return ocrLines[0] || '';
}


function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function isDuplicate({ hash, date, amount }) {
  const reg = await readJson(REGISTRY_PATH, []);
  return reg.find((r) => r.hash === hash || (r.date === date && Number(r.amount) === Number(amount)));
}

async function registerEntry(entry) {
  const reg = await readJson(REGISTRY_PATH, []);
  reg.push({ ...entry, createdAt: new Date().toISOString() });
  await writeJson(REGISTRY_PATH, reg);
}

async function saveImage(buffer, entryType, dateText) {
  const date = new Date(dateText);
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const base = entryType === 'sale' ? 'sales' : 'receipts';
  const prefix = entryType === 'sale' ? 'sale' : 'receipt';
  const dir = path.join(UPLOAD_DIR, base, y, m);
  await ensureDir(dir);
  const existing = await fsp.readdir(dir).catch(() => []);
  const seq = String(existing.filter((f) => f.startsWith(`${prefix}_${jpDateName(date)}`)).length + 1).padStart(4, '0');
  const fileName = `${prefix}_${jpDateName(date)}_${seq}.jpg`;
  const fullPath = path.join(dir, fileName);
  await fsp.writeFile(fullPath, buffer);
  return { fileName, relativePath: path.relative(ROOT, fullPath).replace(/\\/g, '/') };
}

function styleHeader(row, fill = '1F4E78') {
  row.eachCell((cell) => {
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin' }, left: { style: 'thin' },
      bottom: { style: 'thin' }, right: { style: 'thin' },
    };
  });
}

async function ensureWorkbook() {
  await ensureDir(EXCEL_DIR);
  await downloadWorkbookFromDriveIfNeeded();
  const wb = new ExcelJS.Workbook();
  if (fs.existsSync(WORKBOOK_PATH)) {
    await wb.xlsx.readFile(WORKBOOK_PATH);
    return wb;
  }

  const expense = wb.addWorksheet('経費');
  expense.columns = [
    { header: 'ID', key: 'id', width: 18 },
    { header: '日付', key: 'date', width: 14 },
    { header: '店舗', key: 'store', width: 24 },
    { header: '摘要', key: 'summary', width: 32 },
    { header: '勘定科目', key: 'account', width: 16 },
    { header: '数量', key: 'quantity', width: 10 },
    { header: '金額', key: 'amount', width: 14 },
    { header: '消費税', key: 'tax', width: 14 },
    { header: '画像ファイル名', key: 'image', width: 42 },
    { header: 'OCR原文', key: 'ocr', width: 60 },
  ];
  styleHeader(expense.getRow(1), 'C65911');

  const sale = wb.addWorksheet('売上');
  sale.columns = [
    { header: 'ID', key: 'id', width: 18 },
    { header: '日付', key: 'date', width: 14 },
    { header: '販売先', key: 'buyer', width: 24 },
    { header: '商品', key: 'product', width: 28 },
    { header: '数量', key: 'quantity', width: 10 },
    { header: '単価', key: 'unitPrice', width: 14 },
    { header: '売上', key: 'amount', width: 14 },
    { header: '画像ファイル名', key: 'image', width: 42 },
    { header: 'OCR原文', key: 'ocr', width: 60 },
  ];
  styleHeader(sale.getRow(1), '2E7D32');

  const summary = wb.addWorksheet('集計');
  summary.addRow(['月', '売上', '経費', '利益']);
  styleHeader(summary.getRow(1), '1F4E78');
  for (let i = 1; i <= 12; i++) {
    const r = i + 1;
    summary.addRow([
      `${i}月`,
      { formula: `SUMIFS(売上!G:G,売上!B:B,">=${EXCEL_YEAR}-${String(i).padStart(2, '0')}-01",売上!B:B,"<${EXCEL_YEAR}-${String(i + 1).padStart(2, '0')}-01")` },
      { formula: `SUMIFS(経費!G:G,経費!B:B,">=${EXCEL_YEAR}-${String(i).padStart(2, '0')}-01",経費!B:B,"<${i === 12 ? EXCEL_YEAR + 1 : EXCEL_YEAR}-${String(i === 12 ? 1 : i + 1).padStart(2, '0')}-01")` },
      { formula: `B${r}-C${r}` },
    ]);
  }
  summary.addRow(['年間合計', { formula: 'SUM(B2:B13)' }, { formula: 'SUM(C2:C13)' }, { formula: 'B14-C14' }]);
  summary.columns.forEach((c) => { c.width = 16; });

  const copy = wb.addWorksheet('青色申告コピペ用');
  copy.addRow(['日付', '摘要', '収入区分', '収入金額', '経費区分', '経費金額']);
  styleHeader(copy.getRow(1), '174A35');
  copy.columns = [
    { width: 14 }, { width: 34 }, { width: 16 }, { width: 14 }, { width: 16 }, { width: 14 },
  ];

  await saveWorkbook(wb);
  return wb;
}

async function appendToWorkbook(analysis, image, ocrText) {
  const wb = await ensureWorkbook();
  const id = `${analysis.entryType}_${Date.now()}`;

  if (analysis.entryType === 'sale') {
    const ws = wb.getWorksheet('売上');
    const row = ws.addRow([
      id,
      analysis.date,
      analysis.buyer || '販売先不明',
      analysis.product || analysis.summary || '商品未確認',
      analysis.quantity || 1,
      analysis.unitPrice || analysis.amount,
      analysis.amount,
      image.relativePath,
      ocrText,
    ]);
    row.getCell(7).numFmt = '#,##0';
  } else {
    const ws = wb.getWorksheet('経費');
    const row = ws.addRow([
      id,
      analysis.date,
      analysis.store || '店舗不明',
      analysis.summary || analysis.product || '摘要未確認',
      analysis.account || '雑費',
      analysis.quantity || 1,
      analysis.amount,
      analysis.tax || 0,
      image.relativePath,
      ocrText,
    ]);
    row.getCell(7).numFmt = '#,##0';
    row.getCell(8).numFmt = '#,##0';
  }

  const copy = wb.getWorksheet('青色申告コピペ用');
  if (analysis.entryType === 'sale') {
    copy.addRow([analysis.date, analysis.product || '売上', '農産物売上', analysis.amount, '', '']);
  } else {
    copy.addRow([analysis.date, analysis.summary || analysis.product || '経費', '', '', analysis.account || '雑費', analysis.amount]);
  }

  await saveWorkbook(wb);
  return { id, kind: analysis.entryType };
}

async function getMessageContent(messageId) {
  const chunks = [];
  const stream = await blobClient.getMessageContent(messageId);
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function replyText(replyToken, text) {
  await lineClient.replyMessage({
    replyToken,
    messages: [{ type: 'text', text: String(text).slice(0, 4500) }],
  });
}

async function loadWorkbookRows() {
  const wb = await ensureWorkbook();
  const expenses = [];
  const sales = [];
  const expenseWs = wb.getWorksheet('経費');
  const saleWs = wb.getWorksheet('売上');
  expenseWs.eachRow((row, n) => {
    if (n === 1) return;
    expenses.push({
      id: row.getCell(1).value,
      date: row.getCell(2).value,
      store: row.getCell(3).value,
      summary: row.getCell(4).value,
      account: row.getCell(5).value,
      amount: Number(row.getCell(7).value || 0),
    });
  });
  saleWs.eachRow((row, n) => {
    if (n === 1) return;
    sales.push({
      id: row.getCell(1).value,
      date: row.getCell(2).value,
      buyer: row.getCell(3).value,
      product: row.getCell(4).value,
      quantity: Number(row.getCell(5).value || 0),
      amount: Number(row.getCell(7).value || 0),
    });
  });
  return { expenses, sales };
}

function monthFilter(text, dateValue) {
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  if (/今月/.test(text)) return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  if (/今年|年間/.test(text)) return d.getFullYear() === now.getFullYear();
  const m = text.match(/(\d{1,2})月/);
  if (m) return d.getFullYear() === now.getFullYear() && d.getMonth() + 1 === Number(m[1]);
  return true;
}

async function answerText(text) {
  const { expenses, sales } = await loadWorkbookRows();
  const e = expenses.filter((r) => monthFilter(text, r.date));
  const s = sales.filter((r) => monthFilter(text, r.date));
  const expenseTotal = e.reduce((a, r) => a + Number(r.amount || 0), 0);
  const salesTotal = s.reduce((a, r) => a + Number(r.amount || 0), 0);

  if (/利益/.test(text)) {
    return `利益は ${yen(salesTotal - expenseTotal)} です。\n売上 ${yen(salesTotal)}\n経費 ${yen(expenseTotal)}`;
  }
  if (/売上/.test(text)) {
    const buyerMatch = text.match(/(.+?)へ|(.+?)に/);
    if (buyerMatch) {
      const name = (buyerMatch[1] || buyerMatch[2] || '').trim();
      const rows = s.filter((r) => String(r.buyer || '').includes(name));
      const total = rows.reduce((a, r) => a + Number(r.amount || 0), 0);
      return `${name}への売上は ${yen(total)} です。`;
    }
    return `売上は ${yen(salesTotal)} です。`;
  }
  if (/経費/.test(text)) return `経費は ${yen(expenseTotal)} です。`;

  const rule = accountRules.find((r) => text.includes(r.account.replace('費', '')) || text.includes(r.account));
  if (rule) {
    const rows = e.filter((r) => r.account === rule.account);
    const total = rows.reduce((a, r) => a + Number(r.amount || 0), 0);
    return `${rule.account}は ${yen(total)} です。`;
  }

  return 'MUTA Farm AIです。レシート・納品書・領収書・売上伝票の写真を送ってください。\n「今月の利益」「肥料代」「今年の売上」なども聞けます。';
}

async function getSession(userId) {
  const all = await readJson(SESSION_PATH, {});
  return all[userId] || {};
}

async function setSession(userId, data) {
  const all = await readJson(SESSION_PATH, {});
  all[userId] = { ...(all[userId] || {}), ...data, updatedAt: new Date().toISOString() };
  await writeJson(SESSION_PATH, all);
}

function parseCorrectionAmount(text) {
  const normalized = String(text || '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[，,]/g, '')
    .replace(/[￥¥]/g, '円');

  const patterns = [
    /(?:金額|売上|単価|合計|小計).*?(\d{1,8})\s*円?/,
    /(\d{1,8})\s*円?\s*(?:へ|に)?\s*(?:変更|修正|訂正|直して|なおして)/,
    /(?:変更|修正|訂正|直して|なおして).*?(\d{1,8})\s*円?/,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const amount = onlyNumber(match[1]);
    const maxAmount = Number(process.env.MAX_RECEIPT_AMOUNT || 10000000);
    if (Number.isFinite(amount) && amount > 0 && amount <= maxAmount) return amount;
  }

  return 0;
}

function cellPlainValue(cell) {
  const value = cell?.value;
  if (value && typeof value === 'object' && 'result' in value) return value.result;
  if (value && typeof value === 'object' && 'text' in value) return value.text;
  return value;
}

function updateCopySheetAmount(wb, session, target, amount) {
  const copy = wb.getWorksheet('青色申告コピペ用');
  if (!copy) return false;

  const date = String(cellPlainValue(target.getCell(2)) || '');
  const summary = String(cellPlainValue(target.getCell(4)) || '');
  const category = session.lastKind === 'sale'
    ? String(cellPlainValue(target.getCell(3)) || '')
    : String(cellPlainValue(target.getCell(5)) || '');

  for (let rowNumber = copy.rowCount; rowNumber >= 2; rowNumber -= 1) {
    const row = copy.getRow(rowNumber);
    const copyDate = String(cellPlainValue(row.getCell(1)) || '');
    const copySummary = String(cellPlainValue(row.getCell(2)) || '');
    const incomeCategory = String(cellPlainValue(row.getCell(3)) || '');
    const expenseCategory = String(cellPlainValue(row.getCell(5)) || '');

    if (session.lastKind === 'sale') {
      if (copyDate === date && (copySummary === summary || incomeCategory === category)) {
        row.getCell(4).value = amount;
        return true;
      }
    } else if (copyDate === date && (copySummary === summary || expenseCategory === category)) {
      row.getCell(6).value = amount;
      return true;
    }
  }

  return false;
}

function parseEntryIdTime(id) {
  const match = String(id || '').match(/^(sale|expense)_(\d+)$/);
  return match ? Number(match[2]) : 0;
}

function findRowById(ws, id) {
  if (!ws || !id) return null;
  let found = null;
  ws.eachRow((row, rowNumber) => {
    if (rowNumber > 1 && row.getCell(1).value === id) found = row;
  });
  return found;
}

function findNewestDataRow(ws, kind) {
  if (!ws) return null;
  let newest = null;
  ws.eachRow((row, rowNumber) => {
    if (rowNumber <= 1) return;
    const id = row.getCell(1).value;
    const date = row.getCell(2).value;
    const amount = row.getCell(7).value;
    const hasUsefulValue = row.values.some((value, index) => index > 1 && value !== null && value !== undefined && value !== '');
    if (!id && !date && !amount && !hasUsefulValue) return;
    const time = parseEntryIdTime(id) || rowNumber;
    if (!newest || time > newest.time) newest = { kind, ws, row, time };
  });
  return newest;
}

function findEditableEntry(wb, session) {
  const kinds = [
    { kind: 'expense', sheet: '経費' },
    { kind: 'sale', sheet: '売上' },
  ];

  if (session.lastId && session.lastKind) {
    const sheetName = session.lastKind === 'sale' ? '売上' : '経費';
    const ws = wb.getWorksheet(sheetName);
    const row = findRowById(ws, session.lastId);
    if (row) return { kind: session.lastKind, ws, row };
  }

  const newest = kinds
    .map(({ kind, sheet }) => findNewestDataRow(wb.getWorksheet(sheet), kind))
    .filter(Boolean)
    .sort((a, b) => b.time - a.time)[0];

  return newest ? { kind: newest.kind, ws: newest.ws, row: newest.row } : null;
}

function isModifyCommand(text) {
  const normalized = String(text || '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  if (/削除|変更|修正|訂正|直して|なおして/.test(normalized)) return true;
  if (/(金額|売上|単価|合計|小計).*\d/.test(normalized)) return true;
  return false;
}

async function modifyLastEntry(text, userId) {
  if (!isModifyCommand(text)) return null;

  const session = await getSession(userId);

  const wb = await ensureWorkbook();
  const editable = findEditableEntry(wb, session);
  if (!editable) return '修正できる登録がまだありません。先にレシート写真を送ってください。';

  const ws = editable.ws;
  const target = editable.row;
  session.lastKind = editable.kind;
  session.lastId = target.getCell(1).value;
  if (!target) return '直前の登録が見つかりませんでした。';

  if (/削除/.test(text)) {
    ws.spliceRows(target.number, 1);
    await saveWorkbook(wb);
    return '直前の登録を削除しました。';
  }

  const correctedAmount = parseCorrectionAmount(text);
  if (correctedAmount) {
    if (session.lastKind === 'sale') {
      target.getCell(7).value = correctedAmount;
      const quantity = Number(target.getCell(5).value || 0);
      if (quantity > 0) target.getCell(6).value = Math.round(correctedAmount / quantity);
    } else {
      target.getCell(7).value = correctedAmount;
    }

    const copyUpdated = updateCopySheetAmount(wb, session, target, correctedAmount);
    await saveWorkbook(wb);
    return copyUpdated
      ? `金額を ${yen(correctedAmount)} に変更しました。青色申告コピペ用シートも更新しました。`
      : `金額を ${yen(correctedAmount)} に変更しました。`;
  }

  const account = accountRules.find((r) => text.includes(r.account) || text.includes(r.account.replace('費', '')));
  if (account && session.lastKind === 'expense') {
    target.getCell(5).value = account.account;
    const keyword = buildLearningKeyword(session, target);
    const learned = await saveLearningRule({
      keyword,
      account: account.account,
      sourceText: session.lastOcrText,
    });
    await saveWorkbook(wb);
    return learned
      ? `分類を ${account.account} に変更しました。次回から「${keyword}」は ${account.account} として覚えます。`
      : `分類を ${account.account} に変更しました。`;
  }

  return null;
}

async function handleImage(event) {
  const buffer = await getMessageContent(event.message.id);
  const hash = hashBuffer(buffer);
  let ocrText = '';
  try {
    ocrText = await extractText(buffer);
  } catch (e) {
    const message = String(e.message || '');
    if (message.includes('Google Vision credentials are missing')) {
      await replyText(event.replyToken, 'Google Vision OCRの認証情報が未設定です。RenderにGOOGLE_APPLICATION_CREDENTIALS_JSONを設定してください。');
      return;
    }
    if (message.includes('requires billing to be enabled')) {
      await replyText(event.replyToken, 'Google Cloudの請求設定が未有効です。Cloud Vision APIを使うには、プロジェクトのBillingを有効化してください。');
      return;
    }
    if (message.includes('Cloud Vision API has not been used') || message.includes('it is disabled')) {
      await replyText(event.replyToken, 'Cloud Vision APIが未有効です。Google CloudでVision APIを有効化してから、数分後に再送してください。');
      return;
    }
    if (message.includes('PERMISSION_DENIED')) {
      await replyText(event.replyToken, 'Google Vision OCRの権限エラーです。Cloud Vision APIの有効化、Billing、サービスアカウント権限を確認してください。');
      return;
    }
    throw e;
  }
  if (!ocrText) {
    await replyText(event.replyToken, '読み取れませんでした。明るい場所で、紙全体が入るように再撮影してください。');
    return;
  }

  const analysis = await analyzeText(ocrText);
  const duplicate = await isDuplicate({ hash, date: analysis.date, amount: analysis.amount });
  if (duplicate) {
    await replyText(event.replyToken, '既に登録されています。');
    return;
  }

  const image = await saveImage(buffer, analysis.entryType, analysis.date);
  const saved = await appendToWorkbook(analysis, image, ocrText);
  await registerEntry({ hash, date: analysis.date, amount: analysis.amount, kind: saved.kind, id: saved.id, image: image.relativePath });
  await setSession(event.source.userId || 'unknown', {
    lastId: saved.id,
    lastKind: saved.kind,
    lastOcrText: ocrText,
    lastSummary: analysis.summary || '',
    lastProduct: analysis.product || '',
    lastAccount: analysis.account || '',
  });

  if (saved.kind === 'sale') {
    await replyText(event.replyToken, [
      '登録しました',
      '売上',
      `販売先: ${analysis.buyer || '販売先不明'}`,
      `商品: ${analysis.product || analysis.summary || '商品未確認'}`,
      `数量: ${analysis.quantity || 1}`,
      `売上: ${yen(analysis.amount)}`,
      'Excel更新完了',
    ].join('\n'));
  } else {
    await replyText(event.replyToken, [
      '登録しました',
      '経費',
      `店名: ${analysis.store || '店舗不明'}`,
      `分類: ${analysis.account || '雑費'}`,
      `金額: ${yen(analysis.amount)}`,
      'Excel更新完了',
    ].join('\n'));
  }
}

async function handleText(event) {
  const text = event.message.text.trim();
  const mod = await modifyLastEntry(text, event.source.userId || 'unknown');
  if (mod) {
    await replyText(event.replyToken, mod);
    return;
  }
  await replyText(event.replyToken, await answerText(text));
}

async function handleEvent(event) {
  if (event.type !== 'message') return;
  if (event.message.type === 'image') return handleImage(event);
  if (event.message.type === 'text') return handleText(event);
  return replyText(event.replyToken, '画像または文字メッセージを送ってください。');
}

const app = express();
app.use(helmet());
app.use(morgan('combined'));

app.get('/', (_req, res) => {
  res.json({ name: 'MUTA Farm AI', status: 'ok', webhook: '/webhook' });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  try {
    await Promise.all((req.body.events || []).map(handleEvent));
    res.status(200).end();
  } catch (e) {
    log('webhook error:', e.message, e.stack);
    const event = req.body.events?.[0];
    if (event?.replyToken) {
      try {
        await replyText(event.replyToken, '処理中にエラーが発生しました。Renderのログを確認してください。');
      } catch (replyError) {
        log('reply error:', replyError.message);
      }
    }
    res.status(200).end();
  }
});

cron.schedule('0 18 28-31 * *', async () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (tomorrow.getDate() !== 1) return;
  if (!process.env.LINE_ADMIN_USER_ID) return;
  const { expenses, sales } = await loadWorkbookRows();
  const now = new Date();
  const thisMonth = (r) => {
    const d = new Date(r.date);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  };
  const s = sales.filter(thisMonth).reduce((a, r) => a + Number(r.amount || 0), 0);
  const e = expenses.filter(thisMonth).reduce((a, r) => a + Number(r.amount || 0), 0);
  await lineClient.pushMessage({
    to: process.env.LINE_ADMIN_USER_ID,
    messages: [{ type: 'text', text: `月末集計\n売上 ${yen(s)}\n経費 ${yen(e)}\n利益 ${yen(s - e)}` }],
  });
}, { timezone: 'Asia/Tokyo' });

ensureWorkbook()
  .then(() => {
    app.listen(PORT, () => log(`MUTA Farm AI listening on port ${PORT}`));
  })
  .catch((e) => {
    log('boot error:', e.message, e.stack);
    process.exit(1);
  });
