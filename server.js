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

// Хранилище
const games = new Map();

// Отладка
function debugLog(message, data = null) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${message}`, data || '');
}

// Вспомогательная функция броска костей
function rollDice(num = 6) {
    const res = [];
    for (let i = 0; i < num; i++) res.push(1 + Math.floor(Math.random() * 6));
    return res;
}

// Socket.io
io.on('connection', (socket) => {
    debugLog('🔗 USER CONNECTED', { 
        socketId: socket.id,
        connected: socket.connected,
        rooms: Array.from(socket.rooms)
    });

    // Создание игры
    socket.on('createGame', (username = 'Игрок') => {
        debugLog('🎮 CREATE GAME REQUEST', { 
            username, 
            socketId: socket.id 
        });

        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        const game = {
            roomId: roomId,
            players: [{
                id: socket.id,
                username: username || 'Игрок 1',
                score: 0,
                roundScore: 0,
                dice: [1, 1, 1, 1, 1, 1],
                selected: [false, false, false, false, false, false],
                diceToRoll: 6,
                firstRoll: true
            }],
            currentPlayerIndex: 0,
            status: 'waiting',
            winner: null,
            cleanupTimer: null // таймер очистки пустой комнаты
        };
        
        games.set(roomId, game);
        socket.join(roomId);

        // отменяем таймер удаления, если был
        if (game.cleanupTimer) {
            clearTimeout(game.cleanupTimer);
            game.cleanupTimer = null;
        }
        
        debugLog('📤 SENDING GAME CREATED', { 
            roomId, 
            to: socket.id,
            gameState: game
        });

        // Отправляем события
        socket.emit('gameCreated', roomId);
        socket.emit('gameState', game);
        
        debugLog('✅ EVENTS SENT', {
            roomId,
            playerCount: game.players.length
        });
    });

    // Подключение к комнате
    socket.on('joinRoom', (roomId, username = 'Игрок') => {
        debugLog('🚪 JOIN ROOM REQUEST', { 
            roomId, 
            socketId: socket.id,
            username
        });

        const game = games.get(roomId);
        
        if (!game) {
            debugLog('❌ ROOM NOT FOUND', roomId);
            socket.emit('error', 'Комната не найдена: ' + roomId);
            return;
        }

        // Если для этой комнаты запланирована очистка — отменяем её
        if (game.cleanupTimer) {
            clearTimeout(game.cleanupTimer);
            game.cleanupTimer = null;
            debugLog('🛟 CLEANUP CANCELLED (player rejoining)', { roomId });
        }

        // Не добавляем игрока дважды
        let existing = game.players.find(p => p.id === socket.id);
        if (!existing) {
            const newPlayer = {
                id: socket.id,
                username: username || `Игрок ${game.players.length + 1}`,
                score: 0,
                roundScore: 0,
                dice: [1,1,1,1,1,1],
                selected: [false,false,false,false,false,false],
                diceToRoll: 6,
                firstRoll: true
            };
            game.players.push(newPlayer);
            debugLog('➕ PLAYER ADDED', { roomId, player: newPlayer.username });
        } else {
            debugLog('ℹ️ PLAYER ALREADY IN GAME', { roomId, socketId: socket.id });
        }
        
        socket.join(roomId);
        io.to(roomId).emit('playerJoined', { id: socket.id, username: existing ? existing.username : username });
        io.to(roomId).emit('gameState', game);
    });

    // Начало игры
    socket.on('startGame', (roomId) => {
        debugLog('🎯 START GAME REQUEST', { roomId, socketId: socket.id });
        
        if (!roomId) {
            debugLog('❌ NO ROOM ID PROVIDED');
            return;
        }
        
        const game = games.get(roomId);
        
        if (!game) {
            debugLog('❌ ROOM NOT FOUND', roomId);
            socket.emit('error', 'Комната не найдена');
            return;
        }
        
        if (game.players.length < 2) {
            debugLog('❌ NOT ENOUGH PLAYERS', { 
                roomId, 
                playerCount: game.players.length 
            });
            socket.emit('error', 'Минимум 2 игрока для начала игры');
            return;
        }
        
        if (game.players[0].id !== socket.id) {
            debugLog('❌ ONLY CREATOR CAN START', { 
                roomId,
                creatorId: game.players[0].id,
                requesterId: socket.id
            });
            socket.emit('error', 'Только создатель может начать игру');
            return;
        }
        
        game.status = 'playing';
        
        debugLog('🚀 GAME STARTED', { 
            roomId, 
            players: game.players.map(p => p.username) 
        });

        io.to(roomId).emit('gameStarted');
        io.to(roomId).emit('gameState', game);
    });

    // Чат
    socket.on('chatMessage', (data) => {
        if (!data || !data.roomId) {
            debugLog('❌ INVALID CHAT MESSAGE DATA', data);
            return;
        }
        
        const { roomId, message } = data;
        debugLog('💬 CHAT MESSAGE', { roomId, message, socketId: socket.id });
        
        const game = games.get(roomId);
        
        if (game && player && message && message.trim()) {
            debugLog('📤 SENDING CHAT MESSAGE', { 
                roomId, 
                player: player.username,
                message: message.trim()
            });

            io.to(roomId).emit('chatMessage', {
                player: player.username,
                message: message.trim()
            });
        } else {
            debugLog('ℹ️ CHAT IGNORED - no game or player or empty message', { roomId });
        }
    });

    // Обработчик броска (минимальная реализация)
    socket.on('roll', ({ roomId }, cb) => {
        const game = games.get(roomId);
        if (!game) return cb?.({ ok: false, error: 'no_room' });
        const current = game.players[game.currentPlayerIndex];
        if (!current || current.id !== socket.id) return cb?.({ ok: false, error: 'not_your_turn' });

        const diceCount = current.diceToRoll || 6;
        const newDice = rollDice(diceCount);
        current.dice = newDice;
        current.firstRoll = false;

        // TODO: вычислять очки и обновлять roundScore/selected/diceToRoll согласно правилам Zonk
        // Например: current.roundScore += computeScoreFromRoll(newDice);

        io.to(roomId).emit('rolled', { playerId: current.id, dice: newDice });
        io.to(roomId).emit('gameState', game);
        cb?.({ ok: true, dice: newDice });
    });

    // Переключение кости, взятие очков и др. должны иметь защиту от отсутствия game/player
    socket.on('toggleDice', (data) => {
        const { roomId, index } = data || {};
        const game = games.get(roomId);
        if (!game) return;
        const player = game.players.find(p => p.id === socket.id);
        if (!player) return;
        // TODO: реализовать toggle логики выбора костей
    });

    socket.on('takePoints', ({ roomId }) => {
        const game = games.get(roomId);
        if (!game) return;
        const player = game.players.find(p => p.id === socket.id);
        if (!player) return;
        // TODO: реализовать добавление roundScore в score, переключение хода и т.д.
    });

    // Отсоединение
    socket.on('disconnect', (reason) => {
        debugLog('🔌 USER DISCONNECTED', { 
            socketId: socket.id, 
            reason: reason 
        });

        // Найти во всех играх и удалить
        for (const [roomId, game] of games.entries()) {
            const idx = game.players.findIndex(p => p.id === socket.id);
            if (idx !== -1) {
                const removed = game.players.splice(idx, 1)[0];
                debugLog('👤 PLAYER REMOVED', { roomId, username: removed.username, remainingPlayers: game.players.length });

                // Если остались игроки — оповестить
                if (game.players.length > 0) {
                    if (game.currentPlayerIndex >= game.players.length) {
                        game.currentPlayerIndex = 0;
                    }
                    io.to(roomId).emit('playerLeft', { id: socket.id, username: removed.username });
                    io.to(roomId).emit('gameState', game);
                } else {
                    // Если игроков не осталось — запускаем таймер удаления вместо немедленного удаления
                    if (game.cleanupTimer) clearTimeout(game.cleanupTimer);
                    game.cleanupTimer = setTimeout(() => {
                        games.delete(roomId);
                        debugLog('🗑️ GAME DELETED (cleanup timer elapsed)', { roomId });
                    }, 30 * 1000); // 30 секунд grace period
                    debugLog('⏳ GAME WILL BE CLEANED UP IN 30s IF NOBODY RETURNS', { roomId });
                }
            }
        }
    });

    // Ошибки
    socket.on('error', (error) => {
        debugLog('❌ SOCKET ERROR', { 
            socketId: socket.id, 
            error: error 
        });
    });
});

// Маршруты
app.get('/', (req, res) => {
    res.render('index');
});

app.get('/game/:roomId?', (req, res) => {
    res.render('game', { roomId: req.params.roomId || '' });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        games: games.size,
        timestamp: new Date().toISOString(),
        totalGames: Array.from(games.keys())
    });
});

// Debug endpoint
app.get('/api/debug/games', (req, res) => {
    const gamesInfo = Array.from(games.entries()).map(([roomId, game]) => ({
        roomId,
        status: game.status,
        players: game.players.map(p => ({
            username: p.username,
            id: p.id.substring(0, 8) + '...',
            score: p.score
        })),
        playerCount: game.players.length
    }));
    
    res.json({
        totalGames: games.size,
        games: gamesInfo
    });
});

// Запуск сервера
server.listen(PORT, () => {
    console.log(`🎲 Server running on port ${PORT}`);
    console.log(`📍 Health: http://localhost:${PORT}/health`);
    console.log(`🔧 Debug: http://localhost:${PORT}/api/debug/games`);
});
