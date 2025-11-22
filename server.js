const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Настройки
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'zonk-secret-key',
  resave: false,
  saveUninitialized: true
}));

// Вспомогательные функции для игры
const gameLogic = {
  calculateScore(dice, selected) {
    let score = 0;
    const counts = [0, 0, 0, 0, 0, 0, 0];
    
    // Считаем только выбранные кости
    for (let i = 0; i < 6; i++) {
      if (selected[i]) {
        counts[dice[i]]++;
      }
    }

    // 1 и 5 дают очки
    score += counts[1] * 100;
    score += counts[5] * 50;

    // Комбинации
    for (let i = 1; i <= 6; i++) {
      if (counts[i] >= 3) {
        score += i === 1 ? 1000 : i * 100;
        counts[i] -= 3;
      }
    }

    return score;
  },

  isZonk(dice, selected) {
    return this.calculateScore(dice, selected) === 0;
  }
};

// Инициализация новой игры
function createNewGame() {
  return {
    dice: [1, 1, 1, 1, 1, 1],
    selected: [false, false, false, false, false, false],
    totalScore: 0,
    roundScore: 0,
    rollsLeft: 3,
    gameOver: false
  };
}

// Маршруты
app.get('/', (req, res) => {
  res.render('index');
});

app.get('/game', (req, res) => {
  if (!req.session.game) {
    req.session.game = createNewGame();
  }
  
  const game = req.session.game;
  const currentScore = gameLogic.calculateScore(game.dice, game.selected);
  const zonk = gameLogic.isZonk(game.dice, game.selected);
  
  res.render('game', { 
    game: game,
    currentScore: currentScore,
    zonk: zonk
  });
});

app.post('/roll', (req, res) => {
  if (!req.session.game) {
    req.session.game = createNewGame();
  }
  
  const game = req.session.game;
  
  if (game.rollsLeft > 0 && !game.gameOver) {
    // Сбрасываем выбор если это первый бросок
    if (game.rollsLeft === 3) {
      game.selected = [false, false, false, false, false, false];
    }
    
    // Бросаем невыбранные кости
    for (let i = 0; i < 6; i++) {
      if (!game.selected[i]) {
        game.dice[i] = Math.floor(Math.random() * 6) + 1;
      }
    }
    
    game.rollsLeft--;
    
    // Проверяем ZONK
    const currentScore = gameLogic.calculateScore(game.dice, game.selected);
    if (currentScore === 0 && game.rollsLeft < 3) {
      game.roundScore = 0;
    } else {
      game.roundScore = currentScore;
    }
  }
  
  res.redirect('/game');
});

app.post('/toggle/:index', (req, res) => {
  if (!req.session.game) {
    req.session.game = createNewGame();
  }
  
  const game = req.session.game;
  const index = parseInt(req.params.index);
  
  if (game.rollsLeft < 3 && !game.gameOver) {
    game.selected[index] = !game.selected[index];
    game.roundScore = gameLogic.calculateScore(game.dice, game.selected);
  }
  
  res.redirect('/game');
});

app.post('/take', (req, res) => {
  if (!req.session.game) {
    req.session.game = createNewGame();
  }
  
  const game = req.session.game;
  
  if (!game.gameOver) {
    game.totalScore += game.roundScore;
    game.roundScore = 0;
    game.rollsLeft = 3;
    game.selected = [false, false, false, false, false, false];
    
    // Автоматически бросаем новые кости
    for (let i = 0; i < 6; i++) {
      game.dice[i] = Math.floor(Math.random() * 6) + 1;
    }
    
    // Проверяем победу
    if (game.totalScore >= 1000) {
      game.gameOver = true;
    }
  }
  
  res.redirect('/game');
});

app.post('/reset', (req, res) => {
  req.session.game = createNewGame();
  res.redirect('/game');
});

app.listen(PORT, () => {
  console.log(`🎲 Zonk игра запущена на порту ${PORT}`);
});
