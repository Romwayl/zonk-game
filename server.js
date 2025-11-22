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
  // Основной подсчет очков
  calculateScore(dice, selected) {
    if (selected.every(s => !s)) return 0;
    
    let score = 0;
    const counts = [0, 0, 0, 0, 0, 0, 0];
    const tempDice = [...dice];
    const tempSelected = [...selected];
    
    // Считаем только выбранные кости
    for (let i = 0; i < 6; i++) {
      if (tempSelected[i]) {
        counts[tempDice[i]]++;
      }
    }

    // Проверяем специальные комбинации сначала
    const selectedDice = tempDice.filter((_, i) => tempSelected[i]);
    const selectedCounts = [0, 0, 0, 0, 0, 0, 0];
    selectedDice.forEach(die => selectedCounts[die]++);

    // 1. Шесть разных (1-2-3-4-5-6)
    if (selectedDice.length === 6 && new Set(selectedDice).size === 6) {
      return 1500;
    }

    // 2. Три пары
    const pairs = selectedCounts.filter(count => count === 2);
    if (pairs.length === 3) {
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
        selectedCounts[i] = 0; // Убираем использованные кости
      }
    }

    // 4. Одиночные 1 и 5 (только если не использованы в комбинациях)
    score += selectedCounts[1] * 100;
    score += selectedCounts[5] * 50;

    return score;
  },

  // Проверка на ZONK (нет возможных комбинаций)
  isZonk(dice) {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    dice.forEach(die => counts[die]++);

    // Проверяем наличие хотя бы одной комбинации
    if (counts[1] >= 1) return false; // Есть единица
    if (counts[5] >= 1) return false; // Есть пятерка
    
    // Проверяем комбинации из 3+ одинаковых
    for (let i = 1; i <= 6; i++) {
      if (counts[i] >= 3) return false;
    }
    
    // Проверяем три пары
    const pairs = counts.filter(count => count === 2);
    if (pairs.length === 3) return false;
    
    // Проверяем прямую (1-2-3-4-5-6)
    if (counts.filter(count => count === 1).length === 6) return false;

    return true; // ZONK!
  },

  // Можно ли забрать очки (минимум 300 для первого взятия)
  canTakePoints(gameState, currentScore) {
    if (gameState.totalScore === 0) {
      return currentScore >= 300; // Первый раз нужно минимум 300
    }
    return currentScore > 0; // Дальше можно любые очки
  },

  // Все ли кости дают очки? (Hot Dice - бонусный бросок)
  allDiceScore(dice) {
    return !this.isZonk(dice) && this.calculateScore(dice, Array(6).fill(true)) > 0;
  }
};

// Инициализация новой игры
function createNewGame() {
  return {
    dice: [1, 2, 3, 4, 5, 6], // Начинаем с прямой для демонстрации
    selected: [false, false, false, false, false, false],
    totalScore: 0,
    roundScore: 0,
    rollsLeft: 3,
    gameOver: false,
    zonkCount: 0, // Счетчик ZONK'ов подряд
    hasMinimumPoints: false // Достигнут ли минимум 300
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
  const zonk = game.rollsLeft < 3 && gameLogic.isZonk(game.dice);
  const allDiceUsed = game.selected.every(s => s) && currentScore > 0;
  const canTake = gameLogic.canTakePoints(game, currentScore);
  
  res.render('game', { 
    game: game,
    currentScore: currentScore,
    zonk: zonk,
    allDiceUsed: allDiceUsed,
    canTake: canTake
  });
});

app.post('/roll', (req, res) => {
  if (!req.session.game) {
    req.session.game = createNewGame();
  }
  
  const game = req.session.game;
  
  if (game.rollsLeft > 0 && !game.gameOver) {
    // Hot Dice - все кости дают очки, бросаем снова все
    if (game.selected.every(s => s) && gameLogic.allDiceScore(game.dice)) {
      game.selected = [false, false, false, false, false, false];
      game.rollsLeft = 3; // Сбрасываем счетчик бросков
    }
    
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
    if (gameLogic.isZonk(game.dice) && game.rollsLeft < 3) {
      game.zonkCount++;
      game.roundScore = 0;
      // Штраф за 3 ZONK'а подряд
      if (game.zonkCount >= 3) {
        game.totalScore = Math.max(0, game.totalScore - 500);
        game.zonkCount = 0;
      }
    } else {
      game.roundScore = gameLogic.calculateScore(game.dice, game.selected);
      game.zonkCount = 0; // Сбрасываем счетчик ZONK'ов
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
  const currentScore = gameLogic.calculateScore(game.dice, game.selected);
  
  if (!game.gameOver && gameLogic.canTakePoints(game, currentScore)) {
    game.totalScore += currentScore;
    game.hasMinimumPoints = true; // Теперь можно брать любые очки
    
    // Hot Dice - все кости дают очки, продолжаем ход
    if (game.selected.every(s => s) && gameLogic.allDiceScore(game.dice)) {
      game.selected = [false, false, false, false, false, false];
      game.rollsLeft = 3;
      // Автоматически бросаем новые кости
      for (let i = 0; i < 6; i++) {
        game.dice[i] = Math.floor(Math.random() * 6) + 1;
      }
    } else {
      game.roundScore = 0;
      game.rollsLeft = 3;
      game.selected = [false, false, false, false, false, false];
    }
    
    // Проверяем победу
    if (game.totalScore >= 5000) {
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
