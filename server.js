const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Настройки
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.json());

// Хранилище игр
const games = new Map();

// Отладочная информация
function debugLog(message, data = null) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] 🔍 ${message}`, data || '');
}

// Генерация ID комнаты
function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Логика игры
class ZonkGame {
    constructor(roomId) {
        this.roomId = roomId;
        this.players = [];
        this.currentPlayerIndex = 0;
        this.status = 'waiting';
        this.winner = null;
    }

    addPlayer(socketId, username) {
        if (this.players.length >= 4) return false;
        
        const player = {
            id: socketId,
            username: username || `Игрок ${this.players.length + 1}`,
            score: 0,
            roundScore: 0,
            dice: [1, 1, 1, 1, 1, 1],
            selected: [false, false, false, false, false, false],
            diceToRoll: 6,
            firstRoll: true
        };
        
        this.players.push(player);
        debugLog('Игрок добавлен', { username: player.username, roomId: this.roomId });
        return true;
    }

    getCurrentPlayer() {
        return this.players[this.currentPlayerIndex];
    }

    nextPlayer() {
        if (this.players.length === 0) return;
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
    }
}

// Socket.io обработчики
io.on('connection', (socket) => {
    debugLog('✅ Пользователь подключен', socket.id);

    // Создание игры
    socket.on('createGame', (username) => {
        try {
            const roomId = generateRoomId();
            const game = new ZonkGame(roomId);
            
            game.addPlayer(socket.id, username);
            games.set(roomId, game);
            
            socket.join(roomId);
            debugLog(`🎮 Создана комната`, { roomId, username, socketId: socket.id });
            
            // Отправляем состояние обратно
            const gameState = {
                roomId: game.roomId,
                players: game.players,
                currentPlayerIndex: game.currentPlayerIndex,
                status: game.status,
                winner: game.winner
            };
            
            socket.emit('gameCreated', roomId);
            socket.emit('gameState', gameState);
            debugLog('📤 Отправлено состояние игры создателю', gameState);
            
        } catch (error) {
            debugLog('❌ Ошибка создания игры', error);
            socket.emit('error', 'Ошибка создания игры');
        }
    });

    // Присоединение к игре
    socket.on('joinGame', (data) => {
        try {
            const { roomId, username } = data;
            debugLog('👤 Попытка присоединения', { roomId, username, socketId: socket.id });
            
            const game = games.get(roomId);
            
            if (!game) {
                debugLog('❌ Комната не найдена', roomId);
                socket.emit('error', 'Комната не найдена');
                return;
            }
            
            if (game.status !== 'waiting') {
                debugLog('❌ Игра уже началась', { roomId, status: game.status });
                socket.emit('error', 'Игра уже началась');
                return;
            }
            
            if (game.addPlayer(socket.id, username)) {
                socket.join(roomId);
                debugLog('✅ Игрок присоединился', { roomId, username, socketId: socket.id });
                
                // Отправляем состояние всем в комнате
                const gameState = {
                    roomId: game.roomId,
                    players: game.players,
                    currentPlayerIndex: game.currentPlayerIndex,
                    status: game.status,
                    winner: game.winner
                };
                
                socket.emit('gameJoined', roomId);
                io.to(roomId).emit('playerJoined', { username });
                io.to(roomId).emit('gameState', gameState);
                debugLog('📤 Отправлено состояние игры всем игрокам', gameState);
                
            } else {
                debugLog('❌ Комната заполнена', { roomId, currentPlayers: game.players.length });
                socket.emit('error', 'Комната заполнена');
            }
        } catch (error) {
            debugLog('❌ Ошибка присоединения', error);
            socket.emit('error', 'Ошибка присоединения к игре');
        }
    });

    // ПОДКЛЮЧЕНИЕ К КОМНАТЕ - ВАЖНО!
    socket.on('joinRoom', (roomId) => {
        try {
            debugLog('🚪 Подключение к комнате', { roomId, socketId: socket.id });
            const game = games.get(roomId);
            
            if (game) {
                socket.join(roomId);
                debugLog('✅ Успешное подключение к комнате', { 
                    roomId, 
                    players: game.players.length,
                    playerUsernames: game.players.map(p => p.username)
                });
                
                // НЕМЕДЛЕННО отправляем состояние игры
                const gameState = {
                    roomId: game.roomId,
                    players: game.players,
                    currentPlayerIndex: game.currentPlayerIndex,
                    status: game.status,
                    winner: game.winner
                };
                
                socket.emit('gameState', gameState);
                debugLog('📤 Отправлено состояние игры при подключении', gameState);
                
            } else {
                debugLog('❌ Комната не найдена при joinRoom', roomId);
                socket.emit('error', 'Комната не найдена');
            }
        } catch (error) {
            debugLog('❌ Ошибка подключения к комнате', error);
            socket.emit('error', 'Ошибка подключения к комнате');
        }
    });

    // Начало игры
    socket.on('startGame', (roomId) => {
        try {
            debugLog('🎯 Запрос на начало игры', { roomId, socketId: socket.id });
            const game = games.get(roomId);
            
            if (game && game.players.length >= 2 && game.players[0].id === socket.id) {
                game.status = 'playing';
                debugLog('🚀 Игра началась', { 
                    roomId, 
                    players: game.players.map(p => p.username)
                });
                
                const gameState = {
                    roomId: game.roomId,
                    players: game.players,
                    currentPlayerIndex: game.currentPlayerIndex,
                    status: game.status,
                    winner: game.winner
                };
                
                io.to(roomId).emit('gameStarted');
                io.to(roomId).emit('gameState', gameState);
                debugLog('📤 Отправлено состояние начатой игры', gameState);
                
            } else {
                debugLog('❌ Нельзя начать игру', { 
                    gameExists: !!game,
                    players: game?.players.length,
                    isCreator: game?.players[0]?.id === socket.id
                });
            }
        } catch (error) {
            debugLog('❌ Ошибка начала игры', error);
        }
    });

    // Чат
    socket.on('chatMessage', (data) => {
        try {
            const { roomId, message } = data;
            debugLog('💬 Сообщение в чат', { roomId, message, socketId: socket.id });
            
            const game = games.get(roomId);
            const player = game?.players.find(p => p.id === socket.id);
            
            if (game && player && message.trim()) {
                debugLog('📤 Отправка сообщения в чат', { 
                    player: player.username, 
                    message: message.trim()
                });
                
                io.to(roomId).emit('chatMessage', {
                    player: player.username,
                    message: message.trim()
                });
            }
        } catch (error) {
            debugLog('❌ Ошибка отправки сообщения', error);
        }
    });

    // Отсоединение
    socket.on('disconnect', () => {
        debugLog('🔌 Пользователь отключен', socket.id);
    });
});

// Маршруты
app.get('/', (req, res) => {
    res.render('index');
});

app.get('/game/:roomId?', (req, res) => {
    res.render('game', { roomId: req.params.roomId || '' });
});

app.get('/create', (req, res) => {
    res.render('create');
});

// Health check для Railway
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        games: games.size
    });
});

// Debug endpoint
app.get('/api/debug', (req, res) => {
    const debugInfo = {
        totalGames: games.size,
        games: Array.from(games.entries()).map(([roomId, game]) => ({
            roomId,
            status: game.status,
            players: game.players.map(p => ({
                username: p.username,
                id: p.id.substring(0, 8) + '...'
            }))
        }))
    };
    res.json(debugInfo);
});

// Запуск сервера
server.listen(PORT, () => {
    console.log(`🎲 Zonk Multiplayer запущен на порту ${PORT}`);
    console.log(`📍 http://localhost:${PORT}`);
    console.log(`🔧 Debug: http://localhost:${PORT}/api/debug`);
    console.log(`❤️ Health: http://localhost:${PORT}/health`);
});
