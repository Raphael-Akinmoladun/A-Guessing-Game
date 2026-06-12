const { handleGameEvents } = require('./gameEvents');

module.exports = (io) => {
    io.on('connection', (socket) => {
        console.log(`User connected: ${socket.id}`);
        handleGameEvents(io, socket);
    });
};
