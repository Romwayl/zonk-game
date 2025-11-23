const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Важно: на Railway нужно явно указать CORS
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
const players = new Map();

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

    removePlayer(playerId) {
        const playerIndex = this.players.findIndex(p => p.id === playerId);
        if (playerIndex !== -1) {
            const player = this.players[playerIndex];
            this.players.splice(playerIndex, 1);
            
            if (this.currentPlayerIndex >= playerIndex && this.currentPlayerIndex > 0) {
                this.currentPlayerIndex--;
            }
            
            return true;
        }
        return false;
    }

    getCurrentPlayer() {
        return this.players[this.currentPlayerIndex];
    }

    nextPlayer() {
        if (this.players.length === 0) return;
        
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
        const player = this.getCurrentPlayer();
        player.firstRoll = true;
        player.diceToRoll = 6;
        player.selected = [false, false, false, false, false, false];
        player.roundScore = 0;
    }

    calculateScore(dice, selected) {
        if (selected.every(s => !s)) return 0;
        
        let score = 0;
        const counts = [0, 0, 0, 0, 0, 0, 0];
        
        for (let i = 0; i < 6; i++) {
            if (selected[i]) {
                counts[dice[i]]++;
            }
        }

        const selectedDice = dice.filter((_, i) => selected[i]);
        const selectedCounts = [0, 0, 0, 0, 0, 0, 0];
        selectedDice.forEach(die => selectedCounts[die]++);

        // Шесть разных
        if (selectedDice.length === 6 && new Set(selectedDice).size === 6) {
            return 1500;
        }

        // Три пары
        const pairs = selectedCounts.filter(count => count === 2);
        if (pairs.length === 3) {
            return 750;
        }

        // Комбинации одинаковых костей
        for (let i = 1; i <= 6; i++) {
            if (selectedCounts[i] >= 3) {
                const baseScore = i === 1 ? 1000 : i * 100;
                if (selectedCounts[i] === 3) score += baseScore;
                else if (selectedCounts[i] === 4) score += baseScore * 2;
                else if (selectedCounts[i] === 5) score += baseScore * 3;
                else if (selectedCounts[i] === 6) score += baseScore * 4;
                selectedCounts[i] = 0;
            }
        }

        // Одиночные 1 и 5
        score += selectedCounts[1] * 100;
        score += selectedCounts[5] * 50;

        return score;
    }

    isZonk(dice) {
        const counts = [0, 0, 0, 0, 0, 0, 0];
        dice.forEach(die => counts[die]++);

        if (counts[1] >= 1) return false;
        if (counts[5] >= 1) return false;
        
        for (let i = 1; i <= 6; i++) {
            if (counts[i] >= 3) return false;
        }
        
        const pairs = counts.filter(count => count === 2);
        if (pairs.length === 3) return false;
        
        if (counts.filter(count => count === 1).length === 6) return false;

        return true;
    }

    canTakePoints(player) {
        const currentScore = this.calculateScore(player.dice, player.selected);
        if (player.score === 0) {
            return currentScore >= 300;
        }
        return currentScore > 0;
    }

    isHotDice(dice, selected) {
        return selected.every(s => s) && this.calculateScore(dice, selected) > 0;
    }
}

// Socket.io обработчики
io.on('connection', (socket) => {
    debugLog('Пользователь подключен', socket.id);

    // Создание игры
    socket.on('createGame', (username) => {
        try {
            const roomId = generateRoomId();
            const game = new ZonkGame(roomId);
            
            game.addPlayer(socket.id, username);
            games.set(roomId, game);
            players.set(socket.id, roomId);
            
            socket.join(roomId);
            debugLog(`Создана комната`, { roomId, username });
            
            socket.emit('gameCreated', roomId);
            io.to(roomId).emit('gameState', getGameState(game));
            
        } catch (error) {
            debugLog('Ошибка создания игры', error);
            socket.emit('error', 'Ошибка создания игры');
        }
    });

    // Присоединение к игре
    socket.on('joinGame', (data) => {
        try {
            const { roomId, username } = data;
            debugLog('Попытка присоединения', { roomId, username });
            
            const game = games.get(roomId);
            
            if (!game) {
                socket.emit('error', 'Комната не найдена');
                return;
            }
            
            if (game.status !== 'waiting') {
                socket.emit('error', 'Игра уже началась');
                return;
            }
            
            if (game.addPlayer(socket.id, username)) {
                players.set(socket.id, roomId);
                socket.join(roomId);
                debugLog('Игрок присоединился', { roomId, username });
                
                socket.emit('gameJoined', roomId);
                io.to(roomId).emit('playerJoined', { username });
                io.to(roomId).emit('gameState', getGameState(game));
                
            } else {
                socket.emit('error', 'Комната заполнена');
            }
        } catch (error) {
            debugLog('Ошибка присоединения', error);
            socket.emit('error', 'Ошибка присоединения к игре');
        }
    });

    // Подключение к комнате
    socket.on('joinRoom', (roomId) => {
        try {
            debugLog('Подключение к комнате', { roomId });
            const game = games.get(roomId);
            if (game) {
                socket.join(roomId);
                io.to(roomId).emit('gameState', getGameState(game));
            }
        } catch (error) {
            debugLog('Ошибка подключения к комнате', error);
        }
    });

    // Начало игры
    socket.on('startGame', (roomId) => {
        try {
            debugLog('Запрос на начало игры', { roomId });
            const game = games.get(roomId);
            
            if (game && game.players.length >= 2 && game.players[0].id === socket.id) {
                game.status = 'playing';
                debugLog('Игра началась', { roomId });
                
                io.to(roomId).emit('gameStarted');
                io.to(roomId).emit('gameState', getGameState(game));
            }
        } catch (error) {
            debugLog('Ошибка начала игры', error);
        }
    });

    // Бросок костей
    socket.on('rollDice', (roomId) => {
        try {
            const game = games.get(roomId);
            const player = game?.getCurrentPlayer();
            
            if (game && player && player.id === socket.id && game.status === 'playing') {
                const diceToRoll = player.firstRoll ? 6 : player.diceToRoll;
                
                if (player.firstRoll || player.diceToRoll === 6) {
                    player.dice = Array(6).fill(0);
                    player.selected = Array(6).fill(false);
                }
                
                let rolled = 0;
                for (let i = 0; i < 6 && rolled < diceToRoll; i++) {
                    if (player.dice[i] === 0) {
                        player.dice[i] = Math.floor(Math.random() * 6) + 1;
                        rolled++;
                    }
                }
                
                player.firstRoll = false;
                player.roundScore = game.calculateScore(player.dice, player.selected);
                
                if (game.isZonk(player.dice)) {
                    io.to(roomId).emit('gameMessage', { 
                        type: 'zonk', 
                        player: player.username 
                    });
                    player.roundScore = 0;
                    game.nextPlayer();
                }
                
                io.to(roomId).emit('gameState', getGameState(game));
            }
        } catch (error) {
            debugLog('Ошибка броска костей', error);
        }
    });

    // Выбор кости
    socket.on('toggleDice', (data) => {
        try {
            const { roomId, index } = data;
            const game = games.get(roomId);
            const player = game?.getCurrentPlayer();
            
            if (game && player && player.id === socket.id && game.status === 'playing' && !player.firstRoll) {
                player.selected[index] = !player.selected[index];
                player.roundScore = game.calculateScore(player.dice, player.selected);
                
                const selectedCount = player.selected.filter(s => s).length;
                player.diceToRoll = 6 - selectedCount;
                
                if (game.isHotDice(player.dice, player.selected)) {
                    player.diceToRoll = 6;
                    io.to(roomId).emit('gameMessage', { 
                        type: 'hotDice', 
                        player: player.username 
                    });
                }
                
                io.to(roomId).emit('gameState', getGameState(game));
            }
        } catch (error) {
            debugLog('Ошибка переключения кости', error);
        }
    });

    // Взять очки
    socket.on('takePoints', (roomId) => {
        try {
            const game = games.get(roomId);
            const player = game?.getCurrentPlayer();
            
            if (game && player && player.id === socket.id && game.status === 'playing') {
                if (game.canTakePoints(player)) {
                    const pointsEarned = player.roundScore;
                    player.score += pointsEarned;
                    
                    io.to(roomId).emit('gameMessage', { 
                        type: 'takePoints', 
                        player: player.username, 
                        score: pointsEarned 
                    });
                    
                    if (player.score >= 1000) {
                        game.status = 'finished';
                        game.winner = player.username;
                        io.to(roomId).emit('gameMessage', { 
                            type: 'win', 
                            player: player.username, 
                            score: player.score 
                        });
                    } else {
                        game.nextPlayer();
                    }
                    
                    player.dice = [1, 1, 1, 1, 1, 1];
                    player.selected = [false, false, false, false, false, false];
                    player.diceToRoll = 6;
                    player.firstRoll = true;
                    player.roundScore = 0;
                }
                
                io.to(roomId).emit('gameState', getGameState(game));
            }
        } catch (error) {
            debugLog('Ошибка взятия очков', error);
        }
    });

    // Сообщения в чат
    socket.on('chatMessage', (data) => {
        try {
            const { roomId, message } = data;
            const game = games.get(roomId);
            const player = game?.players.find(p => p.id === socket.id);
            
            if (game && player && message.trim()) {
                io.to(roomId).emit('chatMessage', {
                    player: player.username,
                    message: message.trim()
                });
            }
        } catch (error) {
            debugLog('Ошибка отправки сообщения', error);
        }
    });

    // Отсоединение
    socket.on('disconnect', () => {
        debugLog('Пользователь отключен', socket.id);
        
        const roomId = players.get(socket.id);
        if (roomId) {
            const game = games.get(roomId);
            if (game) {
                const player = game.players.find(p => p.id === socket.id);
                if (player) {
                    io.to(roomId).emit('playerLeft', { username: player.username });
                    game.removePlayer(socket.id);
                    
                    if (game.players.length === 0) {
                        games.delete(roomId);
                    } else {
                        io.to(roomId).emit('gameState', getGameState(game));
                    }
                }
            }
            players.delete(socket.id);
        }
    });
});

// Вспомогательная функция
function getGameState(game) {
    return {
        roomId: game.roomId,
        players: game.players,
        currentPlayerIndex: game.currentPlayerIndex,
        status: game.status,
        winner: game.winner
    };
}

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
        games: games.size,
        players: players.size
    });
});

// Запуск сервера
server.listen(PORT, () => {
    console.log(`🎲 Zonk Multiplayer запущен на порту ${PORT}`);
    console.log(`📍 Health check: http://localhost:${PORT}/health`);
});
