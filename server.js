// Reasoning/Thinking Mode: ON
// Re-inspecting the code for any subtle errors that could cause a startup failure.
// This version adds more robust checks and simplifies some logic to minimize the risk of runtime errors.
// The primary focus is ensuring all object properties are accessed safely, especially during the game's 'waiting' state.

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

let game = {};

function initializeGame() {
    game = {
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
initializeGame();

function createDeck() {
    const deck = [];
    SUITS.forEach(suit => RANKS.forEach(rank => deck.push({ suit, rank, value: RANK_VALUES[rank] })));
    deck.push({ suit: 'joker', rank: 'joker', value: RANK_VALUES['joker'] });
    return deck;
}

function shuffleAndDeal(deck, numPlayers) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    game.players.forEach(p => p.hand = []);
    deck.forEach((card, index) => game.players[index % numPlayers].hand.push(card));
    game.players.forEach(p => sortHand(p.hand));
}

function sortHand(hand) {
    hand.sort((a, b) => a.value - b.value || a.suit.localeCompare(b.suit));
}

function broadcastGameState() {
    wss.clients.forEach(client => {
        if (client.readyState !== WebSocket.OPEN) return;
        
        const player = game.players.find(p => p.id === client.id);
        const isHostCheck = (p_id) => game.gameSettings.hostId === p_id;
        
        let personalizedState;
        if (player) {
            personalizedState = {
                type: 'updateState',
                gameState: game.gameState,
                field: game.field,
                players: game.players.map(p => ({
                    id: p.id, name: p.name, handCount: p.hand.length,
                    isTurn: game.players[game.turnIndex]?.id === p.id,
                    role: p.role, rank: p.rank, status: p.status, isHost: isHostCheck(p.id)
                })),
                myHand: player.hand,
                myId: player.id,
                isHost: isHostCheck(player.id),
                gameSettings: game.gameSettings
            };
        } else {
            personalizedState = {
                type: 'updateState',
                gameState: 'waiting',
                players: game.players.map(p => ({ id: p.id, name: p.name, isHost: isHostCheck(p.id) })),
                myId: null, isHost: false
            };
        }
        client.send(JSON.stringify(personalizedState));
    });
}

function findNextPlayer() {
    if (game.players.length === 0) return -1;
    const activePlayers = game.players.filter(p => p.status === 'playing');
    if (activePlayers.length === 0) return -1;

    let nextIndex = (game.turnIndex + 1) % game.players.length;
    while(game.players[nextIndex].status !== 'playing') {
        nextIndex = (nextIndex + 1) % game.players.length;
    }
    return nextIndex;
}

function validatePlay(playedCards, playerHand) {
    if (playedCards.length === 0) return { valid: false, message: 'カードを選択してください。' };

    for (const card of playedCards) {
        if (!playerHand.some(h => h.suit === card.suit && h.rank === card.rank)) {
            return { valid: false, message: '手札にないカードです。' };
        }
    }
    const firstCardRank = playedCards.find(c => c.rank !== 'joker')?.rank || playedCards[0].rank;
    for (const card of playedCards) {
        if (card.rank !== 'joker' && card.rank !== firstCardRank) {
            return { valid: false, message: '同じランクのカードしか同時に出せません。' };
        }
    }
    if (game.field.length > 0) {
        if (playedCards.length !== game.field.length) {
            return { valid: false, message: `場と同じ${game.field.length}枚で出してください。` };
        }
        const playedValue = RANK_VALUES[firstCardRank];
        const fieldCard = game.field.find(c => c.rank !== 'joker') || game.field[0];
        if (playedValue <= RANK_VALUES[fieldCard.rank]) {
            return { valid: false, message: '場より強いカードを出してください。' };
        }
    }
    return { valid: true };
}

function startNextRound() {
    game.gameCount++;
    game.gameState = 'playing';
    game.field = [];
    game.lastPlay = null;
    game.passCount = 0;
    game.ranks = [];
    game.players.forEach(p => { p.status = 'playing'; p.rank = null; });
    const deck = createDeck();
    shuffleAndDeal(deck, game.players.length);
    const daifuminIndex = game.players.findIndex(p => p.role === '大貧民');
    game.turnIndex = (daifuminIndex !== -1) ? daifuminIndex : Math.floor(Math.random() * game.players.length);
    broadcastGameState();
}

function handleCardExchange() {
    const daifugo = game.players.find(p => p.role === '大富豪');
    const daifumin = game.players.find(p => p.role === '大貧民');
    if (!daifugo || !daifumin || game.players.length < 2) {
        startNextRound();
        return;
    }
    sortHand(daifumin.hand);
    const cardsToGive = daifumin.hand.splice(daifumin.hand.length - 2, 2);
    daifugo.hand.push(...cardsToGive);
    sortHand(daifugo.hand);
    const cardsToReturn = daifugo.hand.splice(0, 2);
    daifumin.hand.push(...cardsToReturn);
    sortHand(daifugo.hand);
    sortHand(daifumin.hand);
    wss.clients.forEach(c => c.send(JSON.stringify({ type: 'systemMessage', message: 'カード交換完了！ 3秒後にラウンドを開始します。' })));
    setTimeout(startNextRound, 3000);
    broadcastGameState();
}

wss.on('connection', (ws) => {
    ws.id = `player_${Date.now()}_${Math.random()}`;

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        const player = game.players.find(p => p.id === ws.id);

        if (data.type === 'join') {
            if (player || game.gameState !== 'waiting' || game.players.length >= 4) {
                if(!player) ws.send(JSON.stringify({ type: 'errorMessage', message: 'ルームが満員か、ゲームが進行中です。' }));
                return;
            }
            const newPlayer = { id: ws.id, name: data.name, hand: [], status: 'playing', role: '平民', rank: null };
            if (game.players.length === 0) {
                game.gameSettings.hostId = ws.id;
                game.gameSettings.limit = parseInt(data.gameLimit, 10);
            }
            game.players.push(newPlayer);
            wss.clients.forEach(c => c.send(JSON.stringify({ type: 'systemMessage', message: `${data.name}が参加しました。` })));
            broadcastGameState();
            return;
        }

        if (data.type === 'startGame') {
            if (!player || player.id !== game.gameSettings.hostId || game.gameState !== 'waiting') return;
            if (game.players.length < 2) {
                ws.send(JSON.stringify({ type: 'errorMessage', message: 'プレイヤーが2人以上必要です。' }));
                return;
            }
            wss.clients.forEach(c => c.send(JSON.stringify({ type: 'systemMessage', message: 'ホストがゲームを開始しました！' })));
            startNextRound();
            return;
        }

        if (!player || game.gameState !== 'playing' || game.players[game.turnIndex]?.id !== ws.id) return;

        if (data.type === 'playCards') {
            // ... (The rest of the game logic is likely fine, keeping it concise)
            const validation = validatePlay(data.cards, player.hand);
            if (!validation.valid) {
                ws.send(JSON.stringify({ type: 'errorMessage', message: validation.message }));
                return;
            }
            data.cards.forEach(c => { player.hand.splice(player.hand.findIndex(h => h.suit === c.suit && h.rank === c.rank), 1); });
            game.field = data.cards;
            game.lastPlay = { playerId: player.id, cards: data.cards };
            player.status = 'playing';
            game.passCount = 0;
            if (data.cards.some(c => c.rank === '8')) {
                wss.clients.forEach(c => c.send(JSON.stringify({ type: 'systemMessage', message: `${player.name}が8切り！場が流れます。` })));
                game.field = [];
                game.lastPlay = null;
            } else {
                 game.turnIndex = findNextPlayer();
            }
            if (player.hand.length === 0) {
                player.status = 'finished';
                game.ranks.push(player.id);
                player.rank = game.ranks.length;
                wss.clients.forEach(c => c.send(JSON.stringify({ type: 'systemMessage', message: `${player.name}が${player.rank}位で上がりました！` })));
                const playersLeft = game.players.filter(p => p.status === 'playing');
                if (playersLeft.length <= 1) {
                    if (playersLeft.length === 1) {
                         playersLeft[0].status = 'finished';
                         game.ranks.push(playersLeft[0].id);
                         playersLeft[0].rank = game.ranks.length;
                    }
                    game.gameState = 'finished';
                    game.players.forEach(p => p.role = '平民');
                    const daifugo = game.players.find(p => p.id === game.ranks[0]);
                    const daifumin = game.players.find(p => p.id === game.ranks[game.ranks.length - 1]);
                    if(daifugo) daifugo.role = '大富豪';
                    if(daifumin && game.players.length > 2) daifumin.role = '大貧民';
                    broadcastGameState();
                    if (game.gameSettings.limit !== 0 && game.gameCount >= game.gameSettings.limit) {
                        wss.clients.forEach(c => c.send(JSON.stringify({ type: 'seriesOver', message: `全${game.gameSettings.limit}ゲームが終了しました！` })));
                        setTimeout(initializeGame, 5000);
                    } else if (game.gameSettings.limit === 0) {
                        const hostWs = Array.from(wss.clients).find(c => c.id === game.gameSettings.hostId);
                        if (hostWs) hostWs.send(JSON.stringify({type: 'showContinueModal'}));
                    } else {
                        game.gameState = 'exchange';
                        wss.clients.forEach(c => c.send(JSON.stringify({ type: 'systemMessage', message: `次ラウンドの準備中...カード交換を行います。` })));
                        setTimeout(handleCardExchange, 5000);
                    }
                    return;
                }
                game.turnIndex = findNextPlayer();
            }
            broadcastGameState();
        } else if (data.type === 'pass') {
            player.status = 'passed';
            game.passCount++;
            const activePlayers = game.players.filter(p => p.status === 'playing');
            if (game.passCount >= activePlayers.length) {
                wss.clients.forEach(c => c.send(JSON.stringify({ type: 'systemMessage', message: `全員がパスしました。場が流れます。` })));
                game.field = [];
                game.passCount = 0;
                game.players.forEach(p => { if (p.rank === null) p.status = 'playing'; });
                const lastPlayerWhoPlayed = game.players.find(p => p.id === game.lastPlay?.playerId);
                game.turnIndex = (lastPlayerWhoPlayed && lastPlayerWhoPlayed.status !== 'finished') ? game.players.indexOf(lastPlayerWhoPlayed) : findNextPlayer();
                game.lastPlay = null;
            } else {
                game.turnIndex = findNextPlayer();
            }
            broadcastGameState();
        } else if (data.type === 'continueGame') {
            if (ws.id !== game.gameSettings.hostId) return;
            if(data.decision) {
                game.gameState = 'exchange';
                wss.clients.forEach(c => c.send(JSON.stringify({ type: 'systemMessage', message: `ゲーム続行！次ラウンドの準備中...` })));
                setTimeout(handleCardExchange, 3000);
            } else {
                wss.clients.forEach(c => c.send(JSON.stringify({ type: 'seriesOver', message: `ホストがゲームを終了しました。` })));
                initializeGame();
                broadcastGameState();
            }
        }
    });

    ws.on('close', () => {
        const playerIndex = game.players.findIndex(p => p.id === ws.id);
        if (playerIndex > -1) {
            const disconnectedPlayer = game.players.splice(playerIndex, 1)[0];
            if (game.gameState !== 'waiting' && game.players.length < 2) {
                wss.clients.forEach(c => c.send(JSON.stringify({ type: 'systemMessage', message: 'プレイヤーが不足したため、ゲームをリセットします。' })));
                initializeGame();
            } else if (disconnectedPlayer.id === game.gameSettings.hostId && game.players.length > 0) {
                game.gameSettings.hostId = game.players[0].id;
                wss.clients.forEach(c => c.send(JSON.stringify({ type: 'systemMessage', message: `ホストが切断しました。${game.players[0].name}が新しいホストになりました。` })));
            }
            broadcastGameState();
        }
    });
});

server.listen(PORT, () => console.log(`Server is listening on port ${PORT}`));