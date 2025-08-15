// Reasoning/Thinking Mode: ON
// This revised server code simplifies the room entry logic.
// It now uses a single 'join' message type. The server intelligently determines
// if a player is the host (the first to join) and applies their game settings.
// This eliminates race conditions and logic errors present in the previous version.

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

let game = {
    players: [],
    gameState: 'waiting', // waiting, playing, exchange, finished
    turnIndex: -1,
    field: [],
    lastPlay: null,
    passCount: 0,
    gameCount: 0,
    gameSettings: {
        limit: 0,
        hostId: null
    },
    ranks: [],
    lastWinnerId: null
};

function createDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            deck.push({ suit, rank, value: RANK_VALUES[rank] });
        }
    }
    deck.push({ suit: 'joker', rank: 'joker', value: RANK_VALUES['joker'] });
    return deck;
}

function shuffleAndDeal(deck, numPlayers) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    
    game.players.forEach(p => p.hand = []);
    let playerIndex = 0;
    deck.forEach(card => {
        game.players[playerIndex].hand.push(card);
        playerIndex = (playerIndex + 1) % numPlayers;
    });

    game.players.forEach(p => sortHand(p.hand));
}

function sortHand(hand) {
    hand.sort((a, b) => a.value - b.value || a.suit.localeCompare(b.suit));
}

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

function broadcastGameState() {
    wss.clients.forEach(client => {
        if (client.readyState !== WebSocket.OPEN) return;
        
        const player = game.players.find(p => p.id === client.id);
        if (!player && game.gameState === 'waiting') {
            // Send a generic state to spectators or new joiners in lobby
             client.send(JSON.stringify({
                type: 'updateState',
                gameState: 'waiting',
                players: game.players.map(p => ({ name: p.name, id: p.id })),
                myId: null,
                isHost: false
            }));
            return;
        }
        if(!player) return;


        const personalizedState = {
            type: 'updateState',
            ...game,
            players: game.players.map(p => ({
                id: p.id,
                name: p.name,
                handCount: p.hand.length,
                isTurn: game.players[game.turnIndex]?.id === p.id,
                role: p.role,
                rank: p.rank,
                status: p.status
            })),
            myHand: player.hand,
            myId: player.id,
            isHost: game.gameSettings.hostId === player.id
        };
        client.send(JSON.stringify(personalizedState));
    });
}

function resetGame(keepPlayers = false) {
    const playersToKeep = keepPlayers ? game.players.map(p => ({...p, hand: [], rank: null, status: 'playing', role: '平民'})) : [];
    
    game = {
        players: playersToKeep,
        gameState: 'waiting',
        turnIndex: -1,
        field: [],
        lastPlay: null,
        passCount: 0,
        gameCount: 0,
        gameSettings: {
            limit: 0,
            hostId: keepPlayers ? game.gameSettings.hostId : null
        },
        ranks: [],
        lastWinnerId: null
    };
}


function findNextPlayer() {
    if (game.players.length === 0) return -1;
    let nextIndex = (game.turnIndex + 1) % game.players.length;
    let checkedCount = 0;
    while(game.players[nextIndex].status !== 'playing' && checkedCount < game.players.length) {
        nextIndex = (nextIndex + 1) % game.players.length;
        checkedCount++;
    }
    return (checkedCount >= game.players.length) ? -1 : nextIndex;
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
        const fieldValue = RANK_VALUES[fieldCard.rank];
        
        if (playedValue <= fieldValue) {
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
    
    game.players.forEach(p => {
        p.status = 'playing';
        p.rank = null;
    });

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

    game.gameState = 'playing';
    broadcast({ type: 'systemMessage', message: 'カード交換完了！ 3秒後にラウンドを開始します。' });
    setTimeout(startNextRound, 3000);
    broadcastGameState();
}


wss.on('connection', (ws) => {
    ws.id = `player_${Date.now()}_${Math.random()}`;

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        const player = game.players.find(p => p.id === ws.id);

        if (data.type === 'join') {
            if (player) return; // Already joined
            if (game.gameState !== 'waiting' || game.players.length >= 4) {
                ws.send(JSON.stringify({ type: 'errorMessage', message: 'ルームが満員か、ゲームが進行中です。' }));
                return;
            }

            const newPlayer = {
                id: ws.id, ws, name: data.name, hand: [], status: 'playing', role: '平民', rank: null,
            };
            
            // First player to join becomes the host and sets the rules
            if (game.players.length === 0) {
                resetGame(); // Ensure clean state
                game.gameSettings.hostId = ws.id;
                game.gameSettings.limit = parseInt(data.gameLimit, 10);
            }

            game.players.push(newPlayer);
            broadcastGameState();

            if (game.players.length >= 2 && game.players.length <= 4) { // Let's auto-start at 2 players.
                broadcast({ type: 'systemMessage', message: `${game.players.length}人集まりました。ゲームを開始します。` });
                setTimeout(startNextRound, 2000);
            }
            return;
        }


        if (!player || game.gameState !== 'playing') return;
        if (game.players[game.turnIndex]?.id !== ws.id) return;

        if (data.type === 'playCards') {
            const validation = validatePlay(data.cards, player.hand);
            if (!validation.valid) {
                ws.send(JSON.stringify({ type: 'errorMessage', message: validation.message }));
                return;
            }

            data.cards.forEach(playedCard => {
                const cardIndex = player.hand.findIndex(c => c.suit === playedCard.suit && c.rank === playedCard.rank);
                if (cardIndex > -1) player.hand.splice(cardIndex, 1);
            });
            
            game.field = data.cards;
            game.lastPlay = { playerId: player.id, cards: data.cards };
            player.status = 'playing'; // reset pass status
            game.passCount = 0;

            const is8giri = data.cards.some(c => c.rank === '8');
            if (is8giri) {
                broadcast({ type: 'systemMessage', message: `${player.name}が8切り！場が流れます。` });
                game.field = [];
                game.lastPlay = null;
                // Turn stays with the player who played 8, no need to call findNextPlayer
            } else {
                 game.turnIndex = findNextPlayer();
            }

            if (player.hand.length === 0) {
                player.status = 'finished';
                game.ranks.push(player.id);
                player.rank = game.ranks.length;
                broadcast({ type: 'systemMessage', message: `${player.name}が${player.rank}位で上がりました！` });

                const playersLeft = game.players.filter(p => p.status === 'playing');
                if (playersLeft.length <= 1) {
                    if (playersLeft.length === 1) {
                         const lastPlayer = playersLeft[0];
                         lastPlayer.status = 'finished';
                         game.ranks.push(lastPlayer.id);
                         lastPlayer.rank = game.ranks.length;
                    }

                    game.gameState = 'finished';
                    const daifugo = game.players.find(p => p.id === game.ranks[0]);
                    const daifumin = game.players.find(p => p.id === game.ranks[game.ranks.length - 1]);
                    
                    game.players.forEach(p => p.role = '平民');
                    if(daifugo) daifugo.role = '大富豪';
                    if(daifumin && game.players.length > 2) daifumin.role = '大貧民';
                    
                    broadcastGameState();
                    
                    if (game.gameSettings.limit !== 0 && game.gameCount >= game.gameSettings.limit) {
                        broadcast({ type: 'seriesOver', message: `全${game.gameSettings.limit}ゲームが終了しました！` });
                        setTimeout(() => resetGame(false), 5000);
                    } else if (game.gameSettings.limit === 0) {
                        const host = game.players.find(p => p.id === game.gameSettings.hostId)?.ws;
                        if (host) host.send(JSON.stringify({type: 'showContinueModal'}));
                    } else {
                        game.gameState = 'exchange';
                        broadcast({ type: 'systemMessage', message: `次ラウンドの準備中...カード交換を行います。` });
                        setTimeout(handleCardExchange, 5000);
                    }
                    return;
                }
                 // After finishing, the turn must pass to the next available player
                game.turnIndex = findNextPlayer();
            }
            
            broadcastGameState();
        }

        if (data.type === 'pass') {
            player.status = 'passed';
            game.passCount++;
            
            const activePlayers = game.players.filter(p => p.status === 'playing');
            if (game.passCount >= activePlayers.length) {
                broadcast({ type: 'systemMessage', message: `全員がパスしました。場が流れます。` });
                game.field = [];
                game.passCount = 0;
                game.players.forEach(p => { if (p.rank === null) p.status = 'playing'; });
                
                const lastPlayerWhoPlayed = game.players.find(p => p.id === game.lastPlay?.playerId);
                if (lastPlayerWhoPlayed && lastPlayerWhoPlayed.status !== 'finished') {
                    game.turnIndex = game.players.indexOf(lastPlayerWhoPlayed);
                } else {
                    game.turnIndex = findNextPlayer();
                }
                game.lastPlay = null;

            } else {
                game.turnIndex = findNextPlayer();
            }
            broadcastGameState();
        }

         if (data.type === 'continueGame') {
            if (ws.id !== game.gameSettings.hostId) return;
            if(data.decision) {
                game.gameState = 'exchange';
                broadcast({ type: 'systemMessage', message: `ゲーム続行！次ラウンドの準備中...` });
                setTimeout(handleCardExchange, 3000);
            } else {
                broadcast({ type: 'seriesOver', message: `ホストがゲームを終了しました。` });
                resetGame(false);
                broadcastGameState();
            }
        }
    });

    ws.on('close', () => {
        const playerIndex = game.players.findIndex(p => p.id === ws.id);
        if (playerIndex > -1) {
            console.log(`${game.players[playerIndex].name} disconnected.`);
            const disconnectedPlayer = game.players.splice(playerIndex, 1)[0];
            
            // If the host disconnects, assign a new host or reset
            if (disconnectedPlayer.id === game.gameSettings.hostId) {
                if (game.players.length > 0) {
                    game.gameSettings.hostId = game.players[0].id;
                     broadcast({ type: 'systemMessage', message: 'ホストが切断しました。新しいホストが割り当てられました。' });
                }
            }

            if (game.players.length < 2 && game.gameState !== 'waiting') {
                broadcast({ type: 'systemMessage', message: 'プレイヤーが不足したため、ゲームをリセットします。' });
                resetGame(false);
            }
            broadcastGameState();
        }
    });
});

server.listen(PORT, () => console.log(`Server is listening on port ${PORT}`));