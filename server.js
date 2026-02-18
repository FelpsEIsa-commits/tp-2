const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');


// In-memory chart data: stores timestamps and deposit values for the total (aggregated)
const chartData = {
  labels: [],
  values: []
};

// Per-user data: maps user names to objects that hold labels, values and per-entry metadata.
// Each user entry has the form:
//   labels: array of strings (timestamps)
//   values: array of numbers (deposits)
//   entries: array of objects { time: string, value: number, totalIndex: number }
// The `entries` array stores individual deposits along with the index in the global chart data
// to allow editing of the timestamp later. When editing a deposit's time, we update the
// corresponding label in userData.labels and chartData.labels.
const userData = {};

// Logs of actions performed by administrators
const logs = [];

// Monthly history snapshots to allow resets and restores
const monthlyHistory = [];

// Current month identifier (YYYY-MM)
let currentMonth = new Date().toISOString().slice(0, 7);

// Simple credentials store. Loaded from a JSON file on startup and saved on modifications.
const CREDENTIALS_FILE = path.join(__dirname, 'credentials.json');
let credentials = [];

/**
 * Load credentials from the JSON file. If the file does not exist, initialize
 * with the default master account (Esther). Any parse error will result
 * in resetting the credentials to the default. The file is stored in the
 * project root alongside the server script.
 */
function loadCredentials() {
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) {
      const text = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        credentials = parsed;
        return;
      }
    }
  } catch (err) {
    console.error('Erro ao carregar credenciais:', err);
  }
  // Default credentials with master account
  credentials = [ { name: 'Esther', password: '1705', isMaster: true } ];
  saveCredentials();
}

/**
 * Save the current credentials array to the JSON file. If writing fails, log
 * the error but continue operating with in-memory data.
 */
function saveCredentials() {
  try {
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2));
  } catch (err) {
    console.error('Erro ao salvar credenciais:', err);
  }
}

/**
 * Helper to add an entry to the logs.
 * @param {string} adminName - Name of the administrator performing the action
 * @param {string} action - Short description of the action
 * @param {any} details - Additional details about the action
 */
function addLog(adminName, action, details) {
  logs.push({ timestamp: new Date().toISOString(), admin: adminName || 'unknown', action, details });
}

/**
 * Handles user registration. Validates and stores new credentials. Responds
 * with success or error status.
 * @param {string} name - User name
 * @param {string} password - User password
 * @param {http.ServerResponse} res - Response object
 */
function handleRegister(name, password, res) {
  // Basic validation
  if (!name || !password) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Nome e senha são obrigatórios' }));
    return;
  }
  const normalized = name.normalize('NFD').replace(/\s+/g, '').toLowerCase();
  // Prevent duplicate names (case-insensitive)
  const exists = credentials.some((c) => c.name.normalize('NFD').replace(/\s+/g, '').toLowerCase() === normalized);
  if (exists) {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Usuário já existe' }));
    return;
  }
  const newCred = { name, password, isMaster: false };
  credentials.push(newCred);
  saveCredentials();
  addLog(name, 'register', {});
  res.writeHead(201, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: 'Usuário registrado', user: { name, isMaster: false } }));
}

/**
 * Handles user login. Validates credentials and responds with isMaster flag.
 * @param {string} name - User name
 * @param {string} password - User password
 * @param {http.ServerResponse} res - Response object
 */
function handleLogin(name, password, res) {
  if (!name || !password) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Nome e senha são obrigatórios' }));
    return;
  }
  // Find user by normalized name, allowing minor spelling differences (e.g., Ester vs. Esther)
  const normalized = name.normalize('NFD').replace(/\s+/g, '').toLowerCase();
  // Remove any 'h' characters to allow matching Ester -> Esther
  const normalizedNoH = normalized.replace(/h/g, '');
  let userCred = null;
  for (const c of credentials) {
    const credNorm = c.name.normalize('NFD').replace(/\s+/g, '').toLowerCase();
    const credNormNoH = credNorm.replace(/h/g, '');
    if (normalized === credNorm || normalizedNoH === credNormNoH) {
      userCred = c;
      break;
    }
  }
  if (!userCred || userCred.password !== password) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Nome ou senha inválidos' }));
    return;
  }
  // Login successful
  addLog(name, 'login', {});
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: 'Login bem-sucedido', user: { name: userCred.name, isMaster: userCred.isMaster } }));
}

// Team data: array of objects { id, name, description }
let teamData = [
  {
    id: 'esther',
    name: 'Esther',
    description: 'Líder principal responsável pelas decisões estratégicas e comunicação oficial.'
  },
  {
    id: 'evelyn',
    name: 'Evelyn',
    description: 'Gestora financeira, cuida da organização e do controle de valores.'
  },
  {
    id: 'lia',
    name: 'Lia',
    description: 'Assistente analítica responsável por análises, gráficos e resumos.'
  }
];

// List of connected SSE clients
const clients = [];

// Load credentials on startup
loadCredentials();

// Determine the MIME type based on file extension
const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon'
};

// Utility to sanitize a user or member name into a safe identifier. Similar to front-end sanitizeId.
function sanitizeName(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^\w]/g, '')
    .toLowerCase();
}

/**
 * Serves a static file from the public directory.
 */
function serveStaticFile(filePath, res) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('File not found');
      return;
    }
    const ext = path.extname(filePath);
    const mimeType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mimeType });
    res.end(data);
  });
}

/**
 * Broadcasts the updated chart data to all connected SSE clients.
 */
function broadcastChartData() {
  const payload = JSON.stringify({
    totalLabels: chartData.labels,
    totalValues: chartData.values,
    users: userData,
    team: teamData
  });
  clients.forEach((client) => {
    client.write(`data: ${payload}\n\n`);
  });
}

// Create HTTP server
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);

  // Handle adding new values: /add/:value
  if (req.url.startsWith('/add/')) {
    const segments = req.url.split('/');
    const valueString = segments[segments.length - 1];
    const amount = parseFloat(valueString);
    if (!isNaN(amount)) {
      const now = new Date();
      // Use locale string with date and time to allow editing later. Format: DD/MM/YYYY HH:MM:SS
      let label = now.toLocaleString('pt-BR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      // Remove any commas that some locales insert between date and time (e.g., "27/01/2026, 12:30:00")
      label = label.replace(/,/g, '');
      // Push value and label into global chart data and capture the index of this deposit
      chartData.labels.push(label);
      chartData.values.push(amount);
      const totalIndex = chartData.values.length - 1;
      // Parse user and admin from query parameter if present
      const parsedUrl = url.parse(req.url, true);
      const userName = parsedUrl.query.user;
      const adminName = parsedUrl.query.admin;
      if (userName) {
        // Initialize user data object if it doesn't exist
        if (!userData[userName]) {
          userData[userName] = { labels: [], values: [], entries: [] };
        }
        userData[userName].labels.push(label);
        userData[userName].values.push(amount);
        // Store entry metadata for potential editing of time later
        userData[userName].entries.push({ time: label, value: amount, totalIndex });
      }
      // Log deposit action
      addLog(adminName, 'deposit', { user: userName || 'total', value: amount, time: label });
      broadcastChartData();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          message: 'Valor adicionado',
          total: chartData,
          users: userData
        })
      );
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Valor inválido' }));
    }
    return;
  }

  // Team endpoints
  if (parsedUrl.pathname.startsWith('/team')) {
    // GET /team
    if (req.method === 'GET' && parsedUrl.pathname === '/team') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(teamData));
      return;
    }
    // POST /team?name=&description= : create new member
    if (req.method === 'POST' && parsedUrl.pathname === '/team') {
      const { name, description, admin: adminName } = parsedUrl.query;
      if (!name) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Nome é obrigatório' }));
        return;
      }
      // Generate sanitized id
      const id = name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '')
        .toLowerCase();
      // Check if id already exists
      const existing = teamData.find((m) => m.id === id);
      if (existing) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Membro já existe' }));
        return;
      }
      const member = { id, name, description: description || '' };
      teamData.push(member);
      addLog(adminName, 'teamCreate', { member });
      // Broadcast updated team
      broadcastChartData();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(member));
      return;
    }
    // PUT /team/:id?name=&description= : update member
    if (req.method === 'PUT' && /^\/team\/[\w-]+$/.test(parsedUrl.pathname)) {
      const id = parsedUrl.pathname.split('/')[2];
      const { name, description, admin: adminName } = parsedUrl.query;
      const idx = teamData.findIndex((m) => m.id === id);
      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Membro não encontrado' }));
        return;
      }
      if (name) teamData[idx].name = name;
      if (description !== undefined) teamData[idx].description = description;
      addLog(adminName, 'teamUpdate', { id, name, description });
      broadcastChartData();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(teamData[idx]));
      return;
    }
    // DELETE /team/:id : remove member
    if (req.method === 'DELETE' && /^\/team\/[\w-]+$/.test(parsedUrl.pathname)) {
      const id = parsedUrl.pathname.split('/')[2];
      const idx = teamData.findIndex((m) => m.id === id);
      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Membro não encontrado' }));
        return;
      }
      const removed = teamData.splice(idx, 1)[0];
      const adminName = parsedUrl.query.admin;
      addLog(adminName, 'teamDelete', { id: removed.id, name: removed.name });
      broadcastChartData();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(removed));
      return;
    }
    // If method not allowed
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Método não permitido' }));
    return;
  }

  // Participants list
  if (parsedUrl.pathname === '/participants' && req.method === 'GET') {
    const list = Object.keys(userData).map((name) => {
      const values = userData[name].values || [];
      const total = values.reduce((sum, v) => sum + v, 0);
      return {
        id: sanitizeName(name),
        name,
        count: values.length,
        total
      };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(list));
    return;
  }

  // Retrieve entries for a specific user: GET /entries?user=Name
  if (parsedUrl.pathname === '/entries' && req.method === 'GET') {
    const userName = parsedUrl.query.user;
    if (!userName) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Usuário não especificado' }));
      return;
    }
    const data = userData[userName];
    if (!data || !Array.isArray(data.entries)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Usuário não encontrado ou sem entradas' }));
      return;
    }
    // Return entries with index to allow editing on front-end
    const entries = data.entries.map((entry, idx) => ({ index: idx, time: entry.time, value: entry.value }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ entries }));
    return;
  }

  // Edit entry time: PUT /entry?user=&index=&newTime=&admin=
  if (parsedUrl.pathname === '/entry' && req.method === 'PUT') {
    const { user: userName, index, newTime, admin: adminName } = parsedUrl.query;
    if (!userName || index === undefined || !newTime) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Parâmetros ausentes' }));
      return;
    }
    const idx = parseInt(index, 10);
    if (isNaN(idx)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Índice inválido' }));
      return;
    }
    const data = userData[userName];
    if (!data || !Array.isArray(data.entries) || idx < 0 || idx >= data.entries.length) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Entrada não encontrada' }));
      return;
    }
    // Update the user's entry time
    const entry = data.entries[idx];
    const oldTime = entry.time;
    entry.time = newTime;
    // Also update the label in userData.labels array
    if (Array.isArray(data.labels) && data.labels[idx]) {
      data.labels[idx] = newTime;
    }
    // Update the global chart label at the corresponding index
    const totalIndex = entry.totalIndex;
    if (totalIndex >= 0 && totalIndex < chartData.labels.length) {
      chartData.labels[totalIndex] = newTime;
    }
    // Log the edit action
    addLog(adminName, 'editEntryTime', { user: userName, index: idx, oldTime, newTime });
    broadcastChartData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Horário da entrada atualizado' }));
    return;
  }

  // Delete participant (user)
  if (req.method === 'DELETE' && /^\/users\/[\w\-_]+$/.test(parsedUrl.pathname)) {
    const id = parsedUrl.pathname.split('/')[2];
    const adminName = parsedUrl.query.admin;
    // Find the original key by sanitized id
    const key = Object.keys(userData).find((name) => sanitizeName(name) === id);
    if (!key) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Participante não encontrado' }));
      return;
    }
    delete userData[key];
    addLog(adminName, 'userDelete', { id, name: key });
    broadcastChartData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Participante removido' }));
    return;
  }

  // Update participant name: PUT /users/:id?newName=
  if (req.method === 'PUT' && /^\/users\/[\w\-_]+$/.test(parsedUrl.pathname)) {
    const id = parsedUrl.pathname.split('/')[2];
    const adminName = parsedUrl.query.admin;
    const newName = parsedUrl.query.newName;
    if (!newName) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Novo nome não especificado' }));
      return;
    }
    const key = Object.keys(userData).find((name) => sanitizeName(name) === id);
    if (!key) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Participante não encontrado' }));
      return;
    }
    // Move data to new key
    const data = userData[key];
    delete userData[key];
    userData[newName] = { labels: [...data.labels], values: [...data.values] };
    addLog(adminName, 'userRename', { oldName: key, newName });
    broadcastChartData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Participante renomeado', oldName: key, newName }));
    return;
  }

  // SSE endpoint: /events
  if (parsedUrl.pathname === '/events') {
    // Set headers for SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    // Provide initial payload with user data and total
    const initPayload = JSON.stringify({
      totalLabels: chartData.labels,
      totalValues: chartData.values,
      users: userData,
      team: teamData
    });
    res.write(`data: ${initPayload}\n\n`);
    // Add this client to the list
    clients.push(res);
    // Remove client when connection closes
    req.on('close', () => {
      const idx = clients.indexOf(res);
      if (idx !== -1) clients.splice(idx, 1);
    });
    return;
  }

  // Reset month: POST /reset-month
  if (parsedUrl.pathname === '/reset-month' && req.method === 'POST') {
    const adminName = parsedUrl.query.admin;
    // Save current data into history before reset
    monthlyHistory.push({
      month: currentMonth,
      chart: {
        labels: [...chartData.labels],
        values: [...chartData.values]
      },
      users: JSON.parse(JSON.stringify(userData)),
      team: JSON.parse(JSON.stringify(teamData))
    });
    // Clear current data
    chartData.labels = [];
    chartData.values = [];
    Object.keys(userData).forEach((k) => {
      delete userData[k];
    });
    const previousMonth = currentMonth;
    currentMonth = new Date().toISOString().slice(0, 7);
    addLog(adminName, 'resetMonth', { previousMonth, newMonth: currentMonth });
    broadcastChartData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Mês resetado', previousMonth, newMonth: currentMonth }));
    return;
  }

  // Restore month: POST /restore-month?month=YYYY-MM
  if (parsedUrl.pathname === '/restore-month' && req.method === 'POST') {
    const adminName = parsedUrl.query.admin;
    const month = parsedUrl.query.month;
    if (!month) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Mês não especificado' }));
      return;
    }
    const snapshot = monthlyHistory.find((h) => h.month === month);
    if (!snapshot) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Mês não encontrado' }));
      return;
    }
    // Restore chartData and userData
    chartData.labels = [...snapshot.chart.labels];
    chartData.values = [...snapshot.chart.values];
    // Clear userData and copy from snapshot
    Object.keys(userData).forEach((k) => {
      delete userData[k];
    });
    for (const name in snapshot.users) {
      const data = snapshot.users[name];
      userData[name] = { labels: [...data.labels], values: [...data.values] };
    }
    // Optionally restore team
    teamData = JSON.parse(JSON.stringify(snapshot.team));
    currentMonth = snapshot.month;
    addLog(adminName, 'restoreMonth', { month });
    broadcastChartData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Mês restaurado', month }));
    return;
  }

  // Get history of months: GET /history
  if (parsedUrl.pathname === '/history' && req.method === 'GET') {
    const months = monthlyHistory.map((h) => h.month);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ months }));
    return;
  }

  // User registration: POST /register?name=&password=
  if (parsedUrl.pathname === '/register' && req.method === 'POST') {
    let { name, password } = parsedUrl.query;
    // If not provided via query, try reading JSON body
    if (!name || !password) {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const parsedBody = JSON.parse(body || '{}');
          name = name || parsedBody.name;
          password = password || parsedBody.password;
        } catch (err) {
          // ignore JSON parse error
        }
        handleRegister(name, password, res);
      });
      return;
    }
    handleRegister(name, password, res);
    return;
  }

  // User login: POST /login?name=&password=
  if (parsedUrl.pathname === '/login' && req.method === 'POST') {
    let { name, password } = parsedUrl.query;
    if (!name || !password) {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const parsedBody = JSON.parse(body || '{}');
          name = name || parsedBody.name;
          password = password || parsedBody.password;
        } catch (err) {
          // ignore
        }
        handleLogin(name, password, res);
      });
      return;
    }
    handleLogin(name, password, res);
    return;
  }

  // Change master password: PUT /change-password?admin=Esther&newPassword=
  if (parsedUrl.pathname === '/change-password' && req.method === 'PUT') {
    const adminName = parsedUrl.query.admin;
    const newPassword = parsedUrl.query.newPassword;
    if (!adminName || !newPassword) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Parâmetros ausentes' }));
      return;
    }
    // Only master (Esther) can change own password
    const normalized = adminName.normalize('NFD').replace(/\s+/g, '').toLowerCase();
    if (normalized !== 'esther') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Apenas a administradora mestre pode alterar a própria senha' }));
      return;
    }
    const credIndex = credentials.findIndex((c) => c.name.toLowerCase() === 'esther');
    if (credIndex === -1) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Conta da administradora mestre não encontrada' }));
      return;
    }
    credentials[credIndex].password = newPassword;
    saveCredentials();
    addLog(adminName, 'changePassword', { admin: adminName });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Senha atualizada' }));
    return;
  }

  // Get logs: GET /logs
  if (parsedUrl.pathname === '/logs' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(logs));
    return;
  }

  // Clear logs: DELETE /logs (only master admin 'Esther')
  if (parsedUrl.pathname === '/logs' && req.method === 'DELETE') {
    const adminName = parsedUrl.query.admin;
    if (!adminName || adminName.toLowerCase() !== 'esther') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Permissão negada' }));
      return;
    }
    logs.length = 0;
    addLog(adminName, 'clearLogs', {});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Logs apagados' }));
    return;
  }

  // Upload hero image: POST /upload-hero
  if (parsedUrl.pathname === '/upload-hero' && req.method === 'POST') {
    const adminName = parsedUrl.query.admin;
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const base64 = parsed.data || '';
        const match = base64.match(/^data:.+;base64,(.*)$/);
        const buffer = Buffer.from(match ? match[1] : base64, 'base64');
        const destPath = path.join(__dirname, 'public', 'assets', 'hero.jpg');
        fs.writeFile(destPath, buffer, (err) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Erro ao salvar arquivo' }));
            return;
          }
          addLog(adminName, 'uploadHero', { size: buffer.length });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Imagem atualizada' }));
        });
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Erro ao processar dados' }));
      }
    });
    return;
  }

  // Default: serve static files
  let filePath = path.join(__dirname, 'public', parsedUrl.pathname === '/' ? 'index.html' : parsedUrl.pathname);
  // Prevent path traversal attacks
  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  serveStaticFile(filePath, res);
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
