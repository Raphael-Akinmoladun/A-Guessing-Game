const rooms = {};

const handleGameEvents = (io, socket) => {
    socket.on('joinRoom', ({ roomId, username }) => {
        let room = rooms[roomId];

        if (room && room.state === 'playing') {
            socket.emit('errorMsg', 'Game is already in progress. You cannot join right now.');
            return;
        }

        socket.join(roomId);
        socket.roomId = roomId;

        if (!room) {
            // Create new room
            room = {
                id: roomId,
                players: {},
                gameMaster: socket.id,
                state: 'waiting', // waiting, playing
                question: null,
                answer: null,
                timer: null,
                timeLeft: 60
            };
            rooms[roomId] = room;
        }

        // Add player
        room.players[socket.id] = {
            id: socket.id,
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
        if (!roomId || !rooms[roomId]) return;

        const room = rooms[roomId];
        const player = room.players[socket.id];
        if (player) {
            io.to(roomId).emit('chatMessage', {
                sender: 'System',
                text: `${player.username} has left the game.`
            });
            delete room.players[socket.id];
        }

        const playerIds = Object.keys(room.players);
        if (playerIds.length === 0) {
            // Delete room if empty
            if (room.timer) clearInterval(room.timer);
            delete rooms[roomId];
        } else {
            // If game master left, assign new game master
            if (room.gameMaster === socket.id) {
                room.gameMaster = playerIds[0];
                io.to(roomId).emit('chatMessage', {
                    sender: 'System',
                    text: `${room.players[room.gameMaster].username} is the new Game Master.`
                });
            }
            
            // If game is playing and only 1 or less players left (excluding GM, or maybe GM is the only one left)
            // we should probably end the game. For simplicity, we just let it be or end it.
            if (room.state === 'playing' && playerIds.length < 2) {
                endGame(io, roomId, null, "Not enough players to continue.");
            }

            io.to(roomId).emit('roomUpdate', {
                players: Object.values(room.players),
                gameMaster: room.gameMaster,
                state: room.state
            });
        }
    });

    socket.on('startGame', ({ question, answer }) => {
        const roomId = socket.roomId;
        const room = rooms[roomId];

        if (!room || room.gameMaster !== socket.id) return;
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
        const room = rooms[roomId];

        if (!room) return;
        
        const player = room.players[socket.id];
        if (!player) return;

        // If it's a regular chat (game not playing, or user is GM)
        if (room.state !== 'playing' || room.gameMaster === socket.id) {
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