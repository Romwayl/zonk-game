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

// Helper function to roll dice
function rollDice(num) {
    const dice = [];
    for (let i = 0; i < num; i++) {
        dice.push(Math.floor(Math.random() * 6) + 1);
    }
    return dice;
}

// Socket.io
io.on('connection', (socket) => {
    debugLog('🔗 USER CONNECTED', { 
        socketId: socket.id,
        connected: socket.connected,
        rooms: Array.from(socket.rooms)
    });

    // Создание игры
    socket.on('createGame', (username) => {
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
            winner: null
        };
        
        games.set(roomId, game);
        socket.join(roomId);
        
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
    socket.on('joinRoom', ({ roomId, username }) => {
        debugLog('🚪 JOIN ROOM REQUEST', { 
            roomId, 
            username,
            socketId: socket.id 
        });

        const game = games.get(roomId);
        
        if (game) {
            // Check if player is not already in the game
            const existingPlayer = game.players.find(p => p.id === socket.id);
            
            if (!existingPlayer) {
                // Add new player to the game
                const playerNumber = game.players.length + 1;
                const newPlayer = {
                    id: socket.id,
                    username: username || `Игрок ${playerNumber}`,
                    score: 0,
                    roundScore: 0,
                    dice: [1, 1, 1, 1, 1, 1],
                    selected: [false, false, false, false, false, false],
                    diceToRoll: 6,
                    firstRoll: true
                };
                
                game.players.push(newPlayer);
                
                debugLog('👤 PLAYER ADDED', { 
                    roomId, 
                    username: newPlayer.username,
                    playerCount: game.players.length
                });
            }
            
            socket.join(roomId);
            debugLog('✅ ROOM JOINED', { 
                roomId, 
                players: game.players.length 
            });

            // Notify room that a player joined
            io.to(roomId).emit('playerJoined', {
                player: game.players.find(p => p.id === socket.id)
            });

            debugLog('📤 SENDING GAME STATE', { 
                roomId,
                to: socket.id,
                gameState: game
            });

            io.to(roomId).emit('gameState', game);
            debugLog('✅ GAME STATE SENT');
            
        } else {
            debugLog('❌ ROOM NOT FOUND', roomId);
            socket.emit('error', 'Комната не найдена: ' + roomId);
        }
    });

    // Начало игры
    socket.on('startGame', (roomId) => {
        debugLog('🎯 START GAME REQUEST', { roomId, socketId: socket.id });
        
        const game = games.get(roomId);
        if (game && game.players.length >= 2 && game.players[0].id === socket.id) {
            game.status = 'playing';
            
            debugLog('🚀 GAME STARTED', { 
                roomId, 
                players: game.players.map(p => p.username) 
            });

            io.to(roomId).emit('gameStarted');
            io.to(roomId).emit('gameState', game);
        }
    });

    // Roll dice
    socket.on('roll', ({ roomId }, cb) => {
        debugLog('🎲 ROLL REQUEST', { roomId, socketId: socket.id });
        
        const game = games.get(roomId);
        
        if (!game) {
            debugLog('❌ ROOM NOT FOUND', roomId);
            if (cb) cb({ error: 'Room not found' });
            return;
        }
        
        // Validate currentPlayerIndex is within bounds
        if (game.currentPlayerIndex >= game.players.length) {
            game.currentPlayerIndex = 0;
        }
        
        const currentPlayer = game.players[game.currentPlayerIndex];
        
        if (!currentPlayer) {
            debugLog('❌ NO CURRENT PLAYER', { roomId });
            if (cb) cb({ error: 'No current player' });
            return;
        }
        
        // Validate that the caller is the current player
        if (currentPlayer.id !== socket.id) {
            debugLog('❌ NOT CURRENT PLAYER', { 
                socketId: socket.id, 
                currentPlayerId: currentPlayer.id 
            });
            if (cb) cb({ error: 'Not your turn' });
            return;
        }
        
        // Roll the dice
        const numDice = currentPlayer.diceToRoll || 6;
        const rolledDice = rollDice(numDice);
        
        // Update player's dice
        currentPlayer.dice = rolledDice;
        currentPlayer.firstRoll = false;
        
        debugLog('🎲 DICE ROLLED', { 
            roomId,
            player: currentPlayer.username,
            dice: rolledDice
        });
        
        // TODO: Implement scoring logic here
        // - Check if roll is a zonk (no scoring dice)
        // - Calculate available score from rolled dice
        // - Update game state accordingly
        
        // TODO: Implement dice selection logic
        // - Allow player to select scoring dice
        // - Validate selections
        // - Update roundScore
        
        // Emit events
        io.to(roomId).emit('rolled', {
            player: currentPlayer.username,
            dice: rolledDice
        });
        io.to(roomId).emit('gameState', game);
        
        // Send callback response
        if (cb) cb({ dice: rolledDice });
        
        debugLog('✅ ROLL COMPLETE', { roomId });
    });

    // Чат
    socket.on('chatMessage', (data) => {
        const { roomId, message } = data;
        debugLog('💬 CHAT MESSAGE', { roomId, message, socketId: socket.id });
        
        const game = games.get(roomId);
        const player = game?.players.find(p => p.id === socket.id);
        
        if (game && player && message.trim()) {
            debugLog('📤 SENDING CHAT MESSAGE', { 
                roomId, 
                player: player.username,
                message: message.trim()
            });

            io.to(roomId).emit('chatMessage', {
                player: player.username,
                message: message.trim()
            });
        }
    });

    // Отсоединение
    socket.on('disconnect', (reason) => {
        debugLog('🔌 USER DISCONNECTED', { 
            socketId: socket.id, 
            reason: reason 
        });
        
        // Remove player from all games
        for (const [roomId, game] of games.entries()) {
            const playerIndex = game.players.findIndex(p => p.id === socket.id);
            
            if (playerIndex !== -1) {
                const removedPlayer = game.players[playerIndex];
                game.players.splice(playerIndex, 1);
                
                debugLog('👤 PLAYER REMOVED', {
                    roomId,
                    username: removedPlayer.username,
                    remainingPlayers: game.players.length
                });
                
                // If game is empty, delete it
                if (game.players.length === 0) {
                    games.delete(roomId);
                    debugLog('🗑️ GAME DELETED', { roomId });
                } else {
                    // Adjust currentPlayerIndex if needed
                    // If removed player was before current player, decrement index
                    if (playerIndex < game.currentPlayerIndex) {
                        game.currentPlayerIndex--;
                    }
                    // If removed player was the current player or index is now out of bounds, reset to 0
                    else if (playerIndex === game.currentPlayerIndex || game.currentPlayerIndex >= game.players.length) {
                        game.currentPlayerIndex = 0;
                    }
                    
                    // Notify remaining players
                    io.to(roomId).emit('playerLeft', {
                        player: removedPlayer
                    });
                    io.to(roomId).emit('gameState', game);
                    
                    debugLog('📤 SENT playerLeft AND gameState', { roomId });
                }
                
                break; // Player can only be in one game
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

// Добавим обработчики для всех событий для отладки
io.engine.on("connection", (socket) => {
    debugLog('🚀 ENGINE CONNECTION', { socketId: socket.id });
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
