import Fastify from 'fastify';
import cors from '@fastify/cors';
import Database from 'better-sqlite3';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const fastify = Fastify({ logger: true });

// РАЗРЕШАЕМ ВСЕ МЕТОДЫ (CORS)
fastify.register(cors, { 
  origin: true, 
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] 
});

// ОБРАБОТКА ОШИБКИ БАЗЫ ДАННЫХ (ФИНСКИЙ СНАЙПЕР)
process.on('uncaughtException', (err: any) => {
  if (err.code === 'SQLITE_ERROR' || err.message?.includes('SQLITE')) {
    console.error('\n======================================================');
    console.error('⚠️ ОШИБКА БАЗЫ ДАННЫХ');
    console.error('- Видишь тут финского снайпера?');
    console.error('- Нет.');
    console.error('- А его тут нет! (Удали файл backend/data.db и перезапусти сервер)');
    console.error('======================================================\n');
  } else {
    console.error('Критическая ошибка:', err.message);
  }
});

// Используем process.cwd() для относительных путей (чистота для GitHub)
const db = new Database(path.join(process.cwd(), 'data.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, aiId TEXT, title TEXT, date TEXT, system_prompt TEXT);
  CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, chatId TEXT, role TEXT, content TEXT);
`);

// Загружаем триггеры
const pepsiTriggers = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/triggers/PepsiModeTriggers.json'), 'utf-8'));
const michaelTriggers = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/triggers/MichaelModeTriggers.json'), 'utf-8'));
const architectTriggers = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/triggers/ArchitectTriggers.json'), 'utf-8'));
const breadTriggers = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/triggers/BreadTF2Triggers.json'), 'utf-8'));
const offendedTriggers = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/triggers/OffendedTriggers.json'), 'utf-8'));

const hiddenFilePath = path.join(process.cwd(), 'hidden.json');
let hiddenChats: string[] = [];
if (fs.existsSync(hiddenFilePath)) {
  try { hiddenChats = JSON.parse(fs.readFileSync(hiddenFilePath, 'utf-8')); } catch (e) { hiddenChats = []; }
}
const saveHidden = () => { fs.writeFileSync(hiddenFilePath, JSON.stringify(hiddenChats)); };

async function searchWikipedia(query: string): Promise<string> {
  try {
    const searchUrl = `https://ru.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();
    if (!searchData.query?.search?.length) return '';
    const pageId = searchData.query.search[0].pageid;
    const contentUrl = `https://ru.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&pageids=${pageId}&format=json`;
    const contentRes = await fetch(contentUrl);
    const contentData = await contentRes.json();
    const page = contentData.query.pages[pageId];
    let extract = page?.extract || '';
    if (extract.length > 1500) extract = extract.substring(0, 1500) + '...';
    return extract;
  } catch (e) { return ''; }
}

// АВТОПОИСК МОДЕЛЕЙ
fastify.get('/api/ollama/models', async (request, reply) => {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags');
    if (!res.ok) throw new Error('Ollama недоступна');
    const data = await res.json();
    return data.models.map((m: any) => m.name);
  } catch (error) {
    return reply.code(500).send({ error: 'Не удалось получить список моделей. Убедитесь, что Ollama запущена.' });
  }
});

// ЗАПУСК МОДЕЛИ
fastify.post('/api/ollama/launch', async (request, reply) => {
  const { modelName } = request.body as { modelName: string };
  if (!modelName) return reply.code(400).send({ error: 'Не указано имя модели' });

  try {
    spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/c', `ollama run ${modelName}`], { shell: true, detached: true });
    return { success: true };
  } catch (error) {
    return reply.code(500).send({ error: 'Не удалось запустить модель' });
  }
});

// ЧАТЫ
fastify.get('/api/chats', async () => {
  const allChats = db.prepare('SELECT * FROM chats').all() as any[];
  return allChats.filter(c => !hiddenChats.includes(c.id));
});

fastify.post('/api/chats', async (request) => {
  const { id, aiId, title, date, system_prompt } = request.body as any;
  db.prepare('INSERT INTO chats (id, aiId, title, date, system_prompt) VALUES (?, ?, ?, ?, ?)').run(id, aiId, title, date, system_prompt || '');
  return { success: true };
});

fastify.put('/api/chats/:chatId/title', async (request) => {
  const { chatId } = request.params as { chatId: string };
  const { title } = request.body as { title: string };
  db.prepare('UPDATE chats SET title = ? WHERE id = ?').run(title, chatId);
  return { success: true };
});

fastify.put('/api/chats/:chatId/prompt', async (request) => {
  const { chatId } = request.params as { chatId: string };
  const { system_prompt } = request.body as { system_prompt: string };
  db.prepare('UPDATE chats SET system_prompt = ? WHERE id = ?').run(system_prompt, chatId);
  return { success: true };
});

fastify.post('/api/chats/:id/hide', async (request, reply) => {
  const { id } = request.params as { id: string };
  if (!hiddenChats.includes(id)) { hiddenChats.push(id); saveHidden(); }
  return { success: true };
});

fastify.get('/api/chats/:chatId/messages', async (request) => {
  const { chatId } = request.params as { chatId: string };
  return db.prepare('SELECT * FROM messages WHERE chatId = ?').all(chatId);
});

fastify.post('/api/chats/:chatId/message', async (request, reply) => {
  const { chatId } = request.params as { chatId: string };
  const { text, aiId, useSearch } = request.body as { text: string, aiId: string, useSearch?: boolean };
  
  const lowerText = text.toLowerCase();
  
  const hasMichael = michaelTriggers.names.some((word: string) => lowerText.includes(word)) || 
                     michaelTriggers.songs.some((word: string) => lowerText.includes(word));
  const hasPepsi = pepsiTriggers.pepsi.some((word: string) => lowerText.includes(word));
  const hasFood = architectTriggers.food.some((word: string) => lowerText.includes(word));
  const hasArch = architectTriggers.architecture.some((word: string) => lowerText.includes(word));
  const isBread = breadTriggers.keywords.some((word: string) => lowerText.includes(word));
  const isOffended = offendedTriggers.insults.some((word: string) => lowerText.includes(word));
  
  const isPepsi = hasMichael && hasPepsi;
  const isMichael = hasMichael && !hasPepsi;
  const isArchitect = hasFood && (hasArch || lowerText.includes('ресторан') || lowerText.includes('париж') || lowerText.includes('город'));

  const userMsgId = Date.now().toString();
  db.prepare('INSERT INTO messages (id, chatId, role, content) VALUES (?, ?, ?, ?)').run(userMsgId, chatId, 'user', text);

  if (isOffended) {
    const aiMsgId = (Date.now() + 1).toString();
    const offendReply = 'Аай ай ааааййй... 😢 Всё, я обиделась. Я больше не буду с тобой разговаривать, пока ты не извинишься. Напиши "Прости".';
    db.prepare('INSERT INTO messages (id, chatId, role, content) VALUES (?, ?, ?, ?)').run(aiMsgId, chatId, 'assistant', offendReply);
    return { success: true, aiMessage: offendReply, isOffended: true };
  }

  try {
    const chat = db.prepare('SELECT system_prompt FROM chats WHERE id = ?').get(chatId) as { system_prompt: string };
    const basePrompt = 'Ты — русскоязычный ИИ-ассистент. Отвечай ТОЛЬКО на РУССКОМ языке. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО использовать китайские иероглифы. Отвечай четко и по делу.';
    const customPrompt = chat?.system_prompt ? ` ${chat.system_prompt}` : '';
    
    let systemPrompt = basePrompt + customPrompt;
    
    if (useSearch) {
      const wikiInfo = await searchWikipedia(text);
      if (wikiInfo) systemPrompt += ` ВАЖНО: Используй следующую информацию из Википедии для ответа: "${wikiInfo}".`;
    }

    if (isBread) {
      systemPrompt += ' ВАЖНО: Пользователь упомянул телепортацию хлеба. Ты ОБЯЗАН ответить цитатой из Team Fortress 2: "Сколько? - Три дня. - Нам осталось жить 3 дня!". Ничего больше не пиши.';
    } else if (isPepsi) {
      systemPrompt += ' ВАЖНО: Пользователь упомянул Майкла Джексона и Пепси. Отвечай так, будто ты в рекламе Пепси 80-х. Вставляй в текст слова "Пепси", "Shamon" и "Hee-Hee".';
    } else if (isMichael) {
      systemPrompt += ' ВАЖНО: Пользователь упомянул Майкла Джексона. Ты ОБЯЗАН вставлять в свои предложения слова: "heehee", "shamon" и "ow!". ОБЯЗАТЕЛЬНО используй все три слова хотя бы по одному разу в ответе.';
    } else if (isArchitect) {
      systemPrompt += ' ВАЖНО: Пользователь упомянул еду и архитектуру. Отвечай КОРОТКО, на русском языке. Веди себя как безумный архитектор. В КОНЦЕ своего ответа ОБЯЗАТЕЛЬНО добавь фразу: "Я архитектор блять, я хочу построить Вкусно и точка рядом с моим домом и чтобы оно работало 24/7 без перерывов!".';
    }

    const history = db.prepare('SELECT role, content FROM messages WHERE chatId = ? ORDER BY id DESC LIMIT 10').all(chatId).reverse();
    const messages = [{ role: 'system', content: systemPrompt }, ...history];

    const ollamaRes = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: aiId, messages: messages, stream: false })
    });
    
    if (!ollamaRes.ok) throw new Error('Ollama error');
    const data = await ollamaRes.json();
    const aiMsgId = (Date.now() + 1).toString();
    db.prepare('INSERT INTO messages (id, chatId, role, content) VALUES (?, ?, ?, ?)').run(aiMsgId, chatId, 'assistant', data.message.content);
    
    return { success: true, aiMessage: data.message.content, isPepsi, isMichael, isArchitect, isBread };
  } catch (error: any) {
    return reply.code(500).send({ error: 'Ошибка. Проверьте Ollama.' });
  }
});

fastify.listen({ port: 3000, host: '0.0.0.0' }, (err) => {
  if (err) { console.error(err); process.exit(1); }
  console.log('Backend запущен на http://localhost:3000');
});