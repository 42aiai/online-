// Reasoning/Thinking Mode: ON
// The client script is refactored for a multi-room lobby experience.
// It now handles two distinct user flows: creating a room and joining a room.
// It sends the appropriate message (`createRoom` or `joinRoom`) with the necessary data.
// It stores the `roomCode` received from the server and displays it.
// All UI updates are driven by the server's `updateState` message, which now also contains room-specific information.

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const lobby = document.getElementById('lobby');
    const gameBoard = document.getElementById('game-board');
    const errorMessage = document.getElementById('error-message');

    // Create Room elements
    const createNicknameInput = document.getElementById('create-nickname');
    const gameLimitSelect = document.getElementById('game-limit');
    const createRoomBtn = document.getElementById('create-room-btn');

    // Join Room elements
    const joinNicknameInput = document.getElementById('join-nickname');
    const roomCodeInput = document.getElementById('room-code-input');
    const joinRoomBtn = document.getElementById('join-room-btn');

    // Game Board elements
    const roomCodeDisplay = document.getElementById('room-code-display');
    const copyCodeBtn = document.getElementById('copy-code-btn');
    const playersContainer = document.getElementById('players-container');
    const fieldContainer = document.getElementById('field');
    const myHandContainer = document.getElementById('my-hand');
    const myNameSpan = document.getElementById('my-name');
    const myRoleSpan = document.getElementById('my-role');
    const playBtn = document.getElementById('play-btn');
    const passBtn = document.getElementById('pass-btn');
    const startGameBtn = document.getElementById('start-game-btn');
    const systemMessage = document.getElementById('system-message');

    let ws;
    let myId = '';
    let roomCode = '';
    let selectedCards = [];

    function connectWebSocket(action) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(action));
            return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        ws = new WebSocket(`${protocol}//${host}`);

        ws.onopen = () => ws.send(JSON.stringify(action));
        ws.onmessage = (event) => handleServerMessage(JSON.parse(event.data));
        ws.onclose = () => displaySystemMessage('サーバーとの接続が切れました。', true);
        ws.onerror = (error) => console.error('WebSocket Error:', error);
    }

    function handleServerMessage(data) {
        errorMessage.textContent = ''; // Clear previous errors
        switch (data.type) {
            case 'updateState':
                updateUI(data);
                break;
            case 'errorMessage':
                errorMessage.textContent = data.message;
                break;
            case 'systemMessage':
                displaySystemMessage(data.message);
                break;
            // ... (other handlers like showContinueModal)
        }
    }

    function updateUI(state) {
        lobby.classList.add('hidden');
        gameBoard.classList.remove('hidden');

        myId = state.myId;
        roomCode = state.roomCode;
        roomCodeDisplay.textContent = roomCode;
        const me = state.players.find(p => p.id === myId);

        if (!me) return;
        
        // Host's start button logic
        if (state.isHost && state.gameState === 'waiting') {
            startGameBtn.classList.remove('hidden');
            startGameBtn.disabled = state.players.length < 2;
            startGameBtn.textContent = state.players.length >= 2 ? `ゲーム開始 (${state.players.length}人)` : '2人以上で開始可能';
        } else {
            startGameBtn.classList.add('hidden');
        }

        selectedCards = [];
        const isMyTurn = me.isTurn ?? false;
        playBtn.disabled = !isMyTurn;
        passBtn.disabled = !isMyTurn;

        playersContainer.innerHTML = '';
        state.players.forEach(player => {
            const playerDiv = document.createElement('div');
            playerDiv.className = `player-info ${player.isTurn ? 'is-turn' : ''}`;
            let playerLabel = player.name;
            if (player.id === myId) playerLabel += " (あなた)";
            if (player.isHost) playerLabel += " ★";
            
            playerDiv.innerHTML = `<h4>${playerLabel}</h4> <p>残り: ${player.handCount}枚</p>`;
            playersContainer.appendChild(playerDiv);
        });

        fieldContainer.innerHTML = '';
        state.field.forEach(card => fieldContainer.appendChild(createCardElement(card)));

        myHandContainer.innerHTML = '';
        state.myHand.forEach(card => {
            const cardEl = createCardElement(card);
            cardEl.addEventListener('click', () => toggleCardSelection(cardEl, card));
            myHandContainer.appendChild(cardEl);
        });

        myNameSpan.textContent = me.name;
        myRoleSpan.textContent = me.role || '平民';
    }
    
    // ... (createCardElement, toggleCardSelection, displaySystemMessage are unchanged)
    function createCardElement(card) {
        const el = document.createElement('div');
        el.className = `card ${card.suit}`;
        const suitSymbol = {s: '♠', h: '♥', d: '♦', c: '♣', joker: 'J'}[card.suit];
        el.innerHTML = `<span class="rank">${card.rank.toUpperCase()}</span><span class="suit">${suitSymbol}</span>`;
        if (card.rank === 'joker') el.innerHTML = `<span class="rank">JOKER</span>`;
        return el;
    }
    function toggleCardSelection(cardEl, card) {
        if (cardEl.classList.contains('selected')) {
            cardEl.classList.remove('selected');
            selectedCards = selectedCards.filter(c => !(c.rank === card.rank && c.suit === card.suit));
        } else {
            cardEl.classList.add('selected');
            selectedCards.push(card);
        }
    }
    function displaySystemMessage(msg) { /* ... */ }


    // Event Listeners
    createRoomBtn.addEventListener('click', () => {
        const name = createNicknameInput.value.trim();
        if (!name) {
            errorMessage.textContent = 'ニックネームを入力してください。';
            return;
        }
        connectWebSocket({
            type: 'createRoom',
            name: name,
            gameLimit: gameLimitSelect.value
        });
    });

    joinRoomBtn.addEventListener('click', () => {
        const name = joinNicknameInput.value.trim();
        const code = roomCodeInput.value.trim().toUpperCase();
        if (!name || !code) {
            errorMessage.textContent = 'ニックネームと部屋コードを入力してください。';
            return;
        }
        connectWebSocket({
            type: 'joinRoom',
            name: name,
            roomCode: code
        });
    });

    startGameBtn.addEventListener('click', () => ws.send(JSON.stringify({ type: 'startGame' })));
    playBtn.addEventListener('click', () => {
        if (selectedCards.length > 0) ws.send(JSON.stringify({ type: 'playCards', cards: selectedCards }));
    });
    passBtn.addEventListener('click', () => ws.send(JSON.stringify({ type: 'pass' })));
    copyCodeBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(roomCode).then(() => alert('部屋コードをコピーしました！'));
    });
});