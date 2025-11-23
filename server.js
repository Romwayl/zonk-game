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

// Простое хранилище
const games = new Map();

// Socket.io - МИНИМАЛЬНАЯ РАБОЧАЯ ВЕРСИЯ
io.on('connection', (socket) => {
    console.log('✅ User connected:', socket.id);

    // Создание игры
    socket.on('createGame', (username) => {
        console.log('🎮 Create game request:', username);
        
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        const game = {
            roomId: roomId,
            players: [{
                id: socket.id,
                username: username || 'Игрок 1',
                score: 0,
                roundScore: 0,
                dice: [1,2,3,4,5,6],
                selected: [false,false,false,false,false,false],
                diceToRoll: 6,
                firstRoll: true
            }],
            currentPlayerIndex: 0,
            status: 'waiting',
            winner: null
        };
        
        games.set(roomId, game);
        socket.join(roomId);
        
        console.log('📤 Sending gameState for room:', roomId);
        
        // ОТПРАВЛЯЕМ СОСТОЯНИЕ ИГРЫ
        socket.emit('gameCreated', roomId);
        socket.emit('gameState', game);
    });

    // Подключение к комнате
    socket.on('joinRoom', (roomId) => {
        console.log('🚪 Join room request:', roomId);
        const game = games.get(roomId);
        
        if (game) {
            socket.join(roomId);
            console.log('📤 Sending gameState to room:', roomId);
            socket.emit('gameState', game);
        } else {
            console.log('❌ Room not found:', roomId);
            socket.emit('error', 'Room not found');
        }
    });

    // Чат
    socket.on('chatMessage', (data) => {
        const { roomId, message } = data;
        const game = games.get(roomId);
        const player = game?.players.find(p => p.id === socket.id);
        
        if (game && player && message.trim()) {
            io.to(roomId).emit('chatMessage', {
                player: player.username,
                message: message.trim()
            });
        }
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
        timestamp: new Date().toISOString()
    });
});

// Запуск сервера
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 Health: http://localhost:${PORT}/health`);
});
