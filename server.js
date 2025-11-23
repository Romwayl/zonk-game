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

// Хранилище игр в памяти (в продакшене используй Redis)
const games = new Map();
const players = new Map();

// Логика игры
class ZonkGame {
  constructor(roomId) {
    this.roomId = roomId;
    this.players = [];
    this.currentPlayerIndex = 0;
    this.status = 'waiting'; // waiting, playing, finished
    this.winner = null;
  }

  addPlayer(playerId, username) {
    if (this.players.length >= 4) return false;
    
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
    this.players = this.players.filter(p => p.id !== playerId);
    if (this.players.length === 0) {
      games.delete(this.roomId);
    }
  }

  getCurrentPlayer() {
    return this.players[this.currentPlayerIndex];
  }

  nextPlayer() {
    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
    this.getCurrentPlayer().firstRoll = true;
    this.getCurrentPlayer().diceToRoll = 6;
    this.getCurrentPlayer().selected = [false, false, false, false, false, false];
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

  socket.on('createGame', (username) => {
    const roomId = uuidv4().slice(0, 8);
    const game = new ZonkGame(roomId);
    game.addPlayer(socket.id, username);
    
    games.set(roomId, game);
    players.set(socket.id, roomId);
    
    socket.join(roomId);
    socket.emit('gameCreated', roomId);
    io.to(roomId).emit('gameState', getGameState(game));
  });

  socket.on('joinGame', (data) => {
    const { roomId, username } = data;
    const game = games.get(roomId);
    
    if (game && game.status === 'waiting') {
      if (game.addPlayer(socket.id, username)) {
        players.set(socket.id, roomId);
        socket.join(roomId);
        socket.emit('gameJoined', roomId);
        io.to(roomId).emit('gameState', getGameState(game));
      } else {
        socket.emit('error', 'Комната заполнена');
      }
    } else {
      socket.emit('error', 'Комната не найдена или игра уже началась');
    }
  });

  socket.on('startGame', (roomId) => {
    const game = games.get(roomId);
    if (game && game.players.length >= 2) {
      game.status = 'playing';
      io.to(roomId).emit('gameStarted');
      io.to(roomId).emit('gameState', getGameState(game));
    }
  });

  socket.on('rollDice', (roomId) => {
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
      } else {
        player.roundScore = game.calculateScore(player.dice, player.selected);
      }
      
      io.to(roomId).emit('gameState', getGameState(game));
    }
  });

  socket.on('toggleDice', (data) => {
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
      }
      
      io.to(roomId).emit('gameState', getGameState(game));
    }
  });

  socket.on('takePoints', (roomId) => {
    const game = games.get(roomId);
    const player = game?.getCurrentPlayer();
    
    if (game && player && player.id === socket.id && game.status === 'playing') {
      const currentScore = game.calculateScore(player.dice, player.selected);
      
      if (game.canTakePoints(player, currentScore)) {
        player.score += currentScore;
        
        if (player.score >= 5000) {
          game.status = 'finished';
          game.winner = player.username;
        } else {
          game.nextPlayer();
        }
        
        player.roundScore = 0;
        player.dice = [1, 1, 1, 1, 1, 1];
        player.selected = [false, false, false, false, false, false];
        player.diceToRoll = 6;
        player.firstRoll = true;
      }
      
      io.to(roomId).emit('gameState', getGameState(game));
    }
  });

  socket.on('disconnect', () => {
    console.log('Пользователь отключился:', socket.id);
    const roomId = players.get(socket.id);
    if (roomId) {
      const game = games.get(roomId);
      if (game) {
        game.removePlayer(socket.id);
        io.to(roomId).emit('gameState', getGameState(game));
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
  res.render('game', { roomId: req.params.roomId });
});

app.get('/create', (req, res) => {
  res.render('create');
});

server.listen(PORT, () => {
  console.log(`🎲 Zonk Multiplayer запущен на порту ${PORT}`);
});
