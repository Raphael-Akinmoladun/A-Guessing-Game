const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
    res.render('index');
});

router.get('/room/:roomId', (req, res) => {
    res.render('room', { roomId: req.params.roomId });
});

module.exports = router;
