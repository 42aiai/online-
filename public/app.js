// Reasoning/Thinking Mode: ON
// This client-side code has been completely revised to fix critical errors.
// The flawed room-joining logic is replaced with a simplified, robust 'join' request.
// State management is improved by clearing local selections on every server update,
// preventing inconsistencies. Defensive checks are added to handle edge cases gracefully.

document.addEventListener('DOMContentLoaded', () => {
    const lobby = document.getElementById('lobby');
    const gameBoard = document.getElementById('game-board');
    const nicknameInput = document.getElementById('nickname');
    const gameLimitSelect = document.getElementById('game-limit');
    const joinGameBtn = document.getElementById('join-game-btn');
    const lobbyPlayers = document.getElementById('lobby-players');
    
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

    function connectWebSocket(name, gameLimit) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            console.log('Already connected.');
            return;
        }
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        ws = new WebSocket(`${protocol}//${host}`);

        ws.onopen = () => {
            console.log('Connected to server');
            ws.send(JSON.stringify({ type: 'join', name, gameLimit }));
            joinGameBtn.disabled = true;
            joinGameBtn.textContent = '参加中...';
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleServerMessage(data);
        };

        ws.onclose = () => {
            console.log('Disconnected from server');
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
                updateGameState(data);
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
                }, 5000);
                break;
        }
    }
    
    function updateLobby(state) {
        lobby.classList.remove('hidden');
        gameBoard.classList.add('hidden');

        let playersHTML = '<h3>待機中のプレイヤー:</h3><ul>';
        state.players.forEach(p => {
            playersHTML += `<li>${p.name} ${p.id === state.gameSettings?.hostId ? ' (ホスト)' : ''}</li>`;
        });
        playersHTML += '</ul>';
        lobbyPlayers.innerHTML = playersHTML;

        // Disable options if already a host
        if (state.players.length > 0) {
            gameLimitSelect.disabled = true;
        } else {
            gameLimitSelect.disabled = false;
        }
    }


    function updateGameState(state) {
        if (state.gameState === 'waiting') {
            updateLobby(state);
            return;
        }
        
        lobby.classList.add('hidden');
        gameBoard.classList.remove('hidden');

        selectedCards = []; // Always clear selection on state update
        myId = state.myId;
        const me = state.players.find(p => p.id === myId);

        if (!me) {
            console.warn("My player data not found in game state. Likely disconnected.");
            return; // Defensive check
        }

        const isMyTurn = state.turnIndex !== -1 && state.players[state.turnIndex]?.id === myId;
        
        playBtn.disabled = !isMyTurn;
        passBtn.disabled = !isMyTurn;
        
        playersContainer.innerHTML = '';
        state.players.forEach(player => {
            // Do not display myself in the top bar. My info is at the bottom.
            if (player.id === myId) return;

            const playerDiv = document.createElement('div');
            playerDiv.className = `player-info ${player.isTurn ? 'is-turn' : ''}`;
            playerDiv.innerHTML = `
                <h4>${player.name} ${player.id === state.gameSettings.hostId ? '<small>(Host)</small>' : ''}</h4>
                <p>残り: ${player.handCount}枚</p>
                <p>階級: ${player.role || '平民'}</p>
                <p>順位: ${player.rank ? `${player.rank}位` : '-'}</p>
            `;
            playersContainer.appendChild(playerDiv);
        });

        fieldContainer.innerHTML = '';
        state.field.forEach(card => fieldContainer.appendChild(createCardElement(card)));

        myHandContainer.innerHTML = '';
        me.hand.forEach(card => {
            const cardEl = createCardElement(card);
            cardEl.addEventListener('click', () => toggleCardSelection(cardEl, card));
            myHandContainer.appendChild(cardEl);
        });
        
        myNameSpan.textContent = me.name;
        myRoleSpan.textContent = me.role || '平民';
    }
    
    function createCardElement(card) {
        const el = document.createElement('div');
        el.className = `card ${card.suit}`;
        el.dataset.rank = card.rank;
        el.dataset.suit = card.suit;
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

    joinGameBtn.addEventListener('click', () => {
        const name = nicknameInput.value.trim();
        const gameLimit = gameLimitSelect.value;
        if (!name) {
            alert('ニックネームを入力してください。');
            return;
        }
        connectWebSocket(name, gameLimit);
    });
    
    playBtn.addEventListener('click', () => {
        if (selectedCards.length === 0) return;
        ws.send(JSON.stringify({ type: 'playCards', cards: selectedCards }));
    });

    passBtn.addEventListener('click', () => {
        ws.send(JSON.stringify({ type: 'pass' }));
    });
    
    continueBtn.addEventListener('click', () => {
        ws.send(JSON.stringify({ type: 'continueGame', decision: true }));
        modalOverlay.classList.add('hidden');
    });

    endBtn.addEventListener('click', () => {
        ws.send(JSON.stringify({ type: 'continueGame', decision: false }));
        modalOverlay.classList.add('hidden');
    });
});