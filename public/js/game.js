// public/js/game.js
// Основной клиентский код. Ожидает window.ROOM_ID заданным шаблоном.

const socket = io();
const roomId = window.ROOM_ID || '';
let myPlayerId = null;
let isMyTurn = false;

function debugLog(message, data = null) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}] 🎮 ${message}`, data || '');
  updateDebugInfo(message);
}

function updateDebugInfo(message) {
  const debugInfo = document.getElementById('debugInfo');
  if (debugInfo) {
    const line = document.createElement('div');
    line.className = 'debug-line';
    line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    debugInfo.appendChild(line);
    debugInfo.scrollTop = debugInfo.scrollHeight;
  }
}

debugLog('Инициализация игры', { roomId });

socket.on('connect', () => {
  debugLog('Подключен к серверу', { socketId: socket.id });
  myPlayerId = socket.id;
  const statusEl = document.getElementById('debugStatus');
  if (statusEl) statusEl.textContent = 'Connected';
  const socketIdEl = document.getElementById('debugSocketId');
  if (socketIdEl) socketIdEl.textContent = socket.id;
  const debugRoomEl = document.getElementById('debugRoom');
  if (debugRoomEl) debugRoomEl.textContent = roomId;

  if (roomId && roomId !== '') {
    debugLog('Подключение к комнате', roomId);
    socket.emit('joinRoom', roomId);
  } else {
    debugLog('Ошибка: нет ID комнаты');
    // редиректать на главную можно, если нужно
  }
});

socket.on('disconnect', () => {
  debugLog('Отключен от сервера');
  const statusEl = document.getElementById('debugStatus');
  if (statusEl) statusEl.textContent = 'Disconnected';
});

socket.on('connect_error', (error) => {
  debugLog('Ошибка подключения', error);
  const statusEl = document.getElementById('debugStatus');
  if (statusEl) statusEl.textContent = 'Error';
});

socket.on('gameState', (gameState) => {
  debugLog('Получено состояние игры', { status: gameState.status, players: gameState.players.length, currentPlayer: gameState.players[gameState.currentPlayerIndex]?.username });
  updateGameState(gameState);
});

socket.on('playerJoined', (player) => {
  debugLog('Игрок присоединился', player);
  addChatMessage('system', `Игрок ${player.username} присоединился к игре`);
});

socket.on('playerLeft', (player) => {
  debugLog('Игрок вышел', player);
  addChatMessage('system', `Игрок ${player.username} вышел из игры`);
});

socket.on('gameStarted', () => {
  debugLog('Игра началась!');
  addChatMessage('system', '🎮 Игра началась! Удачи!');
});

socket.on('rolled', (data) => {
  debugLog('ROCLED', data);
  // можно показывать анимацию броска/обновлять конкретного игрока
});

socket.on('chatMessage', (data) => {
  debugLog('Сообщение в чате', data);
  addChatMessage(data.player, data.message);
});

socket.on('error', (message) => {
  debugLog('Ошибка от сервера', message);
  alert('Ошибка: ' + message);
});

// UI обновления — функции, как у тебя были; добавь defensive checks (элементы могут отсутствовать)
function updateGameState(gameState) {
  // реализовано по примеру ранее: обновляет список игроков, состояние комнаты, контролы
  // ... (вставь реализацию из своего кода, которую мы уже обсуждали)
}

// Примеры игровых действий
function startGame() { socket.emit('startGame', roomId); }
function rollDice() { socket.emit('roll', { roomId }, (res) => { debugLog('roll cb', res); }); }
function toggleDice(index) { socket.emit('toggleDice', { roomId, index }); }
function takePoints() { socket.emit('takePoints', { roomId }); }
function sendMessage() {
  const input = document.getElementById('chatInput');
  if (!input) return;
  const message = input.value.trim();
  if (message) {
    debugLog('Отправка сообщения', message);
    socket.emit('chatMessage', { roomId, message });
    input.value = '';
  }
}
function addChatMessage(sender, message) {
  const chat = document.getElementById('chatMessages');
  if (!chat) return;
  const messageElement = document.createElement('div');
  if (sender === 'system') {
    messageElement.className = 'chat-message system';
    messageElement.textContent = message;
  } else {
    messageElement.className = 'chat-message';
    messageElement.innerHTML = `${sender}: ${message}`;
  }
  chat.appendChild(messageElement);
  chat.scrollTop = chat.scrollHeight;
}
