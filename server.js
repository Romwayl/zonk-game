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

// Логика игры
class ZonkGame {
  constructor() {
    this.dice = [1, 1, 1, 1, 1, 1]; // Начинаем с всех костей = 1
    this.selected = [false, false, false, false, false, false];
    this.totalScore = 0;
    this.roundScore = 0;
    this.rollsLeft = 3;
    this.gameOver = false;
  }

  rollDice() {
    if (this.rollsLeft > 0 && !this.gameOver) {
      // Сбрасываем выбор если это первый бросок
      if (this.rollsLeft === 3) {
        this.selected = [false, false, false, false, false, false];
      }
      
      for (let i = 0; i < 6; i++) {
        if (!this.selected[i]) {
          this.dice[i] = Math.floor(Math.random() * 6) + 1;
        }
      }
      this.rollsLeft--;
      
      // Проверяем ZONK
      if (this.calculateScore() === 0) {
        this.roundScore = 0;
        this.rollsLeft = 0;
      } else {
        this.roundScore = this.calculateScore();
      }
      return true;
    }
    return false;
  }

  toggleDice(index) {
    if (this.rollsLeft < 3 && !this.gameOver) {
      this.selected[index] = !this.selected[index];
      this.roundScore = this.calculateScore();
    }
  }

  calculateScore() {
    let score = 0;
    const counts = [0, 0, 0, 0, 0, 0, 0];
    const tempDice = [...this.dice];
    
    // Считаем только выбранные кости
    for (let i = 0; i < 6; i++) {
      if (this.selected[i]) {
        counts[this.dice[i]]++;
      }
    }

    // 1 и 5 дают очки
    score += counts[1] * 100;
    score += counts[5] * 50;

    // Комбинации
    for (let i = 1; i <= 6; i++) {
      if (counts[i] >= 3) {
        score += i === 1 ? 1000 : i * 100;
        // Убираем использованные кости из подсчета для дополнительных очков
        counts[i] -= 3;
      }
    }

    return score;
  }

  takePoints() {
    if (!this.gameOver) {
      this.totalScore += this.roundScore;
      this.roundScore = 0;
      this.rollsLeft = 3;
      this.selected = [false, false, false, false, false, false];
      
      // Автоматически бросаем новые кости
      for (let i = 0; i < 6; i++) {
        this.dice[i] = Math.floor(Math.random() * 6) + 1;
      }
      
      // Проверяем победу
      if (this.totalScore >= 1000) {
        this.gameOver = true;
      }
    }
  }

  resetGame() {
    this.dice = [1, 1, 1, 1, 1, 1];
    this.selected = [false, false, false, false, false, false];
    this.totalScore = 0;
    this.roundScore = 0;
    this.rollsLeft = 3;
    this.gameOver = false;
  }
}

// Маршруты
app.get('/', (req, res) => {
  res.render('index');
});

app.get('/game', (req, res) => {
  if (!req.session.game) {
    req.session.game = new ZonkGame();
  }
  const game = req.session.game;
  res.render('game', { 
    game: game,
    dice: game.dice,
    selected: game.selected,
    totalScore: game.totalScore,
    roundScore: game.roundScore,
    rollsLeft: game.rollsLeft,
    gameOver: game.gameOver
  });
});

app.post('/roll', (req, res) => {
  if (!req.session.game) {
    req.session.game = new ZonkGame();
  }
  req.session.game.rollDice();
  res.redirect('/game');
});

app.post('/toggle/:index', (req, res) => {
  if (!req.session.game) {
    req.session.game = new ZonkGame();
  }
  req.session.game.toggleDice(parseInt(req.params.index));
  res.redirect('/game');
});

app.post('/take', (req, res) => {
  if (!req.session.game) {
    req.session.game = new ZonkGame();
  }
  req.session.game.takePoints();
  res.redirect('/game');
});

app.post('/reset', (req, res) => {
  req.session.game = new ZonkGame();
  res.redirect('/game');
});

app.listen(PORT, () => {
  console.log(`🎲 Zonk игра запущена на порту ${PORT}`);
});
