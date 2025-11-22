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
app.use(session({
  secret: 'zonk-secret-key',
  resave: false,
  saveUninitialized: true
}));

// Логика игры
class ZonkGame {
  constructor() {
    this.dice = [0, 0, 0, 0, 0, 0];
    this.selected = [false, false, false, false, false, false];
    this.roundScore = 0;
    this.totalScore = 0;
    this.rollsLeft = 3;
  }

  rollDice() {
    if (this.rollsLeft > 0) {
      for (let i = 0; i < 6; i++) {
        if (!this.selected[i]) {
          this.dice[i] = Math.floor(Math.random() * 6) + 1;
        }
      }
      this.rollsLeft--;
      return true;
    }
    return false;
  }

  toggleDice(index) {
    if (this.rollsLeft < 3) {
      this.selected[index] = !this.selected[index];
    }
  }

  calculateScore() {
    // Простая логика подсчета очков
    let score = 0;
    const counts = [0, 0, 0, 0, 0, 0, 0];
    
    this.dice.forEach(die => {
      counts[die]++;
    });

    // 1 и 5 дают очки
    score += counts[1] * 100;
    score += counts[5] * 50;

    // Комбинации
    for (let i = 1; i <= 6; i++) {
      if (counts[i] >= 3) {
        score += i === 1 ? 1000 : i * 100;
      }
    }

    return score;
  }

  takePoints() {
    const score = this.calculateScore();
    this.totalScore += score;
    this.resetRound();
    return score;
  }

  resetRound() {
    this.dice = [0, 0, 0, 0, 0, 0];
    this.selected = [false, false, false, false, false, false];
    this.roundScore = 0;
    this.rollsLeft = 3;
  }

  isZonk() {
    return this.calculateScore() === 0;
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
  res.render('game', { game: req.session.game });
});

app.post('/roll', (req, res) => {
  const game = req.session.game;
  game.rollDice();
  res.redirect('/game');
});

app.post('/toggle/:index', (req, res) => {
  const game = req.session.game;
  game.toggleDice(parseInt(req.params.index));
  res.redirect('/game');
});

app.post('/take', (req, res) => {
  const game = req.session.game;
  game.takePoints();
  res.redirect('/game');
});

app.post('/reset', (req, res) => {
  req.session.game = new ZonkGame();
  res.redirect('/game');
});

app.listen(PORT, () => {
  console.log(`Zonk игра запущена на порту ${PORT}`);
});
