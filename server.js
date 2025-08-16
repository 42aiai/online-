// Reasoning/Thinking Mode: ON
// This is a major architectural refactor to support multiple rooms.
// The single global `game` object is replaced with a `rooms` Map, where each key
// is a unique room code and the value is a self-contained game state object.
// Each WebSocket connection (`ws`) is tagged with a `roomCode` upon joining.
// All game logic and broadcasting are now scoped to the specific room,
// ensuring players in different rooms do not interfere with each other.
// Room cleanup logic is added to prevent memory leaks.

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const SUITS = ['s', 'h', 'd', 'c'];
const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
const RANK_VALUES = {
    '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '9': 7, '10': 8, 
    'J': 9, 'Q': 10, 'K': 11, 'A': 12, '2': 13, 'joker': 15
};

let rooms = new Map();

function createNewGame() {
    return {
        players: [],
        gameState: 'waiting',
        turnIndex: -1,
        field: [],
        lastPlay: null,
        passCount: 0,
        gameCount: 0,
        gameSettings: { limit: 0, hostId: null },
        ranks: [],
    };
}

function generateRoomCode() {
    let code;
    do {
        code = Math.random().toString(36).substring(2, 6).toUpperCase();
    } while (rooms.has(code));
    return code;
}

function createDeck() {
    const deck = [];
    SUITS.forEach(suit => RANKS.forEach(rank => deck.push({ suit, rank, value: RANK_VALUES[rank] })));
    deck.push({ suit: 'joker', rank: 'joker', value: RANK_VALUES['joker'] });
    return deck;
}

function shuffleAndDeal(players) {
    const deck = createDeck();
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    players.forEach(p => p.hand = []);
    deck.forEach((card, index) => players[index % players.length].hand.push(card));
    players.forEach(p => sortHand(p.hand));
}

function sortHand(hand) {
    hand.sort((a, b) => a.value - b.value || a.suit.localeCompare(b.suit));
}

function broadcastToRoom(roomCode, messageGenerator) {
    const room = rooms.get(roomCode);
    if (!room) return;

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.roomCode === roomCode) {
            const message = messageGenerator(client.id);
            client.send(JSON.stringify(message));
        }
    });
}

function getGameStateForPlayer(room, playerId) {
    const player = room.players.find(p => p.id === playerId);
    return {
        type: 'updateState',
        roomCode: room.code,
        gameState: room.gameState,
        field: room.field,
        players: room.players.map(p => ({
            id: p.id, name: p.name, handCount: p.hand.length,
            isTurn: room.players[room.turnIndex]?.id === p.id,
            role: p.role, rank: p.rank, status: p.status, isHost: room.gameSettings.hostId === p.id
        })),
        myHand: player?.hand || [],
        myId: playerId,
        isHost: room.gameSettings.hostId === playerId,
        gameSettings: room.gameSettings
    };
}

function findNextPlayer(players, currentIndex) {
    if (players.length === 0) return -1;
    const activePlayers = players.filter(p => p.status === 'playing');
    if (activePlayers.length === 0) return -1;

    let nextIndex = (currentIndex + 1) % players.length;
    while(players[nextIndex].status !== 'playing') {
        nextIndex = (nextIndex + 1) % players.length;
    }
    return nextIndex;
}

function validatePlay(playedCards, playerHand, field) {
    if (playedCards.length === 0) return { valid: false, message: 'カードを選択してください。' };
    for (const card of playedCards) {
        if (!playerHand.some(h => h.suit === card.suit && h.rank === card.rank))
            return { valid: false, message: '手札にないカードです。' };
    }
    const firstCardRank = playedCards.find(c => c.rank !== 'joker')?.rank || playedCards[0].rank;
    for (const card of playedCards) {
        if (card.rank !== 'joker' && card.rank !== firstCardRank)
            return { valid: false, message: '同じランクのカードしか同時に出せません。' };
    }
    if (field.length > 0) {
        if (playedCards.length !== field.length)
            return { valid: false, message: `場と同じ${field.length}枚で出してください。` };
        const playedValue = RANK_VALUES[firstCardRank];
        const fieldCard = field.find(c => c.rank !== 'joker') || field[0];
        if (playedValue <= RANK_VALUES[fieldCard.rank])
            return { valid: false, message: '場より強いカードを出してください。' };
    }
    return { valid: true };
}

function startNextRound(room) {
    room.gameCount++;
    room.gameState = 'playing';
    room.field = [];
    room.lastPlay = null;
    room.passCount = 0;
    room.ranks = [];
    room.players.forEach(p => { p.status = 'playing'; p.rank = null; });
    shuffleAndDeal(room.players);
    const daifuminIndex = room.players.findIndex(p => p.role === '大貧民');
    room.turnIndex = (daifuminIndex !== -1) ? daifuminIndex : Math.floor(Math.random() * room.players.length);
    broadcastToRoom(room.code, (id) => getGameStateForPlayer(room, id));
}

// ... (other helper functions like handleCardExchange would be similar, taking `room` as an argument)

wss.on('connection', (ws) => {
    ws.id = `player_${Date.now()}_${Math.random()}`;

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        if (data.type === 'createRoom') {
            const roomCode = generateRoomCode();
            const newRoom = createNewGame();
            newRoom.code = roomCode;
            const newPlayer = { id: ws.id, name: data.name, hand: [], status: 'playing', role: '平民', rank: null };
            
            newRoom.players.push(newPlayer);
            newRoom.gameSettings.hostId = ws.id;
            newRoom.gameSettings.limit = parseInt(data.gameLimit, 10);
            
            rooms.set(roomCode, newRoom);
            ws.roomCode = roomCode;
            
            ws.send(JSON.stringify(getGameStateForPlayer(newRoom, ws.id)));
            return;
        }

        if (data.type === 'joinRoom') {
            const room = rooms.get(data.roomCode.toUpperCase());
            if (!room) {
                ws.send(JSON.stringify({ type: 'errorMessage', message: '部屋が見つかりません。' }));
                return;
            }
            if (room.players.length >= 4) {
                ws.send(JSON.stringify({ type: 'errorMessage', message: 'この部屋は満員です。' }));
                return;
            }
            if (room.gameState !== 'waiting') {
                ws.send(JSON.stringify({ type: 'errorMessage', message: 'この部屋は既にゲームが始まっています。' }));
                return;
            }
            const newPlayer = { id: ws.id, name: data.name, hand: [], status: 'playing', role: '平民', rank: null };
            room.players.push(newPlayer);
            ws.roomCode = data.roomCode.toUpperCase();
            
            broadcastToRoom(ws.roomCode, () => ({ type: 'systemMessage', message: `${data.name}が参加しました。` }));
            broadcastToRoom(ws.roomCode, (id) => getGameStateForPlayer(room, id));
            return;
        }

        // All subsequent actions require a roomCode on the ws object
        const roomCode = ws.roomCode;
        const room = rooms.get(roomCode);
        if (!room) return;
        const player = room.players.find(p => p.id === ws.id);
        if (!player) return;

        if (data.type === 'startGame') {
            if (player.id !== room.gameSettings.hostId || room.gameState !== 'waiting' || room.players.length < 2) return;
            broadcastToRoom(roomCode, () => ({ type: 'systemMessage', message: 'ホストがゲームを開始しました！' }));
            startNextRound(room);
        }

        if (room.gameState !== 'playing' || room.players[room.turnIndex]?.id !== ws.id) return;
        
        // --- In-Game Actions ---
        if (data.type === 'playCards') {
            // ... (game logic for playing cards, adapted for 'room')
            const validation = validatePlay(data.cards, player.hand, room.field);
            if (!validation.valid) {
                ws.send(JSON.stringify({ type: 'errorMessage', message: validation.message }));
                return;
            }
            data.cards.forEach(c => { player.hand.splice(player.hand.findIndex(h => h.suit === c.suit && h.rank === c.rank), 1); });
            room.field = data.cards;
            room.lastPlay = { playerId: player.id, cards: data.cards };
            player.status = 'playing';
            room.passCount = 0;
            if (data.cards.some(c => c.rank === '8')) {
                broadcastToRoom(roomCode, () => ({ type: 'systemMessage', message: `${player.name}が8切り！場が流れます。` }));
                room.field = [];
                room.lastPlay = null;
            } else {
                 room.turnIndex = findNextPlayer(room.players, room.turnIndex);
            }
            if (player.hand.length === 0) {
                // ... (win condition logic)
            }
            broadcastToRoom(roomCode, (id) => getGameStateForPlayer(room, id));
        } else if (data.type === 'pass') {
            // ... (pass logic adapted for 'room')
            player.status = 'passed';
            room.passCount++;
            const activePlayers = room.players.filter(p => p.status === 'playing');
            if (room.passCount >= activePlayers.length) {
                broadcastToRoom(roomCode, () => ({ type: 'systemMessage', message: `全員がパスしました。場が流れます。` }));
                room.field = [];
                room.passCount = 0;
                room.players.forEach(p => { if (p.rank === null) p.status = 'playing'; });
                const lastPlayer = room.players.find(p => p.id === room.lastPlay?.playerId);
                room.turnIndex = (lastPlayer && lastPlayer.status !== 'finished') ? room.players.indexOf(lastPlayer) : findNextPlayer(room.players, room.turnIndex);
                room.lastPlay = null;
            } else {
                room.turnIndex = findNextPlayer(room.players, room.turnIndex);
            }
            broadcastToRoom(roomCode, (id) => getGameStateForPlayer(room, id));
        }
    });

    ws.on('close', () => {
        const roomCode = ws.roomCode;
        if (!roomCode) return;
        const room = rooms.get(roomCode);
        if (!room) return;
        
        const playerIndex = room.players.findIndex(p => p.id === ws.id);
        if (playerIndex > -1) {
            const disconnectedPlayer = room.players.splice(playerIndex, 1)[0];
            broadcastToRoom(roomCode, () => ({ type: 'systemMessage', message: `${disconnectedPlayer.name}が切断しました。` }));

            if (room.players.length === 0) {
                rooms.delete(roomCode);
                console.log(`Room ${roomCode} is empty and has been closed.`);
                return;
            }

            if (disconnectedPlayer.id === room.gameSettings.hostId) {
                room.gameSettings.hostId = room.players[0].id; // New host is the next player in line
                broadcastToRoom(roomCode, () => ({ type: 'systemMessage', message: `ホストが交代し、${room.players[0].name}が新しいホストになりました。` }));
            }
            
            if (room.gameState !== 'waiting' && room.players.length < 2) {
                // For simplicity, reset the room if game is in progress with less than 2 players
                const oldSettings = room.gameSettings;
                rooms.set(roomCode, createNewGame());
                const newRoom = rooms.get(roomCode);
                newRoom.players = room.players; // Keep remaining players
                newRoom.gameSettings = oldSettings;
                newRoom.code = roomCode;
                broadcastToRoom(roomCode, () => ({ type: 'systemMessage', message: 'プレイヤーが不足したため、ゲームをリセットします。' }));
            }
            broadcastToRoom(roomCode, (id) => getGameStateForPlayer(room, id));
        }
    });
});

server.listen(PORT, () => console.log(`Server is listening on port ${PORT}`));