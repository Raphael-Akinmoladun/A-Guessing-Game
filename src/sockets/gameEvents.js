const rooms = {};

const handleGameEvents = (io, socket) => {
    socket.on('joinRoom', ({ roomId, username, playerId }) => {
        if (!playerId) playerId = socket.id;

        let room = rooms[roomId];

        socket.join(roomId);
        socket.roomId = roomId;
        socket.playerId = playerId;

        if (room && room.players[playerId]) {
            // Reconnecting player
            const player = room.players[playerId];
            if (player.disconnectTimer) {
                clearTimeout(player.disconnectTimer);
                player.disconnectTimer = null;
            }
            player.socketId = socket.id;
            
            io.to(roomId).emit('roomUpdate', {
                players: Object.values(room.players),
                gameMaster: room.gameMaster,
                state: room.state
            });
            return;
        }

        if (room && room.state === 'playing') {
            socket.emit('errorMsg', 'Game is already in progress. You cannot join right now.');
            return;
        }

        if (!room) {
            // Create new room
            room = {
                id: roomId,
                players: {},
                gameMaster: playerId,
                state: 'waiting', // waiting, playing
                question: null,
                answer: null,
                timer: null,
                timeLeft: 60
            };
            rooms[roomId] = room;
        }

        // Add player
        room.players[playerId] = {
            id: playerId,
            socketId: socket.id,
            username,
            score: 0,
            attempts: 3
        };

        io.to(roomId).emit('roomUpdate', {
            players: Object.values(room.players),
            gameMaster: room.gameMaster,
            state: room.state
        });

        io.to(roomId).emit('chatMessage', {
            sender: 'System',
            text: `${username} has joined the game.`
        });
    });

    socket.on('disconnect', () => {
        const roomId = socket.roomId;
        const playerId = socket.playerId;
        if (!roomId || !rooms[roomId] || !playerId) return;

        const room = rooms[roomId];
        const player = room.players[playerId];
        if (player && player.socketId === socket.id) {
            // Give the player a few seconds to reconnect before removing them
            player.disconnectTimer = setTimeout(() => {
                io.to(roomId).emit('chatMessage', {
                    sender: 'System',
                    text: `${player.username} has left the game.`
                });
                delete room.players[playerId];

                const playerIds = Object.keys(room.players);
                if (playerIds.length === 0) {
                    // Delete room if empty
                    if (room.timer) clearInterval(room.timer);
                    delete rooms[roomId];
                } else {
                    // If game master left, assign new game master
                    if (room.gameMaster === playerId) {
                        room.gameMaster = playerIds[0];
                        io.to(roomId).emit('chatMessage', {
                            sender: 'System',
                            text: `${room.players[room.gameMaster].username} is the new Game Master.`
                        });
                    }
                    
                    // If game is playing and only 1 or less players left (excluding GM, or maybe GM is the only one left)
                    if (room.state === 'playing' && playerIds.length < 2) {
                        endGame(io, roomId, null, "Not enough players to continue.");
                    }

                    io.to(roomId).emit('roomUpdate', {
                        players: Object.values(room.players),
                        gameMaster: room.gameMaster,
                        state: room.state
                    });
                }
            }, 3000); // 3 seconds grace period
        }
    });

    socket.on('startGame', ({ question, answer }) => {
        const roomId = socket.roomId;
        const playerId = socket.playerId;
        const room = rooms[roomId];

        if (!room || room.gameMaster !== playerId) return;
        if (Object.keys(room.players).length <= 2) {
            socket.emit('errorMsg', 'Need more than two players to start the game.');
            return;
        }

        room.state = 'playing';
        room.question = question;
        room.answer = answer.toLowerCase().trim();
        room.timeLeft = 60;

        // Reset attempts
        Object.values(room.players).forEach(p => p.attempts = 3);

        io.to(roomId).emit('gameStarted', {
            question: room.question,
            timeLeft: room.timeLeft
        });

        io.to(roomId).emit('roomUpdate', {
            players: Object.values(room.players),
            gameMaster: room.gameMaster,
            state: room.state
        });

        // Start timer
        if (room.timer) clearInterval(room.timer);
        room.timer = setInterval(() => {
            room.timeLeft--;
            io.to(roomId).emit('timerUpdate', room.timeLeft);

            if (room.timeLeft <= 0) {
                // Time expires
                endGame(io, roomId, null, 'Time is up!');
            }
        }, 1000);
    });

    socket.on('sendGuess', (guess) => {
        const roomId = socket.roomId;
        const playerId = socket.playerId;
        const room = rooms[roomId];

        if (!room) return;
        
        const player = room.players[playerId];
        if (!player) return;

        // If it's a regular chat (game not playing, or user is GM)
        if (room.state !== 'playing' || room.gameMaster === playerId) {
            io.to(roomId).emit('chatMessage', {
                sender: player.username,
                text: guess
            });
            return;
        }

        // If game is playing and user has no attempts left
        if (player.attempts <= 0) {
            socket.emit('errorMsg', 'You have no attempts left.');
            return;
        }

        player.attempts--;
        
        // Check if guess is correct
        if (guess.toLowerCase().trim() === room.answer) {
            // Player won
            player.score += 10;
            io.to(roomId).emit('chatMessage', {
                sender: player.username,
                text: `Guessed the correct answer!`
            });
            socket.emit('youWon', 'You have won!');
            endGame(io, roomId, player.id, `${player.username} got the correct answer!`);
        } else {
            // Incorrect guess
            socket.emit('errorMsg', `Incorrect guess! Attempts left: ${player.attempts}`);
            io.to(roomId).emit('chatMessage', {
                sender: player.username,
                text: guess
            });
            
            // Check if all players (except GM) are out of attempts
            const allPlayersOut = Object.values(room.players).every(p => p.id === room.gameMaster || p.attempts <= 0);
            if (allPlayersOut) {
                endGame(io, roomId, null, 'All players are out of attempts!');
            }
        }
    });
};

function endGame(io, roomId, winnerId, reason) {
    const room = rooms[roomId];
    if (!room) return;

    if (room.timer) {
        clearInterval(room.timer);
        room.timer = null;
    }

    room.state = 'waiting';

    // Broadcast end game event
    io.to(roomId).emit('gameEnded', {
        reason,
        answer: room.answer,
        winnerId
    });

    // Assign new game master
    const playerIds = Object.keys(room.players);
    if (playerIds.length > 0) {
        const currentIndex = playerIds.indexOf(room.gameMaster);
        let nextIndex = (currentIndex + 1) % playerIds.length;
        room.gameMaster = playerIds[nextIndex];
        
        io.to(roomId).emit('chatMessage', {
            sender: 'System',
            text: `The game has ended. ${room.players[room.gameMaster].username} is the new Game Master.`
        });
    }

    io.to(roomId).emit('roomUpdate', {
        players: Object.values(room.players),
        gameMaster: room.gameMaster,
        state: room.state
    });
}

module.exports = { handleGameEvents };