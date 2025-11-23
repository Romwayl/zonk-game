// Get room ID from window variable set by EJS template
const roomId = window.ROOM_ID;
const socket = io();
let myPlayerId = null;
let isMyTurn = false;

// Расширенная отладка
function debugLog(message, data = null) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] 🎮 ${message}`, data || '');
    updateDebugInfo(message);
}

function updateDebugInfo(message) {
    const debugInfo = document.getElementById('debugInfo');
    if (debugInfo) {
        const line = document.createElement('div');
        line.className = 'debug-line';
        line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        debugInfo.appendChild(line);
        debugInfo.scrollTop = debugInfo.scrollHeight;
    }
}

debugLog('Инициализация игры', { roomId });

// Подключение к серверу
socket.on('connect', () => {
    debugLog('Подключен к серверу', { socketId: socket.id });
    myPlayerId = socket.id;
    
    const debugStatus = document.getElementById('debugStatus');
    const debugSocketId = document.getElementById('debugSocketId');
    const debugRoom = document.getElementById('debugRoom');
    
    if (debugStatus) debugStatus.textContent = 'Connected';
    if (debugSocketId) debugSocketId.textContent = socket.id;
    if (debugRoom) debugRoom.textContent = roomId;

    // Подключаемся к комнате
    if (roomId && roomId !== '') {
        debugLog('Подключение к комнате', roomId);
        socket.emit('joinRoom', { roomId, username: 'Игрок' });
    } else {
        debugLog('Ошибка: нет ID комнаты');
        window.location.href = '/';
    }
});

socket.on('disconnect', () => {
    debugLog('Отключен от сервера');
    const debugStatus = document.getElementById('debugStatus');
    if (debugStatus) debugStatus.textContent = 'Disconnected';
});

socket.on('connect_error', (error) => {
    debugLog('Ошибка подключения', error);
    const debugStatus = document.getElementById('debugStatus');
    if (debugStatus) debugStatus.textContent = 'Error';
});

// Обработчики игровых событий
socket.on('gameState', (gameState) => {
    debugLog('Получено состояние игры', { 
        status: gameState.status, 
        players: gameState.players.length,
        currentPlayer: gameState.players[gameState.currentPlayerIndex]?.username 
    });
    updateGameState(gameState);
});

socket.on('playerJoined', (data) => {
    debugLog('Игрок присоединился', data);
    const player = data.player || data;
    addChatMessage('system', `Игрок ${player.username} присоединился к игре`);
});

socket.on('playerLeft', (data) => {
    debugLog('Игрок вышел', data);
    const player = data.player || data;
    addChatMessage('system', `Игрок ${player.username} вышел из игры`);
});

socket.on('gameStarted', () => {
    debugLog('Игра началась!');
    addChatMessage('system', '🎮 Игра началась! Удачи!');
});

socket.on('rolled', (data) => {
    debugLog('Кости брошены', data);
    addChatMessage('system', `🎲 ${data.player} бросил кости: ${data.dice.join(', ')}`);
});

socket.on('gameMessage', (data) => {
    debugLog('Игровое сообщение', data);
    handleGameMessage(data);
});

socket.on('chatMessage', (data) => {
    debugLog('Сообщение в чате', data);
    addChatMessage(data.player, data.message);
});

socket.on('error', (message) => {
    debugLog('Ошибка от сервера', message);
    alert('Ошибка: ' + message);
});

// Функции обновления интерфейса
function updateGameState(gameState) {
    debugLog('Обновление состояния игры', { 
        status: gameState.status,
        players: gameState.players.map(p => p.username)
    });
    
    updatePlayersList(gameState);
    updateRoomInfo(gameState);
    updateGameStatus(gameState);
    updateGameControls(gameState);
}

function updatePlayersList(gameState) {
    const playersList = document.getElementById('playersList');
    const playerCount = document.getElementById('playerCount');
    
    if (!playersList || !playerCount) return;
    
    playersList.innerHTML = '';
    playerCount.textContent = `${gameState.players.length}/4`;
    
    gameState.players.forEach((player, index) => {
        const playerElement = document.createElement('div');
        playerElement.className = `player-item ${index === gameState.currentPlayerIndex ? 'current-player' : ''}`;
        
        const isMe = player.id === myPlayerId;
        playerElement.innerHTML = `
            <span class="player-name">
                ${player.username} ${isMe ? ' (Вы)' : ''}
                ${index === gameState.currentPlayerIndex ? ' 🎯' : ''}
            </span>
            <span class="player-score">${player.score}</span>
        `;
        
        playersList.appendChild(playerElement);
    });
    
    debugLog('Список игроков обновлен', { count: gameState.players.length });
}

function updateRoomInfo(gameState) {
    const roomCode = document.getElementById('roomCode');
    if (roomCode) roomCode.textContent = gameState.roomId;
}

function updateGameStatus(gameState) {
    const gameStatus = document.getElementById('gameStatus');
    const winnerMessage = document.getElementById('winnerMessage');
    const waitingArea = document.getElementById('waitingArea');
    const gameControls = document.getElementById('gameControls');
    
    if (!gameStatus) return;
    
    if (gameState.status === 'waiting') {
        gameStatus.textContent = `Ожидание игроков... (${gameState.players.length}/4)`;
        if (waitingArea) waitingArea.style.display = 'block';
        if (gameControls) gameControls.style.display = 'none';
        if (winnerMessage) winnerMessage.style.display = 'none';
        
        // Показываем кнопку начала если есть минимум 2 игрока и я создатель
        const canStart = gameState.players.length >= 2 && gameState.players[0].id === myPlayerId;
        const startGameBtn = document.getElementById('startGameBtn');
        if (startGameBtn) startGameBtn.style.display = canStart ? 'block' : 'none';
        
        debugLog('Статус: Ожидание', { 
            players: gameState.players.length, 
            canStart: canStart,
            amICreator: gameState.players[0]?.id === myPlayerId
        });
        
    } else if (gameState.status === 'playing') {
        gameStatus.textContent = 'Игра идет!';
        if (waitingArea) waitingArea.style.display = 'none';
        if (gameControls) gameControls.style.display = 'block';
        if (winnerMessage) winnerMessage.style.display = 'none';
        
        const currentPlayer = gameState.players[gameState.currentPlayerIndex];
        const currentPlayerEl = document.getElementById('currentPlayer');
        if (currentPlayerEl) currentPlayerEl.textContent = currentPlayer.username;
        
        debugLog('Статус: Игра идет', { currentPlayer: currentPlayer.username });
        
    } else if (gameState.status === 'finished') {
        gameStatus.textContent = 'Игра завершена!';
        if (winnerMessage) {
            winnerMessage.style.display = 'block';
            winnerMessage.innerHTML = `🏆 ПОБЕДА!<br>${gameState.winner} выигрывает!`;
        }
        
        debugLog('Статус: Завершена', { winner: gameState.winner });
    }
}

function updateGameControls(gameState) {
    const currentPlayerArea = document.getElementById('currentPlayerArea');
    const observerArea = document.getElementById('observerArea');
    
    const myPlayer = gameState.players.find(p => p.id === myPlayerId);
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    isMyTurn = currentPlayer && currentPlayer.id === myPlayerId;
    
    const debugMyTurn = document.getElementById('debugMyTurn');
    const debugGameStatus = document.getElementById('debugGameStatus');
    if (debugMyTurn) debugMyTurn.textContent = isMyTurn ? 'YES' : 'NO';
    if (debugGameStatus) debugGameStatus.textContent = gameState.status;
    
    debugLog('Обновление контролов', { 
        myPlayer: !!myPlayer, 
        isMyTurn: isMyTurn,
        gameStatus: gameState.status
    });
    
    if (myPlayer) {
        // Я игрок
        if (currentPlayerArea) currentPlayerArea.style.display = 'block';
        if (observerArea) observerArea.style.display = 'none';
        
        const myScore = document.getElementById('myScore');
        const roundScore = document.getElementById('roundScore');
        const diceToRoll = document.getElementById('diceToRoll');
        
        if (myScore) myScore.textContent = myPlayer.score;
        if (roundScore) roundScore.textContent = myPlayer.roundScore;
        if (diceToRoll) diceToRoll.textContent = myPlayer.diceToRoll;
        
        const playerControls = document.getElementById('playerControls');
        const diceContainer = document.getElementById('diceContainer');
        
        if (isMyTurn && gameState.status === 'playing') {
            if (playerControls) playerControls.style.display = 'grid';
            if (diceContainer) diceContainer.style.display = 'grid';
            updateMyDice(myPlayer.dice, myPlayer.selected);
            
            // Обновляем состояние кнопок
            const rollBtn = document.getElementById('rollBtn');
            const takeBtn = document.getElementById('takeBtn');
            
            if (rollBtn) rollBtn.disabled = myPlayer.diceToRoll === 0;
            const canTake = myPlayer.roundScore > 0 && (myPlayer.score > 0 || myPlayer.roundScore >= 300);
            if (takeBtn) takeBtn.disabled = !canTake;
            
            debugLog('Мой ход', { 
                diceToRoll: myPlayer.diceToRoll, 
                canTake: canTake,
                roundScore: myPlayer.roundScore
            });
            
        } else {
            if (playerControls) playerControls.style.display = 'none';
            if (diceContainer) diceContainer.style.display = 'none';
            
            if (gameState.status === 'playing') {
                debugLog('Ход другого игрока', { currentPlayer: currentPlayer.username });
            }
        }
    } else {
        // Я наблюдатель
        if (currentPlayerArea) currentPlayerArea.style.display = 'none';
        if (observerArea) observerArea.style.display = 'block';
        
        const observerCurrentPlayer = document.getElementById('observerCurrentPlayer');
        const observerRoundScore = document.getElementById('observerRoundScore');
        const observerDiceToRoll = document.getElementById('observerDiceToRoll');
        
        if (observerCurrentPlayer) observerCurrentPlayer.textContent = currentPlayer.username;
        if (observerRoundScore) observerRoundScore.textContent = currentPlayer.roundScore;
        if (observerDiceToRoll) observerDiceToRoll.textContent = currentPlayer.diceToRoll;
        updateObserverDice(currentPlayer.dice, currentPlayer.selected);
        
        debugLog('Режим наблюдателя', { currentPlayer: currentPlayer.username });
    }
}

// Игровые действия
function startGame() {
    debugLog('Нажата кнопка начала игры');
    socket.emit('startGame', roomId);
}

function rollDice() {
    debugLog('Нажата кнопка броска костей');
    socket.emit('roll', { roomId }, (response) => {
        debugLog('Ответ на бросок костей', response);
    });
}

function toggleDice(index) {
    debugLog('Переключение кости', index);
    socket.emit('toggleDice', { roomId, index });
}

function takePoints() {
    debugLog('Нажата кнопка взятия очков');
    socket.emit('takePoints', { roomId });
}

function sendMessage() {
    const input = document.getElementById('chatInput');
    if (!input) return;
    
    const message = input.value.trim();
    
    if (message) {
        debugLog('Отправка сообщения', message);
        socket.emit('chatMessage', { roomId, message });
        input.value = '';
    }
}

function copyRoomCode() {
    const roomCode = document.getElementById('roomCode');
    if (!roomCode) return;
    
    const roomCodeText = roomCode.textContent;
    const inviteText = `Присоединяйся к моей игре в ZONK! Код комнаты: ${roomCodeText}\n${window.location.origin}/game/${roomId}`;
    
    navigator.clipboard.writeText(inviteText).then(() => {
        addChatMessage('system', 'Приглашение скопировано! Отправь друзьям.');
    }).catch(() => {
        alert('Скопируйте вручную: ' + inviteText);
    });
}

function leaveGame() {
    if (confirm('Вы уверены, что хотите выйти из игры?')) {
        window.location.href = '/';
    }
}

// Вспомогательные функции
function addChatMessage(sender, message) {
    const chat = document.getElementById('chatMessages');
    if (!chat) return;
    
    const messageElement = document.createElement('div');
    
    if (sender === 'system') {
        messageElement.className = 'chat-message system';
        messageElement.textContent = message;
    } else {
        messageElement.className = 'chat-message';
        messageElement.innerHTML = `<strong>${sender}:</strong> ${message}`;
    }
    
    chat.appendChild(messageElement);
    chat.scrollTop = chat.scrollHeight;
}

function handleGameMessage(data) {
    let message = '';
    
    switch(data.type) {
        case 'zonk':
            message = `💥 ${data.player} получил ZONK! Очки раунда потеряны.`;
            break;
        case 'hotDice':
            message = `🎉 ${data.player} получил Hot Dice! Бросает снова все 6 костей.`;
            break;
        case 'takePoints':
            message = `💰 ${data.player} взял ${data.score} очков.`;
            break;
        case 'win':
            message = `🏆 ${data.player} побеждает с ${data.score} очками!`;
            break;
    }
    
    if (message) {
        addChatMessage('system', message);
    }
}

function updateMyDice(dice, selected) {
    const container = document.getElementById('diceContainer');
    if (!container) return;
    
    container.innerHTML = '';
    
    dice.forEach((value, index) => {
        const diceElement = document.createElement('div');
        diceElement.className = `dice ${selected[index] ? 'selected' : ''}`;
        diceElement.innerHTML = `<span class="dice-value">${value}</span>`;
        
        if (isMyTurn && !selected[index]) {
            diceElement.style.cursor = 'pointer';
            diceElement.onclick = () => toggleDice(index);
        } else {
            diceElement.style.cursor = 'default';
        }
        
        container.appendChild(diceElement);
    });
}

function updateObserverDice(dice, selected) {
    const container = document.getElementById('observerDice');
    if (!container) return;
    
    container.innerHTML = '';
    
    dice.forEach((value, index) => {
        const diceElement = document.createElement('div');
        diceElement.className = `dice ${selected[index] ? 'selected' : ''}`;
        diceElement.innerHTML = `<span class="dice-value">${value}</span>`;
        diceElement.style.cursor = 'default';
        container.appendChild(diceElement);
    });
}

// Обработчики клавиш
document.addEventListener('DOMContentLoaded', () => {
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
        chatInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
    }
});

// Периодическая проверка подключения
setInterval(() => {
    const debugStatus = document.getElementById('debugStatus');
    if (!socket.connected && debugStatus) {
        debugStatus.textContent = 'Reconnecting...';
    }
}, 5000);
