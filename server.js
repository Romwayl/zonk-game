const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Настройки
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.json());

// Хранилище игр и игроков
const games = new Map();
const players = new Map();
const connectedSockets = new Set();

// Логика игры
class ZonkGame {
  constructor(roomId) {
    this.roomId = roomId;
    this.players = [];
    this.currentPlayerIndex = 0;
    this.status = 'waiting';
    this.winner = null;
  }

  addPlayer(playerId, username) {
    if (this.players.length >= 4) return false;
    
    // Проверяем, не присоединился ли игрок уже
    if (this.players.find(p => p.id === playerId)) return true;
    
    const player = {
      id: playerId,
      username: username || `Игрок ${this.players.length + 1}`,
      score: 0,
      roundScore: 0,
      dice: [1, 1, 1, 1, 1, 1],
      selected: [false, false, false, false, false, false],
      diceToRoll: 6,
      firstRoll: true,
      connected: true
    };
    
    this.players.push(player);
    return true;
  }

  removePlayer(playerId) {
    const playerIndex = this.players.findIndex(p => p.id === playerId);
    if (playerIndex !== -1) {
      this.players.splice(playerIndex, 1);
      
      // Корректируем текущего игрока если нужно
      if (this.currentPlayerIndex >= playerIndex && this.currentPlayerIndex > 0) {
        this.currentPlayerIndex--;
      }
      
      if (this.players.length === 0) {
        games.delete(this.roomId);
      }
    }
  }

  getCurrentPlayer() {
    return this.players[this.currentPlayerIndex];
  }

  nextPlayer() {
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

  canTakePoints(player, currentScore) {
    if (player.score === 0) {
      return currentScore >= 300;
    }
    return currentScore > 0;
  }

  isHotDice(dice, selected) {
    return selected.every(s => s) && this.calculateScore(dice, selected) > 0;
  }
}

// Socket.io соединения
io.on('connection', (socket) => {
  console.log('Пользователь подключился:', socket.id);
  connectedSockets.add(socket.id);
  
  // Отправляем количество онлайн игроков
  io.emit('onlineCount', connectedSockets.size);

  socket.on('createGame', (username) => {
    try {
      const roomId = uuidv4().slice(0, 8);
      const game = new ZonkGame(roomId);
      game.addPlayer(socket.id, username);
      
      games.set(roomId, game);
      players.set(socket.id, roomId);
      
      socket.join(roomId);
      console.log(`Игра создана: ${roomId}, игрок: ${username}`);
      socket.emit('gameCreated', roomId);
      io.to(roomId).emit('gameState', getGameState(game));
    } catch (error) {
      console.error('Ошибка создания игры:', error);
      socket.emit('error', 'Ошибка создания игры');
    }
  });

  socket.on('joinGame', (data) => {
    try {
      const { roomId, username } = data;
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
        console.log(`Игрок ${username} присоединился к ${roomId}`);
        
        socket.emit('gameJoined', roomId);
        io.to(roomId).emit('playerJoined', { username });
        io.to(roomId).emit('gameState', getGameState(game));
      } else {
        socket.emit('error', 'Комната заполнена');
      }
    } catch (error) {
      console.error('Ошибка присоединения:', error);
      socket.emit('error', 'Ошибка присоединения к игре');
    }
  });

  socket.on('joinRoom', (roomId) => {
    try {
      const game = games.get(roomId);
      if (game) {
        socket.join(roomId);
        io.to(roomId).emit('gameState', getGameState(game));
      }
    } catch (error) {
      console.error('Ошибка подключения к комнате:', error);
    }
  });

  socket.on('startGame', (roomId) => {
    try {
      const game = games.get(roomId);
      if (game && game.players.length >= 2 && game.players[0].id === socket.id) {
        game.status = 'playing';
        console.log(`Игра началась в комнате ${roomId}`);
        io.to(roomId).emit('gameStarted');
        io.to(roomId).emit('gameState', getGameState(game));
      }
    } catch (error) {
      console.error('Ошибка начала игры:', error);
    }
  });

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
        
        if (game.isZonk(player.dice)) {
          player.roundScore = 0;
          game.nextPlayer();
          io.to(roomId).emit('gameMessage', { type: 'zonk', player: player.username });
        } else {
          player.roundScore = game.calculateScore(player.dice, player.selected);
        }
        
        io.to(roomId).emit('gameState', getGameState(game));
      }
    } catch (error) {
      console.error('Ошибка броска костей:', error);
    }
  });

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
          io.to(roomId).emit('gameMessage', { type: 'hotDice', player: player.username });
        }
        
        io.to(roomId).emit('gameState', getGameState(game));
      }
    } catch (error) {
      console.error('Ошибка переключения кости:', error);
    }
  });

  socket.on('takePoints', (roomId) => {
    try {
      const game = games.get(roomId);
      const player = game?.getCurrentPlayer();
      
      if (game && player && player.id === socket.id && game.status === 'playing') {
        const currentScore = game.calculateScore(player.dice, player.selected);
        
        if (game.canTakePoints(player, currentScore)) {
          player.score += currentScore;
          
          if (player.score >= 5000) {
            game.status = 'finished';
            game.winner = player.username;
            io.to(roomId).emit('gameMessage', { type: 'win', player: player.username, score: player.score });
          } else {
            game.nextPlayer();
            io.to(roomId).emit('gameMessage', { type: 'takePoints', player: player.username, score: currentScore });
          }
          
          player.roundScore = 0;
          player.dice = [1, 1, 1, 1, 1, 1];
          player.selected = [false, false, false, false, false, false];
          player.diceToRoll = 6;
          player.firstRoll = true;
        }
        
        io.to(roomId).emit('gameState', getGameState(game));
      }
    } catch (error) {
      console.error('Ошибка взятия очков:', error);
    }
  });

  socket.on('chatMessage', (data) => {
    try {
      const { roomId, message } = data;
      const game = games.get(roomId);
      const player = game?.players.find(p => p.id === socket.id);
      
      if (game && player) {
        io.to(roomId).emit('chatMessage', {
          player: player.username,
          message: message
        });
      }
    } catch (error) {
      console.error('Ошибка отправки сообщения:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('Пользователь отключился:', socket.id);
    connectedSockets.delete(socket.id);
    io.emit('onlineCount', connectedSockets.size);
    
    const roomId = players.get(socket.id);
    if (roomId) {
      const game = games.get(roomId);
      if (game) {
        const player = game.players.find(p => p.id === socket.id);
        if (player) {
          io.to(roomId).emit('playerLeft', { username: player.username });
          game.removePlayer(socket.id);
          io.to(roomId).emit('gameState', getGameState(game));
        }
      }
      players.delete(socket.id);
    }
  });
});

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

server.listen(PORT, () => {
  console.log(`🎲 Zonk Multiplayer запущен на порту ${PORT}`);
});
