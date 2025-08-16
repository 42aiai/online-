// Reasoning/Thinking Mode: ON
// This is the definitive, stable client-side script.
// It establishes a persistent WebSocket connection and handles all incoming messages from the server.
// UI rendering is now more robust, correctly updating the lobby and game board based on the authoritative state sent by the server.
// This version is designed to be resilient and provide a clear user experience.

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const lobby = document.getElementById('lobby');
    const gameBoard = document.getElementById('game-board');
    const nicknameInput = document.getElementById('nickname');
    const gameLimitSelect = document.getElementById('game-limit');
    const joinGameBtn = document.getElementById('join-game-btn');
    const playerList = document.getElementById('player-list');
    
    const playersContainer = document.getElementById('players-container');
    const fieldContainer = document.getElementById('field');
    const myHandContainer = document.getElementById('my-hand');
    const myNameSpan = document.getElementById('my-name');
    const myRoleSpan = document.getElementById('my-role');
    const playBtn = document.getElementById('play-btn');
    const passBtn = document.getElementById('pass-btn');
    const systemMessage = document.getElementById('system-message');
    
    const modalOverlay = document.getElementById('modal-overlay');
    const continueBtn = document.getElementById('continue-btn');
    const endBtn = document.getElementById('end-btn');

    let ws;
    let myId = '';
    let selectedCards = [];

    function connectWebSocket() {
        const name = nicknameInput.value.trim();
        const gameLimit = gameLimitSelect.value;
        if (!name) {
            alert('ニックネームを入力してください。');
            return;
        }
        
        if (ws && ws.readyState === WebSocket.OPEN) return;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        ws = new WebSocket(`${protocol}//${host}`);

        ws.onopen = () => {
            console.log('Connected to server');
            ws.send(JSON.stringify({ type: 'join', name, gameLimit }));
            joinGameBtn.disabled = true;
            joinGameBtn.textContent = '参加中...';
        };

        ws.onmessage = (event) => handleServerMessage(JSON.parse(event.data));

        ws.onclose = () => {
            displaySystemMessage('サーバーとの接続が切れました。ページをリロードしてください。', true);
            playBtn.disabled = true;
            passBtn.disabled = true;
            joinGameBtn.disabled = false;
            joinGameBtn.textContent = 'ゲームに参加';
        };

        ws.onerror = (error) => {
            console.error('WebSocket Error:', error);
            displaySystemMessage('接続エラーが発生しました。', true);
        };
    }

    function handleServerMessage(data) {
        switch (data.type) {
            case 'updateState':
                updateUI(data);
                break;
            case 'errorMessage':
                alert(data.message);
                joinGameBtn.disabled = false;
                joinGameBtn.textContent = 'ゲームに参加';
                break;
            case 'systemMessage':
                displaySystemMessage(data.message);
                break;
            case 'showContinueModal':
                modalOverlay.classList.remove('hidden');
                break;
            case 'seriesOver':
                displaySystemMessage(data.message, true);
                setTimeout(() => {
                    gameBoard.classList.add('hidden');
                    lobby.classList.remove('hidden');
                    joinGameBtn.disabled = false;
                    joinGameBtn.textContent = 'ゲームに参加';
                }, 5000);
                break;
        }
    }
    
    function updateUI(state) {
        if (state.gameState === 'waiting') {
            lobby.classList.remove('hidden');
            gameBoard.classList.add('hidden');
            playerList.innerHTML = state.players.map(p => `<li>${p.name} ${p.isHost ? ' (ホスト)' : ''}</li>`).join('');
            if (state.players.length > 0) gameLimitSelect.disabled = true;
        } else {
            lobby.classList.add('hidden');
            gameBoard.classList.remove('hidden');
        }
        
        myId = state.myId;
        const me = state.players?.find(p => p.id === myId);

        if (!me && state.gameState !== 'waiting') return;

        selectedCards = []; // Always clear selection on state update
        
        const isMyTurn = me?.isTurn ?? false;
        playBtn.disabled = !isMyTurn;
        passBtn.disabled = !isMyTurn;
        
        playersContainer.innerHTML = '';
        state.players?.forEach(player => {
            if (player.id === myId) return; // Don't show myself in the top bar
            const playerDiv = document.createElement('div');
            playerDiv.className = `player-info ${player.isTurn ? 'is-turn' : ''}`;
            playerDiv.innerHTML = `
                <h4>${player.name}</h4>
                <p>残り: ${player.handCount}枚</p>
                <p>階級: ${player.role || '平民'}</p>
                <p>順位: ${player.rank ? `${player.rank}位` : '-'}</p>
            `;
            playersContainer.appendChild(playerDiv);
        });

        fieldContainer.innerHTML = '';
        state.field?.forEach(card => fieldContainer.appendChild(createCardElement(card)));

        myHandContainer.innerHTML = '';
        state.myHand?.forEach(card => {
            const cardEl = createCardElement(card);
            cardEl.addEventListener('click', () => toggleCardSelection(cardEl, card));
            myHandContainer.appendChild(cardEl);
        });
        
        if(me) {
            myNameSpan.textContent = me.name;
            myRoleSpan.textContent = me.role || '平民';
        }
    }
    
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

    function displaySystemMessage(msg, isImportant = false) {
        systemMessage.textContent = msg;
        systemMessage.style.display = 'block';
        systemMessage.style.backgroundColor = isImportant ? '#f44336' : 'rgba(0,0,0,0.7)';
        setTimeout(() => { systemMessage.style.display = 'none'; }, 4000);
    }
    
    joinGameBtn.addEventListener('click', connectWebSocket);
    
    playBtn.addEventListener('click', () => {
        if (selectedCards.length > 0) ws.send(JSON.stringify({ type: 'playCards', cards: selectedCards }));
    });

    passBtn.addEventListener('click', () => ws.send(JSON.stringify({ type: 'pass' })));
    
    continueBtn.addEventListener('click', () => {
        ws.send(JSON.stringify({ type: 'continueGame', decision: true }));
        modalOverlay.classList.add('hidden');
    });

    endBtn.addEventListener('click', () => {
        ws.send(JSON.stringify({ type: 'continueGame', decision: false }));
        modalOverlay.classList.add('hidden');
    });
});