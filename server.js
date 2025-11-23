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
const players = new Map();

// Отладочная информация
function debugLog(message, data = null) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] 🔍 ${message}`, data || '');
}

// Отладочная информация о играх
function debugGames() {
    console.log('\n=== DEBUG GAMES ===');
    console.log(`Total games: ${games.size}`);
    games.forEach((game, roomId) => {
        console.log(`Room ${roomId}:`);
        console.log(`  Status: ${game.status}`);
        console.log(`  Players: ${game.players.length}`);
        game.players.forEach((player, index) => {
            console.log(`    [${index}] ${player.username} (${player.id}) ${player.id === game.players[game.currentPlayerIndex]?.id ? '🎯 CURRENT' : ''}`);
        });
        console.log(`  Current Player Index: ${game.currentPlayerIndex}`);
    });
    console.log('==================\n');
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
        this.status = 'waiting'; // waiting, playing, finished
        this.winner = null;
    }

    addPlayer(socketId, username) {
        if (this.players.length >= 4) return false;
        
        // Проверяем, не присоединился ли игрок уже
        if (this.players.find(p => p.id === socketId)) {
            debugLog('Игрок уже в комнате', { socketId, username });
            return true;
        }
        
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
            debugLog('Удаление игрока', { username: player.username, index: playerIndex });
            
            // Если уходит текущий игрок, передаем ход
            if (this.status === 'playing' && this.currentPlayerIndex === playerIndex) {
                debugLog('Текущий игрок уходит, передаем ход', { username: player.username });
                this.nextPlayer();
            }
            
            this.players.splice(playerIndex, 1);
            
            // Корректируем индекс текущего игрока
            if (this.currentPlayerIndex >= playerIndex && this.currentPlayerIndex > 0) {
                this.currentPlayerIndex--;
                debugLog('Корректируем текущего игрока', { newIndex: this.currentPlayerIndex });
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
        
        debugLog('Переход хода', { 
            newPlayer: player.username, 
            index: this.currentPlayerIndex 
        });
    }

    calculateScore(dice, selected) {
        if (selected.every(s => !s)) return 0;
        
        let score = 0;
        const counts = [0, 0, 0, 0, 0, 0, 0];
        
        // Считаем только выбранные кости
        for (let i = 0; i < 6; i++) {
            if (selected[i]) {
                counts[dice[i]]++;
            }
        }

        const selectedDice = dice.filter((_, i) => selected[i]);
        const selectedCounts = [0, 0, 0, 0, 0, 0, 0];
        selectedDice.forEach(die => selectedCounts[die]++);

        // 1. Шесть разных (1-2-3-4-5-6)
        if (selectedDice.length === 6 && new Set(selectedDice).size === 6) {
            debugLog('Комбинация: Шесть разных', 1500);
            return 1500;
        }

        // 2. Три пары
        const pairs = selectedCounts.filter(count => count === 2);
        if (pairs.length === 3) {
            debugLog('Комбинация: Три пары', 750);
            return 750;
        }

        // 3. Комбинации одинаковых костей
        for (let i = 1; i <= 6; i++) {
            if (selectedCounts[i] >= 3) {
                const baseScore = i === 1 ? 1000 : i * 100;
                if (selectedCounts[i] === 3) score += baseScore;
                else if (selectedCounts[i] === 4) score += baseScore * 2;
                else if (selectedCounts[i] === 5) score += baseScore * 3;
                else if (selectedCounts[i] === 6) score += baseScore * 4;
                selectedCounts[i] = 0;
                debugLog(`Комбинация: ${selectedCounts[i]} одинаковых`, baseScore);
            }
        }

        // 4. Одиночные 1 и 5
        score += selectedCounts[1] * 100;
        score += selectedCounts[5] * 50;

        debugLog('Подсчет очков', { score, selectedDice });
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

        debugLog('ZONK обнаружен', { dice });
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
            
            const success = game.addPlayer(socket.id, username);
            if (!success) {
                socket.emit('error', 'Не удалось создать игру');
                return;
            }
            
            games.set(roomId, game);
            players.set(socket.id, roomId);
            
            socket.join(roomId);
            debugLog(`Создана комната`, { roomId, username, socketId: socket.id });
            
            socket.emit('gameCreated', roomId);
            io.to(roomId).emit('gameState', getGameState(game));
            
            // Отладочная информация
            debugGames();
        } catch (error) {
            debugLog('Ошибка создания игры', error);
            socket.emit('error', 'Ошибка создания игры: ' + error.message);
        }
    });

    // Присоединение к игре
    socket.on('joinGame', (data) => {
        try {
            const { roomId, username } = data;
            debugLog('Попытка присоединения', { roomId, username, socketId: socket.id });
            
            const game = games.get(roomId);
            
            if (!game) {
                debugLog('Комната не найдена', roomId);
                socket.emit('error', 'Комната не найдена');
                return;
            }
            
            if (game.status !== 'waiting') {
                debugLog('Игра уже началась', { roomId, status: game.status });
                socket.emit('error', 'Игра уже началась');
                return;
            }
            
            if (game.addPlayer(socket.id, username)) {
                players.set(socket.id, roomId);
                socket.join(roomId);
                debugLog('Игрок присоединился', { roomId, username, socketId: socket.id });
                
                socket.emit('gameJoined', roomId);
                io.to(roomId).emit('playerJoined', { username });
                io.to(roomId).emit('gameState', getGameState(game));
                
                debugGames();
            } else {
                debugLog('Комната заполнена', { roomId, currentPlayers: game.players.length });
                socket.emit('error', 'Комната заполнена (максимум 4 игрока)');
            }
        } catch (error) {
            debugLog('Ошибка присоединения', error);
            socket.emit('error', 'Ошибка присоединения к игре: ' + error.message);
        }
    });

    // Подключение к комнате
    socket.on('joinRoom', (roomId) => {
        try {
            debugLog('Подключение к комнате', { roomId, socketId: socket.id });
            const game = games.get(roomId);
            if (game) {
                socket.join(roomId);
                debugLog('Успешное подключение к комнате', { 
                    roomId, 
                    players: game.players.length,
                    playerUsernames: game.players.map(p => p.username)
                });
                io.to(roomId).emit('gameState', getGameState(game));
            } else {
                debugLog('Комната не найдена при joinRoom', roomId);
                socket.emit('error', 'Комната не найдена');
            }
        } catch (error) {
            debugLog('Ошибка подключения к комнате', error);
            socket.emit('error', 'Ошибка подключения к комнате: ' + error.message);
        }
    });

    // Начало игры
    socket.on('startGame', (roomId) => {
        try {
            debugLog('Запрос на начало игры', { roomId, socketId: socket.id });
            const game = games.get(roomId);
            
            if (!game) {
                debugLog('Игра не найдена', roomId);
                socket.emit('error', 'Игра не найдена');
                return;
            }
            
            debugLog('Информация об игре перед стартом', {
                roomId: roomId,
                players: game.players.length,
                playerUsernames: game.players.map(p => p.username),
                firstPlayer: game.players[0]?.id,
                firstPlayerUsername: game.players[0]?.username,
                currentSocket: socket.id,
                canStart: game.players.length >= 2 && game.players[0].id === socket.id
            });
            
            if (game.players.length < 2) {
                debugLog('Недостаточно игроков для начала', { current: game.players.length, required: 2 });
                socket.emit('error', 'Нужно минимум 2 игрока для начала игры');
                return;
            }
            
            if (game.players[0].id !== socket.id) {
                debugLog('Только создатель может начать игру', { 
                    creator: game.players[0].username,
                    requester: socket.id 
                });
                socket.emit('error', 'Только создатель комнаты может начать игру');
                return;
            }
            
            // Все проверки пройдены, начинаем игру
            game.status = 'playing';
            debugLog('Игра началась', { 
                roomId, 
                players: game.players.map(p => p.username),
                currentPlayer: game.getCurrentPlayer().username
            });
            
            io.to(roomId).emit('gameStarted');
            io.to(roomId).emit('gameState', getGameState(game));
            
            debugGames();
            
        } catch (error) {
            debugLog('Ошибка начала игры', error);
            socket.emit('error', 'Ошибка начала игры: ' + error.message);
        }
    });

    // Бросок костей
    socket.on('rollDice', (roomId) => {
        try {
            debugLog('Запрос на бросок костей', { roomId, socketId: socket.id });
            const game = games.get(roomId);
            const player = game?.getCurrentPlayer();
            
            if (!game) {
                debugLog('Игра не найдена', roomId);
                return;
            }
            
            if (!player) {
                debugLog('Текущий игрок не найден', { roomId });
                return;
            }
            
            if (game.status !== 'playing') {
                debugLog('Игра не в активном состоянии', { status: game.status });
                return;
            }
            
            if (player.id !== socket.id) {
                debugLog('Не ваш ход', { 
                    currentPlayer: player.username,
                    requester: socket.id 
                });
                return;
            }
            
            const diceToRoll = player.firstRoll ? 6 : player.diceToRoll;
            debugLog('Бросок костей', { 
                player: player.username,
                diceToRoll: diceToRoll,
                firstRoll: player.firstRoll
            });
            
            if (player.firstRoll || player.diceToRoll === 6) {
                player.dice = Array(6).fill(0);
                player.selected = Array(6).fill(false);
                debugLog('Сброс всех костей');
            }
            
            // Бросаем кости
            let rolled = 0;
            for (let i = 0; i < 6 && rolled < diceToRoll; i++) {
                if (player.dice[i] === 0) {
                    player.dice[i] = Math.floor(Math.random() * 6) + 1;
                    rolled++;
                }
            }
            
            player.firstRoll = false;
            player.roundScore = game.calculateScore(player.dice, player.selected);
            
            debugLog('Кости брошены', { 
                dice: player.dice,
                roundScore: player.roundScore
            });
            
            // Проверяем ZONK
            if (game.isZonk(player.dice)) {
                debugLog('ZONK!', { player: player.username });
                io.to(roomId).emit('gameMessage', { 
                    type: 'zonk', 
                    player: player.username 
                });
                player.roundScore = 0;
                game.nextPlayer();
            }
            
            io.to(roomId).emit('gameState', getGameState(game));
            
        } catch (error) {
            debugLog('Ошибка броска костей', error);
        }
    });

    // Выбор кости
    socket.on('toggleDice', (data) => {
        try {
            const { roomId, index } = data;
            debugLog('Переключение кости', { roomId, index, socketId: socket.id });
            
            const game = games.get(roomId);
            const player = game?.getCurrentPlayer();
            
            if (!game || !player) {
                debugLog('Игра или игрок не найдены', { roomId });
                return;
            }
            
            if (game.status !== 'playing') {
                debugLog('Игра не активна', { status: game.status });
                return;
            }
            
            if (player.id !== socket.id) {
                debugLog('Не ваш ход для переключения кости', { 
                    currentPlayer: player.username,
                    requester: socket.id 
                });
                return;
            }
            
            if (player.firstRoll) {
                debugLog('Нельзя выбирать кости до первого броска');
                return;
            }
            
            player.selected[index] = !player.selected[index];
            player.roundScore = game.calculateScore(player.dice, player.selected);
            
            const selectedCount = player.selected.filter(s => s).length;
            player.diceToRoll = 6 - selectedCount;
            
            debugLog('Кость переключена', { 
                index: index,
                selected: player.selected[index],
                diceToRoll: player.diceToRoll,
                roundScore: player.roundScore
            });
            
            // Проверяем Hot Dice
            if (game.isHotDice(player.dice, player.selected)) {
                player.diceToRoll = 6;
                debugLog('Hot Dice!', { player: player.username });
                io.to(roomId).emit('gameMessage', { 
                    type: 'hotDice', 
                    player: player.username 
                });
            }
            
            io.to(roomId).emit('gameState', getGameState(game));
            
        } catch (error) {
            debugLog('Ошибка переключения кости', error);
        }
    });

    // Взять очки
    socket.on('takePoints', (roomId) => {
        try {
            debugLog('Запрос на взятие очков', { roomId, socketId: socket.id });
            const game = games.get(roomId);
            const player = game?.getCurrentPlayer();
            
            if (!game || !player) {
                debugLog('Игра или игрок не найдены', { roomId });
                return;
            }
            
            if (game.status !== 'playing') {
                debugLog('Игра не активна', { status: game.status });
                return;
            }
            
            if (player.id !== socket.id) {
                debugLog('Не ваш ход для взятия очков', { 
                    currentPlayer: player.username,
                    requester: socket.id 
                });
                return;
            }
            
            if (!game.canTakePoints(player)) {
                debugLog('Нельзя взять очки', { 
                    roundScore: player.roundScore,
                    totalScore: player.score
                });
                socket.emit('error', 'Нельзя взять очки. Нужно минимум 300 очков для первого взятия.');
                return;
            }
            
            const pointsEarned = player.roundScore;
            player.score += pointsEarned;
            
            debugLog('Очки взяты', { 
                player: player.username,
                pointsEarned: pointsEarned,
                newTotal: player.score
            });
            
            io.to(roomId).emit('gameMessage', { 
                type: 'takePoints', 
                player: player.username, 
                score: pointsEarned 
            });
            
            // Проверяем победу
            if (player.score >= 1000) {
                game.status = 'finished';
                game.winner = player.username;
                debugLog('Игра завершена! Победитель', { winner: player.username });
                io.to(roomId).emit('gameMessage', { 
                    type: 'win', 
                    player: player.username, 
                    score: player.score 
                });
            } else {
                game.nextPlayer();
            }
            
            // Сбрасываем состояние игрока
            player.dice = [1, 1, 1, 1, 1, 1];
            player.selected = [false, false, false, false, false, false];
            player.diceToRoll = 6;
            player.firstRoll = true;
            player.roundScore = 0;
            
            io.to(roomId).emit('gameState', getGameState(game));
            
        } catch (error) {
            debugLog('Ошибка взятия очков', error);
        }
    });

    // Сообщения в чат
    socket.on('chatMessage', (data) => {
        try {
            const { roomId, message } = data;
            debugLog('Сообщение в чат', { roomId, message, socketId: socket.id });
            
            const game = games.get(roomId);
            const player = game?.players.find(p => p.id === socket.id);
            
            if (game && player && message.trim()) {
                debugLog('Отправка сообщения в чат', { 
                    player: player.username, 
                    message: message.trim(),
                    roomPlayers: game.players.length
                });
                io.to(roomId).emit('chatMessage', {
                    player: player.username,
                    message: message.trim()
                });
            } else {
                debugLog('Ошибка отправки сообщения', { 
                    gameExists: !!game, 
                    playerFound: !!player, 
                    messageLength: message?.length,
                    roomId: roomId
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
                    debugLog('Удаление игрока из комнаты', { 
                        roomId, 
                        username: player.username 
                    });
                    io.to(roomId).emit('playerLeft', { username: player.username });
                    game.removePlayer(socket.id);
                    
                    if (game.players.length === 0) {
                        games.delete(roomId);
                        debugLog('Комната удалена (нет игроков)', roomId);
                    } else {
                        io.to(roomId).emit('gameState', getGameState(game));
                    }
                }
            }
            players.delete(socket.id);
        }
        
        debugGames();
    });
});

// Вспомогательная функция для получения состояния игры
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

// API для проверки состояния сервера
app.get('/api/debug', (req, res) => {
    const debugInfo = {
        totalGames: games.size,
        totalPlayers: players.size,
        games: Array.from(games.entries()).map(([roomId, game]) => ({
            roomId,
            status: game.status,
            players: game.players.map(p => ({
                username: p.username,
                score: p.score,
                id: p.id
            })),
            currentPlayerIndex: game.currentPlayerIndex
        }))
    };
    res.json(debugInfo);
});

// Запуск сервера
server.listen(PORT, () => {
    console.log(`🎲 Zonk Multiplayer запущен на порту ${PORT}`);
    console.log(`📍 http://localhost:${PORT}`);
    console.log(`🔧 Debug API: http://localhost:${PORT}/api/debug`);
});

// Периодическая очистка пустых комнат (на всякий случай)
setInterval(() => {
    let cleaned = 0;
    games.forEach((game, roomId) => {
        if (game.players.length === 0) {
            games.delete(roomId);
            cleaned++;
        }
    });
    if (cleaned > 0) {
        debugLog(`Очищено пустых комнат: ${cleaned}`);
    }
}, 60000); // Каждую минуту
