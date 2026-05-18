const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const db = require('../../sdk/database')

const port = process.env.PORT || 4027

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
}

let gw
try { gw = require('../../sdk/gateway') } catch { gw = null }

const publicDir = path.join(__dirname, 'public')
const dataDir = path.join(__dirname, 'data')
const assetsDir = path.join(dataDir, 'assets')
const recordingsDir = path.join(dataDir, 'recordings')
const assetsJsonPath = path.join(dataDir, 'assets.json')
const ideasJsonPath = path.join(dataDir, 'ideas.json')

// Ensure directories exist
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}
ensureDir(dataDir)
ensureDir(assetsDir)
ensureDir(recordingsDir)

// --- SDK Database Init ---
// PM2 may run from CloudPipe root — ensure cwd matches project dir for SDK
process.chdir(__dirname)

db.init({ project: 'reelmaker' })
const Topics = db.collection('topics')
const Ideas = db.collection('ideas')
const Assets = db.collection('assets')
const Settings = db.collection('settings')
const Benchmarks = db.collection('benchmarks')

// --- Default seed topics ---

const DEFAULT_TOPICS = [
  {
    name: 'AI 發展趨勢',
    markdown: `# AI 發展趨勢
## 技術面
- LLM 大語言模型
- Agent 自主代理
- RAG 檢索增強
## 商業面
- SaaS 訂閱制
- API 經濟
- 開源生態
## 應用面
- 程式開發
- 內容創作
- 教育學習`,
    order: 0,
  },
  {
    name: '簡報 Demo（切到簡報模式看）',
    markdown: `# 2025 AI 大事件

## ChatGPT 稱霸
![](https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/ChatGPT_logo.svg/480px-ChatGPT_logo.svg.png)
- 全球 2 億用戶
- 企業版爆發成長
- 多模態能力

## Claude 崛起
![](https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/Anthropic_logo.svg/480px-Anthropic_logo.svg.png)
- 200K 超長上下文
- 程式碼能力頂尖
- 安全 AI 領導者

## 開源反攻
![](https://huggingface.co/front/assets/huggingface_logo-noborder.svg)
- Llama 3 開源
- Mistral 歐洲之光
- 本地部署崛起

## 結論
- AI 不是取代你
- 是不會用 AI 的人取代你`,
    order: 1,
  },
  {
    name: '網路賺錢',
    markdown: `# 網路賺錢

## 發文
- IG Reels 短影音

## 訊息
- IG DM 私訊成交

## 服務
- 一對一諮詢
- 線上課程
- 代操服務
- PDF 教學手冊`,
    order: 2,
  },
]

const DEFAULT_PROMPTER = [
  '【開頭 — Hook】',
  '想靠網路賺錢？其實只要搞懂三件事',
  '',
  '【第一點 — 發文】',
  '用 IG Reels 短影音大量曝光',
  '不用拍得多完美 重點是持續產出',
  '讓演算法幫你推到對的人面前',
  '',
  '【第二點 — 訊息】',
  '有人看到你的內容 → 私訊你',
  '用 IG DM 建立信任 了解需求',
  '這一步是成交的關鍵',
  '',
  '【第三點 — 服務】',
  '你可以賣的東西很多：',
  '一對一諮詢、線上課、代操、PDF 教學…',
  '關鍵是先有一個能賣的東西',
  '',
  '【收尾 — CTA】',
  '想知道完整做法？',
  '我整理了一份 PDF 教學手冊',
  '留言「我要」或私訊我拿連結',
].join('\n')

// --- JSON → DB migration (one-time on startup) ---

async function migrateJsonToDb() {
  // Migrate ideas.json
  if (fs.existsSync(ideasJsonPath)) {
    try {
      const raw = fs.readFileSync(ideasJsonPath, 'utf-8')
      const ideas = JSON.parse(raw)
      if (Array.isArray(ideas) && ideas.length > 0) {
        const existingCount = await Ideas.count()
        if (existingCount === 0) {
          for (const idea of ideas) {
            await Ideas.create({
              ...idea,
              id: idea.id || crypto.randomBytes(6).toString('hex'),
            })
          }
          console.log(`[migrate] ideas.json → DB: ${ideas.length} ideas`)
        }
      }
      fs.renameSync(ideasJsonPath, ideasJsonPath + '.bak')
      console.log('[migrate] ideas.json renamed to ideas.json.bak')
    } catch (err) {
      console.error('[migrate] ideas.json migration error:', err.message)
    }
  }

  // Migrate assets.json
  if (fs.existsSync(assetsJsonPath)) {
    try {
      const raw = fs.readFileSync(assetsJsonPath, 'utf-8')
      const data = JSON.parse(raw)
      const assets = data.assets || []
      const folders = data.folders || ['default']

      const existingCount = await Assets.count()
      if (existingCount === 0 && assets.length > 0) {
        for (const asset of assets) {
          await Assets.create({
            ...asset,
            id: asset.id || crypto.randomBytes(6).toString('hex'),
          })
        }
        console.log(`[migrate] assets.json → DB: ${assets.length} assets`)
      }

      // Store folders in settings
      const existingFolders = await Settings.getById('folders')
      if (!existingFolders) {
        await Settings.create({ id: 'folders', value: folders })
      }

      fs.renameSync(assetsJsonPath, assetsJsonPath + '.bak')
      console.log('[migrate] assets.json renamed to assets.json.bak')
    } catch (err) {
      console.error('[migrate] assets.json migration error:', err.message)
    }
  }

  // Seed default settings if missing
  const foldersDoc = await Settings.getById('folders')
  if (!foldersDoc) {
    await Settings.create({ id: 'folders', value: ['default'] })
  }

  // Seed default topics if DB is empty
  const topicCount = await Topics.count()
  if (topicCount === 0) {
    for (const t of DEFAULT_TOPICS) {
      await Topics.create({
        id: crypto.randomBytes(6).toString('hex'),
        ...t,
        storyboards: [],
      })
    }
    console.log('[seed] Created default topics')
  }

  // Seed default prompter if missing
  const prompterDoc = await Settings.getById('prompter_text')
  if (!prompterDoc) {
    await Settings.create({ id: 'prompter_text', value: DEFAULT_PROMPTER })
  }
}

// --- Multipart parser ---

function parseMultipart(buf, boundary) {
  const parts = []
  const boundaryBuf = Buffer.from('--' + boundary)
  const endBuf = Buffer.from('--' + boundary + '--')

  let start = bufferIndexOf(buf, boundaryBuf, 0)
  if (start < 0) return parts

  while (true) {
    start += boundaryBuf.length
    if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2

    const nextBoundary = bufferIndexOf(buf, boundaryBuf, start)
    if (nextBoundary < 0) break

    const chunk = buf.slice(start, nextBoundary)
    const sep = bufferIndexOf(chunk, Buffer.from('\r\n\r\n'), 0)
    if (sep < 0) continue

    const headerStr = chunk.slice(0, sep).toString('utf-8')
    let body = chunk.slice(sep + 4)
    if (body.length >= 2 && body[body.length - 2] === 0x0d && body[body.length - 1] === 0x0a) {
      body = body.slice(0, body.length - 2)
    }

    const nameMatch = headerStr.match(/name="([^"]*)"/)
    const filenameMatch = headerStr.match(/filename="([^"]*)"/)
    const ctMatch = headerStr.match(/Content-Type:\s*(.+)/i)

    parts.push({
      name: nameMatch ? nameMatch[1] : '',
      filename: filenameMatch ? filenameMatch[1] : null,
      contentType: ctMatch ? ctMatch[1].trim() : null,
      data: body,
    })

    if (bufferIndexOf(buf, endBuf, nextBoundary) === nextBoundary) break
    start = nextBoundary
    start -= boundaryBuf.length
  }

  return parts
}

function bufferIndexOf(buf, search, from) {
  for (let i = from; i <= buf.length - search.length; i++) {
    let found = true
    for (let j = 0; j < search.length; j++) {
      if (buf[i + j] !== search[j]) { found = false; break }
    }
    if (found) return i
  }
  return -1
}

// --- Request body collector ---

function collectBody(req, maxSize) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxSize) {
        reject(new Error('Body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

// --- JSON response helpers ---

function jsonRes(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

// --- Route handler ---

async function handleRequest(req, res) {
  corsHeaders(res)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const parsed = new URL(req.url, 'http://localhost')
  const pathname = parsed.pathname

  try {
    // ── Health ──
    if (pathname === '/api/health') {
      return jsonRes(res, 200, { ok: true })
    }

    // ── Topics CRUD ──

    if (pathname === '/api/topics' && req.method === 'GET') {
      const topics = await Topics.findAll({ sort: 'order' })
      return jsonRes(res, 200, { topics })
    }

    if (pathname === '/api/topics' && req.method === 'POST') {
      const body = await collectBody(req, 1024 * 1024)
      const data = JSON.parse(body.toString('utf-8'))
      const allTopics = await Topics.findAll()
      const maxOrder = allTopics.reduce((max, t) => Math.max(max, t.order || 0), -1)
      const topic = await Topics.create({
        id: crypto.randomBytes(6).toString('hex'),
        name: (data.name || '').slice(0, 200) || '未命名',
        markdown: data.markdown || '# ' + (data.name || '新主題'),
        order: maxOrder + 1,
        storyboards: [],
      })
      return jsonRes(res, 201, { topic })
    }

    // PUT /api/topics/:id
    const topicUpdateMatch = pathname.match(/^\/api\/topics\/([a-zA-Z0-9_-]+)$/)
    if (topicUpdateMatch && req.method === 'PUT') {
      const id = topicUpdateMatch[1]
      const body = await collectBody(req, 1024 * 1024)
      const data = JSON.parse(body.toString('utf-8'))
      const updates = {}
      if (data.name !== undefined) updates.name = data.name.slice(0, 200)
      if (data.markdown !== undefined) updates.markdown = data.markdown
      if (data.order !== undefined) updates.order = data.order
      if (data.storyboards !== undefined) updates.storyboards = data.storyboards
      const updated = await Topics.update(id, updates)
      if (!updated) return jsonRes(res, 404, { error: 'Topic not found' })
      return jsonRes(res, 200, { topic: updated })
    }

    // DELETE /api/topics/:id
    const topicDeleteMatch = pathname.match(/^\/api\/topics\/([a-zA-Z0-9_-]+)$/)
    if (topicDeleteMatch && req.method === 'DELETE') {
      const id = topicDeleteMatch[1]
      const topic = await Topics.getById(id)
      if (!topic) return jsonRes(res, 404, { error: 'Topic not found' })
      // Clean up storyboard files
      for (const sb of (topic.storyboards || [])) {
        if (sb.url && sb.url.startsWith('/data/assets/')) {
          const filename = sb.url.replace('/data/assets/', '')
          try { fs.unlinkSync(path.join(assetsDir, filename)) } catch { /* ok */ }
        }
      }
      await Topics.remove(id)
      return jsonRes(res, 200, { ok: true })
    }

    // POST /api/topics/:id/storyboards — upload or reference storyboard
    const sbUploadMatch = pathname.match(/^\/api\/topics\/([a-zA-Z0-9_-]+)\/storyboards$/)
    if (sbUploadMatch && req.method === 'POST') {
      const id = sbUploadMatch[1]
      const topic = await Topics.getById(id)
      if (!topic) return jsonRes(res, 404, { error: 'Topic not found' })

      const ct = req.headers['content-type'] || ''

      if (ct.includes('multipart')) {
        // File upload
        const boundaryMatch = ct.match(/boundary=(.+)/)
        if (!boundaryMatch) return jsonRes(res, 400, { error: 'Missing boundary' })
        const body = await collectBody(req, 50 * 1024 * 1024)
        const fileParts = parseMultipart(body, boundaryMatch[1]).filter(p => p.filename)
        if (fileParts.length === 0) return jsonRes(res, 400, { error: 'No file' })

        const newSbs = []
        for (const filePart of fileParts) {
          const ext = path.extname(filePart.filename).toLowerCase() || '.png'
          const safeName = 'sb_' + crypto.randomBytes(8).toString('hex') + ext
          fs.writeFileSync(path.join(assetsDir, safeName), filePart.data)
          newSbs.push({
            id: 'sb_' + crypto.randomBytes(6).toString('hex'),
            name: filePart.filename,
            url: '/data/assets/' + safeName,
          })
        }

        const updated = await Topics.update(id, {
          storyboards: [...(topic.storyboards || []), ...newSbs],
        })
        return jsonRes(res, 201, { storyboards: updated.storyboards })
      }

      // JSON reference (from asset library)
      const body = await collectBody(req, 1024 * 64)
      const data = JSON.parse(body.toString('utf-8'))
      if (!data.url) return jsonRes(res, 400, { error: 'url required' })
      const newSb = {
        id: 'sb_' + crypto.randomBytes(6).toString('hex'),
        name: data.name || '',
        url: data.url,
      }
      const updated = await Topics.update(id, {
        storyboards: [...(topic.storyboards || []), newSb],
      })
      return jsonRes(res, 201, { storyboards: updated.storyboards })
    }

    // DELETE /api/topics/:id/storyboards/:sbId
    const sbDeleteMatch = pathname.match(/^\/api\/topics\/([a-zA-Z0-9_-]+)\/storyboards\/([a-zA-Z0-9_-]+)$/)
    if (sbDeleteMatch && req.method === 'DELETE') {
      const [, topicId, sbId] = sbDeleteMatch
      const topic = await Topics.getById(topicId)
      if (!topic) return jsonRes(res, 404, { error: 'Topic not found' })
      const sb = (topic.storyboards || []).find(s => s.id === sbId)
      if (sb && sb.url && sb.url.startsWith('/data/assets/sb_')) {
        const filename = sb.url.replace('/data/assets/', '')
        try { fs.unlinkSync(path.join(assetsDir, filename)) } catch { /* ok */ }
      }
      const updated = await Topics.update(topicId, {
        storyboards: (topic.storyboards || []).filter(s => s.id !== sbId),
      })
      return jsonRes(res, 200, { storyboards: updated.storyboards })
    }

    // PUT /api/topics/:id/storyboards/reorder
    const sbReorderMatch = pathname.match(/^\/api\/topics\/([a-zA-Z0-9_-]+)\/storyboards\/reorder$/)
    if (sbReorderMatch && req.method === 'PUT') {
      const id = sbReorderMatch[1]
      const topic = await Topics.getById(id)
      if (!topic) return jsonRes(res, 404, { error: 'Topic not found' })
      const body = await collectBody(req, 1024 * 64)
      const { ids } = JSON.parse(body.toString('utf-8'))
      if (!Array.isArray(ids)) return jsonRes(res, 400, { error: 'ids must be array' })
      const sbMap = {}
      for (const sb of (topic.storyboards || [])) { sbMap[sb.id] = sb }
      const reordered = ids.map(id => sbMap[id]).filter(Boolean)
      // Append any not in ids list
      for (const sb of (topic.storyboards || [])) {
        if (!ids.includes(sb.id)) reordered.push(sb)
      }
      const updated = await Topics.update(id, { storyboards: reordered })
      return jsonRes(res, 200, { storyboards: updated.storyboards })
    }

    // ── Settings ──

    if (pathname === '/api/settings' && req.method === 'GET') {
      const all = await Settings.findAll()
      const settings = {}
      for (const doc of all) {
        settings[doc.id] = doc.value
      }
      return jsonRes(res, 200, { settings })
    }

    const settingMatch = pathname.match(/^\/api\/settings\/([a-zA-Z0-9_-]+)$/)
    if (settingMatch && req.method === 'PUT') {
      const key = settingMatch[1]
      const body = await collectBody(req, 1024 * 64)
      const { value } = JSON.parse(body.toString('utf-8'))
      const existing = await Settings.getById(key)
      if (existing) {
        await Settings.update(key, { value })
      } else {
        await Settings.create({ id: key, value })
      }
      return jsonRes(res, 200, { ok: true })
    }

    // ── Migration endpoint (receive localStorage export) ──

    if (pathname === '/api/migrate' && req.method === 'POST') {
      const body = await collectBody(req, 100 * 1024 * 1024) // 100MB for base64 images
      const data = JSON.parse(body.toString('utf-8'))

      let imported = 0

      // Migrate topics (with base64 storyboards)
      if (Array.isArray(data.topics)) {
        for (const t of data.topics) {
          const storyboards = []
          for (const sb of (t.storyboards || [])) {
            if (sb.dataUrl && sb.dataUrl.startsWith('data:')) {
              // Convert base64 to file
              const match = sb.dataUrl.match(/^data:([^;]+);base64,(.+)$/)
              if (match) {
                const mimeType = match[1]
                const extMap = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' }
                const ext = extMap[mimeType] || '.png'
                const safeName = 'sb_' + crypto.randomBytes(8).toString('hex') + ext
                fs.writeFileSync(path.join(assetsDir, safeName), Buffer.from(match[2], 'base64'))
                storyboards.push({
                  id: sb.id || 'sb_' + crypto.randomBytes(6).toString('hex'),
                  name: sb.name || '',
                  url: '/data/assets/' + safeName,
                })
              }
            } else if (sb.url) {
              // Already a URL reference
              storyboards.push({
                id: sb.id || 'sb_' + crypto.randomBytes(6).toString('hex'),
                name: sb.name || '',
                url: sb.url,
              })
            }
          }

          await Topics.create({
            id: crypto.randomBytes(6).toString('hex'),
            name: t.name || '未命名',
            markdown: t.markdown || '',
            order: imported,
            storyboards,
          })
          imported++
        }
      }

      // Migrate settings
      if (data.settings) {
        for (const [key, value] of Object.entries(data.settings)) {
          const existing = await Settings.getById(key)
          if (existing) {
            await Settings.update(key, { value })
          } else {
            await Settings.create({ id: key, value })
          }
        }
      }

      return jsonRes(res, 200, { ok: true, imported })
    }

    // ── Assets CRUD (SDK collection) ──

    if (pathname === '/api/assets' && req.method === 'GET') {
      const folder = parsed.searchParams.get('folder') || null
      const allAssets = folder
        ? await Assets.findAll({ where: { folder } })
        : await Assets.findAll()
      return jsonRes(res, 200, { assets: allAssets })
    }

    if (pathname === '/api/assets' && req.method === 'POST') {
      const ct = req.headers['content-type'] || ''
      const boundaryMatch = ct.match(/boundary=(.+)/)
      if (!boundaryMatch) {
        return jsonRes(res, 400, { error: 'Missing multipart boundary' })
      }

      const body = await collectBody(req, 50 * 1024 * 1024)
      const allParts = parseMultipart(body, boundaryMatch[1])
      const filePart = allParts.find(p => p.filename)
      if (!filePart) {
        return jsonRes(res, 400, { error: 'No file in upload' })
      }

      const folderPart = allParts.find(p => p.name === 'folder')
      const folder = folderPart ? folderPart.data.toString('utf-8') : 'default'

      const ext = path.extname(filePart.filename).toLowerCase() || '.bin'
      const safeName = crypto.randomBytes(8).toString('hex') + ext
      fs.writeFileSync(path.join(assetsDir, safeName), filePart.data)

      const entry = await Assets.create({
        id: crypto.randomBytes(6).toString('hex'),
        filename: safeName,
        originalName: filePart.filename,
        type: filePart.contentType || MIME[ext] || 'application/octet-stream',
        size: filePart.data.length,
        folder,
      })

      // Ensure folder exists in settings
      const foldersDoc = await Settings.getById('folders')
      const folders = foldersDoc ? foldersDoc.value : ['default']
      if (!folders.includes(folder)) {
        await Settings.update('folders', { value: [...folders, folder] })
      }

      return jsonRes(res, 201, { asset: entry })
    }

    // DELETE /api/assets/:id
    const assetDeleteMatch = pathname.match(/^\/api\/assets\/([a-f0-9]+)$/)
    if (assetDeleteMatch && req.method === 'DELETE') {
      const id = assetDeleteMatch[1]
      const asset = await Assets.getById(id)
      if (!asset) {
        return jsonRes(res, 404, { error: 'Asset not found' })
      }
      try { fs.unlinkSync(path.join(assetsDir, asset.filename)) } catch { /* ok */ }
      await Assets.remove(id)
      return jsonRes(res, 200, { ok: true })
    }

    // ── Folders (from settings) ──

    if (pathname === '/api/folders' && req.method === 'GET') {
      const foldersDoc = await Settings.getById('folders')
      return jsonRes(res, 200, { folders: foldersDoc ? foldersDoc.value : ['default'] })
    }

    if (pathname === '/api/folders' && req.method === 'POST') {
      const body = await collectBody(req, 1024)
      const { name } = JSON.parse(body.toString('utf-8'))
      if (!name || typeof name !== 'string' || name.length > 50) {
        return jsonRes(res, 400, { error: 'Invalid folder name' })
      }
      const safeName = name.replace(/[^\w\u4e00-\u9fff\u3400-\u4dbf-]/g, '_')
      const foldersDoc = await Settings.getById('folders')
      const folders = foldersDoc ? foldersDoc.value : ['default']
      if (folders.includes(safeName)) {
        return jsonRes(res, 409, { error: 'Folder already exists' })
      }
      await Settings.update('folders', { value: [...folders, safeName] })
      return jsonRes(res, 201, { folder: safeName })
    }

    // DELETE /api/folders/:name
    const folderDeleteMatch = pathname.match(/^\/api\/folders\/(.+)$/)
    if (folderDeleteMatch && req.method === 'DELETE') {
      const folderName = decodeURIComponent(folderDeleteMatch[1])
      if (folderName === 'default') {
        return jsonRes(res, 400, { error: 'Cannot delete default folder' })
      }
      const foldersDoc = await Settings.getById('folders')
      const folders = foldersDoc ? foldersDoc.value : ['default']
      if (!folders.includes(folderName)) {
        return jsonRes(res, 404, { error: 'Folder not found' })
      }
      // Move assets in this folder to default
      const folderAssets = await Assets.findAll({ where: { folder: folderName } })
      for (const a of folderAssets) {
        await Assets.update(a.id, { folder: 'default' })
      }
      await Settings.update('folders', { value: folders.filter(f => f !== folderName) })
      return jsonRes(res, 200, { ok: true })
    }

    // ── Ideas CRUD (SDK collection) ──

    if (pathname === '/api/ideas' && req.method === 'GET') {
      const ideas = await Ideas.findAll()
      return jsonRes(res, 200, { ideas })
    }

    if (pathname === '/api/ideas' && req.method === 'POST') {
      const body = await collectBody(req, 1024 * 1024)
      const data = JSON.parse(body.toString('utf-8'))
      const idea = await Ideas.create({
        id: crypto.randomBytes(6).toString('hex'),
        title: (data.title || '').slice(0, 200) || '未命名點子',
        status: 'idea',
        sections: data.sections || [{ label: '開場', content: '' }],
        notes: (data.notes || '').slice(0, 5000),
        assets: [],
      })
      return jsonRes(res, 201, { idea })
    }

    // PUT /api/ideas/:id
    const ideaUpdateMatch = pathname.match(/^\/api\/ideas\/([a-f0-9]+)$/)
    if (ideaUpdateMatch && req.method === 'PUT') {
      const id = ideaUpdateMatch[1]
      const body = await collectBody(req, 1024 * 1024)
      const data = JSON.parse(body.toString('utf-8'))
      const updates = {}
      if (data.title !== undefined) updates.title = data.title.slice(0, 200)
      if (data.status !== undefined) updates.status = data.status
      if (data.sections !== undefined) updates.sections = data.sections
      if (data.notes !== undefined) updates.notes = data.notes.slice(0, 5000)
      if (data.assets !== undefined) updates.assets = data.assets
      const updated = await Ideas.update(id, updates)
      if (!updated) return jsonRes(res, 404, { error: 'Idea not found' })
      return jsonRes(res, 200, { idea: updated })
    }

    // DELETE /api/ideas/:id
    const ideaDeleteMatch = pathname.match(/^\/api\/ideas\/([a-f0-9]+)$/)
    if (ideaDeleteMatch && req.method === 'DELETE') {
      const id = ideaDeleteMatch[1]
      const idea = await Ideas.getById(id)
      if (!idea) return jsonRes(res, 404, { error: 'Idea not found' })
      for (const a of (idea.assets || [])) {
        try { fs.unlinkSync(path.join(assetsDir, a.filename)) } catch { /* ok */ }
      }
      await Ideas.remove(id)
      return jsonRes(res, 200, { ok: true })
    }

    // POST /api/ideas/:id/assets
    const ideaAssetMatch = pathname.match(/^\/api\/ideas\/([a-f0-9]+)\/assets$/)
    if (ideaAssetMatch && req.method === 'POST') {
      const id = ideaAssetMatch[1]
      const ct = req.headers['content-type'] || ''
      const boundaryMatch = ct.match(/boundary=(.+)/)
      if (!boundaryMatch) return jsonRes(res, 400, { error: 'Missing multipart boundary' })

      const body = await collectBody(req, 50 * 1024 * 1024)
      const allParts = parseMultipart(body, boundaryMatch[1])
      const filePart = allParts.find(p => p.filename)
      if (!filePart) return jsonRes(res, 400, { error: 'No file in upload' })

      const ext = path.extname(filePart.filename).toLowerCase() || '.bin'
      const safeName = crypto.randomBytes(8).toString('hex') + ext
      fs.writeFileSync(path.join(assetsDir, safeName), filePart.data)

      const asset = {
        id: crypto.randomBytes(6).toString('hex'),
        filename: safeName,
        originalName: filePart.filename,
        type: filePart.contentType || MIME[ext] || 'application/octet-stream',
        size: filePart.data.length,
        createdAt: new Date().toISOString(),
      }

      const idea = await Ideas.getById(id)
      if (!idea) return jsonRes(res, 404, { error: 'Idea not found' })
      await Ideas.update(id, { assets: [...(idea.assets || []), asset] })
      return jsonRes(res, 201, { asset })
    }

    // DELETE /api/ideas/:ideaId/assets/:assetId
    const ideaAssetDelMatch = pathname.match(/^\/api\/ideas\/([a-f0-9]+)\/assets\/([a-f0-9]+)$/)
    if (ideaAssetDelMatch && req.method === 'DELETE') {
      const [, ideaId, assetId] = ideaAssetDelMatch
      const idea = await Ideas.getById(ideaId)
      if (!idea) return jsonRes(res, 404, { error: 'Idea not found' })
      const asset = (idea.assets || []).find(a => a.id === assetId)
      if (asset) {
        try { fs.unlinkSync(path.join(assetsDir, asset.filename)) } catch { /* ok */ }
      }
      await Ideas.update(ideaId, {
        assets: (idea.assets || []).filter(a => a.id !== assetId),
      })
      return jsonRes(res, 200, { ok: true })
    }

    // ── Recordings: upload + serve ──

    if (pathname === '/api/recordings' && req.method === 'POST') {
      const ct = req.headers['content-type'] || ''
      const boundaryMatch = ct.match(/boundary=(.+)/)
      if (!boundaryMatch) return jsonRes(res, 400, { error: 'Missing multipart boundary' })

      const body = await collectBody(req, 500 * 1024 * 1024) // 500MB max
      const fileParts = parseMultipart(body, boundaryMatch[1]).filter(p => p.filename)
      if (fileParts.length === 0) return jsonRes(res, 400, { error: 'No file' })

      const filePart = fileParts[0]
      const ext = path.extname(filePart.filename).toLowerCase() || '.webm'
      const safeName = 'rec_' + crypto.randomBytes(8).toString('hex') + ext
      fs.writeFileSync(path.join(recordingsDir, safeName), filePart.data)

      const recordingUrl = `/data/recordings/${safeName}`
      return jsonRes(res, 201, { url: recordingUrl, filename: safeName })
    }

    if (pathname.startsWith('/data/recordings/')) {
      const recFile = pathname.replace('/data/recordings/', '')
      if (recFile.includes('..') || recFile.includes('/') || recFile.includes('\\')) {
        res.writeHead(403); res.end('Forbidden'); return
      }
      const filePath = path.join(recordingsDir, recFile)
      return fs.readFile(filePath, (err, fileData) => {
        if (err) { res.writeHead(404); res.end('Not Found'); return }
        const ext = path.extname(filePath).toLowerCase()
        const contentType = MIME[ext] || 'application/octet-stream'
        // Support Range requests for video
        const range = req.headers.range
        if (range) {
          const stat = fs.statSync(filePath)
          const parts = range.replace(/bytes=/, '').split('-')
          const start = parseInt(parts[0], 10)
          const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
            'Content-Type': contentType,
          })
          fs.createReadStream(filePath, { start, end }).pipe(res)
          return
        }
        res.writeHead(200, { 'Content-Type': contentType })
        res.end(fileData)
      })
    }

    // ── Transcribe: send recording to ReelScript ──

    if (pathname === '/api/transcribe' && req.method === 'POST') {
      if (!gw) return jsonRes(res, 500, { error: 'Gateway SDK not available' })
      const body = await collectBody(req, 1024 * 64)
      const data = JSON.parse(body.toString('utf-8'))
      const videoUrl = data.url
      if (!videoUrl) return jsonRes(res, 400, { error: 'url required' })

      try {
        // Make URL absolute for ReelScript
        const absoluteUrl = videoUrl.startsWith('http')
          ? videoUrl
          : `http://127.0.0.1:${port}${videoUrl}`

        const result = await gw.call('reelscript_process_video', { url: absoluteUrl })
        return jsonRes(res, 200, result)
      } catch (err) {
        return jsonRes(res, 500, { error: 'Transcription failed: ' + err.message })
      }
    }

    // ── Transcribe status: poll ReelScript video status ──

    const transcribeStatusMatch = pathname.match(/^\/api\/transcribe\/([a-zA-Z0-9_-]+)$/)
    if (transcribeStatusMatch && req.method === 'GET') {
      if (!gw) return jsonRes(res, 500, { error: 'Gateway SDK not available' })
      const videoId = transcribeStatusMatch[1]
      try {
        const result = await gw.call('reelscript_get_video', { video_id: videoId })
        return jsonRes(res, 200, result)
      } catch (err) {
        return jsonRes(res, 500, { error: err.message })
      }
    }

    // ── Benchmark: analyze foreign video ──

    if (pathname === '/api/benchmark' && req.method === 'POST') {
      if (!gw) return jsonRes(res, 500, { error: 'Gateway SDK not available' })
      const body = await collectBody(req, 1024 * 64)
      const data = JSON.parse(body.toString('utf-8'))
      if (!data.url) return jsonRes(res, 400, { error: 'url required' })

      try {
        // Send to ReelScript for processing
        const result = await gw.call('reelscript_process_video', { url: data.url })
        const videoId = result.video_id || result.id

        // Save benchmark record
        const benchmark = await Benchmarks.create({
          id: crypto.randomBytes(6).toString('hex'),
          url: data.url,
          video_id: videoId,
          status: 'processing',
          title: data.url,
        })

        return jsonRes(res, 201, { benchmark })
      } catch (err) {
        return jsonRes(res, 500, { error: 'Failed to start analysis: ' + err.message })
      }
    }

    if (pathname === '/api/benchmark' && req.method === 'GET') {
      const benchmarks = await Benchmarks.findAll({ sort: '-created_at' })
      return jsonRes(res, 200, { benchmarks })
    }

    // GET /api/benchmark/:id — poll status + fetch full data when ready
    const benchmarkGetMatch = pathname.match(/^\/api\/benchmark\/([a-zA-Z0-9_-]+)$/)
    if (benchmarkGetMatch && req.method === 'GET') {
      if (!gw) return jsonRes(res, 500, { error: 'Gateway SDK not available' })
      const id = benchmarkGetMatch[1]
      const benchmark = await Benchmarks.getById(id)
      if (!benchmark) return jsonRes(res, 404, { error: 'Benchmark not found' })

      try {
        const video = await gw.call('reelscript_get_video', { video_id: benchmark.video_id })
        const status = video.status || 'processing'

        // Update local status
        if (status !== benchmark.status) {
          await Benchmarks.update(id, {
            status,
            title: video.title || benchmark.title,
          })
        }

        return jsonRes(res, 200, { benchmark: { ...benchmark, status }, video })
      } catch (err) {
        return jsonRes(res, 200, { benchmark, video: null, error: err.message })
      }
    }

    // DELETE /api/benchmark/:id
    const benchmarkDelMatch = pathname.match(/^\/api\/benchmark\/([a-zA-Z0-9_-]+)$/)
    if (benchmarkDelMatch && req.method === 'DELETE') {
      const id = benchmarkDelMatch[1]
      await Benchmarks.remove(id)
      return jsonRes(res, 200, { ok: true })
    }

    // POST /api/benchmark/:id/generate — create Topic + Prompter from benchmark data
    const benchmarkGenMatch = pathname.match(/^\/api\/benchmark\/([a-zA-Z0-9_-]+)\/generate$/)
    if (benchmarkGenMatch && req.method === 'POST') {
      if (!gw) return jsonRes(res, 500, { error: 'Gateway SDK not available' })
      const id = benchmarkGenMatch[1]
      const benchmark = await Benchmarks.getById(id)
      if (!benchmark) return jsonRes(res, 404, { error: 'Benchmark not found' })

      const body = await collectBody(req, 1024 * 64)
      const opts = JSON.parse(body.toString('utf-8'))
      // opts.mode: 'topic' | 'prompter' | 'both'
      const mode = opts.mode || 'both'

      try {
        const video = await gw.call('reelscript_get_video', { video_id: benchmark.video_id })
        const segments = (video.transcript && video.transcript.segments) || video.segments || []
        const appreciation = (video.transcript && video.transcript.appreciation) || video.appreciation || {}

        const theme = appreciation.theme || video.title || '未命名主題'
        const keyPoints = appreciation.keyPoints || []
        const goldenQuotes = appreciation.goldenQuotes || []

        let topicId = null
        let prompterText = null

        // Generate markdown (tree structure)
        if (mode === 'topic' || mode === 'both') {
          let markdown = `# ${theme}\n\n`

          for (let i = 0; i < keyPoints.length; i++) {
            markdown += `## 重點${i + 1}\n`
            markdown += `- ${keyPoints[i]}\n\n`
          }

          if (goldenQuotes.length > 0) {
            markdown += `## 金句\n`
            for (const q of goldenQuotes) {
              markdown += `- ${q.zh || q.en}\n`
            }
            markdown += '\n'
          }

          const allTopics = await Topics.findAll()
          const maxOrder = allTopics.reduce((max, t) => Math.max(max, t.order || 0), -1)

          const topic = await Topics.create({
            id: crypto.randomBytes(6).toString('hex'),
            name: theme,
            markdown,
            order: maxOrder + 1,
            storyboards: [],
          })
          topicId = topic.id
        }

        // Generate prompter text (Chinese script for oral delivery)
        if (mode === 'prompter' || mode === 'both') {
          const lines = []
          lines.push('【開頭 — Hook】')
          lines.push(`今天看了一個很棒的影片，主題是「${theme}」`)
          lines.push('我把精華整理出來，分享給你們')
          lines.push('')

          for (let i = 0; i < keyPoints.length; i++) {
            lines.push(`【重點${i + 1}】`)
            lines.push(keyPoints[i])
            // Add relevant translated segments
            const relevantSegs = segments
              .filter(s => s.translation)
              .slice(i * Math.ceil(segments.length / Math.max(keyPoints.length, 1)),
                     (i + 1) * Math.ceil(segments.length / Math.max(keyPoints.length, 1)))
              .slice(0, 3)
            for (const seg of relevantSegs) {
              lines.push(seg.translation)
            }
            lines.push('')
          }

          if (goldenQuotes.length > 0) {
            lines.push('【金句分享】')
            for (const q of goldenQuotes) {
              lines.push(`「${q.zh || q.en}」`)
            }
            lines.push('')
          }

          lines.push('【收尾 — CTA】')
          lines.push('如果覺得有幫助，記得按讚分享')
          lines.push('我們下次見！')

          prompterText = lines.join('\n')

          // Save prompter text to settings
          if (mode === 'both' || mode === 'prompter') {
            const existing = await Settings.getById('prompter_text')
            if (existing) {
              await Settings.update('prompter_text', { value: prompterText })
            } else {
              await Settings.create({ id: 'prompter_text', value: prompterText })
            }
          }
        }

        // Update benchmark status
        await Benchmarks.update(id, { status: 'generated' })

        return jsonRes(res, 200, { topicId, prompterText })
      } catch (err) {
        return jsonRes(res, 500, { error: 'Generate failed: ' + err.message })
      }
    }

    // ── Serve files from /data/assets/ ──

    if (pathname.startsWith('/data/assets/')) {
      const assetFile = pathname.replace('/data/assets/', '')
      if (assetFile.includes('..') || assetFile.includes('/') || assetFile.includes('\\')) {
        res.writeHead(403)
        res.end('Forbidden')
        return
      }
      const filePath = path.join(assetsDir, assetFile)
      return fs.readFile(filePath, (err, fileData) => {
        if (err) {
          res.writeHead(404)
          res.end('Not Found')
          return
        }
        const ext = path.extname(filePath).toLowerCase()
        const contentType = MIME[ext] || 'application/octet-stream'
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=86400',
        })
        res.end(fileData)
      })
    }

    // ── Clean URLs — /admin → /admin.html ──

    if (!pathname.includes('.') && pathname !== '/') {
      const tryHtml = path.join(publicDir, pathname + '.html')
      if (fs.existsSync(tryHtml)) {
        return fs.readFile(tryHtml, (err, fileData) => {
          if (err) { res.writeHead(500); res.end('Error'); return }
          res.writeHead(200, { 'Content-Type': MIME['.html'] })
          res.end(fileData)
        })
      }
    }

    // ── Static files (public/) ──

    const file = pathname === '/' ? '/index.html' : pathname
    const filePath = path.join(publicDir, file)

    if (!filePath.startsWith(publicDir)) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }

    fs.readFile(filePath, (err, fileData) => {
      if (err) {
        res.writeHead(404)
        res.end('Not Found')
        return
      }
      const ext = path.extname(filePath).toLowerCase()
      const contentType = MIME[ext] || 'application/octet-stream'
      res.writeHead(200, { 'Content-Type': contentType })
      res.end(fileData)
    })
  } catch (err) {
    console.error('Request error:', err)
    if (!res.headersSent) {
      jsonRes(res, 500, { error: err.message })
    }
  }
}

// --- Start ---

migrateJsonToDb()
  .then(() => {
    http.createServer(handleRequest).listen(port, () => {
      console.log(`ReelMaker running on :${port}`)
    })
  })
  .catch(err => {
    console.error('Migration failed:', err)
    // Start anyway so health checks don't fail
    http.createServer(handleRequest).listen(port, () => {
      console.log(`ReelMaker running on :${port} (migration had errors)`)
    })
  })
