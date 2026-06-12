const socket = io();

// DOM Elements
const playerCountEl = document.getElementById("playerCount");
const gameStatusEl = document.getElementById("gameStatus");
const gmControlsEl = document.getElementById("gmControls");
const questionInput = document.getElementById("questionInput");
const answerInput = document.getElementById("answerInput");
const startGameBtn = document.getElementById("startGameBtn");
const gmErrorEl = document.getElementById("gmError");
const activeQuestionArea = document.getElementById("activeQuestionArea");
const currentQuestionEl = document.getElementById("currentQuestion");
const attemptsLeftEl = document.getElementById("attemptsLeft");
const timerEl = document.getElementById("timer");
const chatMessagesEl = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const scoreboardEl = document.getElementById("scoreboard");

// Game State
let isGameMaster = false;
let gameState = "waiting";
let currentUsername = null;
let playerId = sessionStorage.getItem("playerId");
if (!playerId) {
  playerId = Math.random().toString(36).substring(2, 15);
  sessionStorage.setItem("playerId", playerId);
}

// Join Room - now wrapped in ensureUsername
ensureUsername((username) => {
  currentUsername = username;
  socket.emit("joinRoom", { roomId: ROOM_ID, username, playerId });
});

// Room Update
socket.on("roomUpdate", ({ players, gameMaster, state }) => {
  gameState = state;
  playerCountEl.textContent = `Players: ${players.length}`;

  // Check if I am Game Master
  isGameMaster = playerId === gameMaster;

  // Update Scoreboard
  scoreboardEl.innerHTML = "";
  players.forEach((p) => {
    const pEl = document.createElement("div");
    pEl.className = `p-2 rounded ${p.id === gameMaster ? "bg-purple-100 border border-purple-300" : "bg-gray-100"}`;
    pEl.innerHTML = `
            <div class="flex justify-between items-center">
                <span class="font-semibold ${p.id === playerId ? "text-blue-600" : "text-gray-800"}">
                    ${p.username} ${p.id === gameMaster ? "👑" : ""}
                </span>
                <span class="font-bold text-green-600">${p.score} pts</span>
            </div>
            ${state === "playing" && p.id !== gameMaster ? `<div class="text-xs text-gray-500 mt-1">Attempts: ${p.attempts}</div>` : ""}
        `;
    scoreboardEl.appendChild(pEl);
  });

  // Update UI based on Role and State
  if (state === "waiting") {
    gameStatusEl.textContent = "Waiting to start...";
    gameStatusEl.className = "text-sm font-semibold text-yellow-200";
    activeQuestionArea.classList.add("hidden");

    if (isGameMaster) {
      gmControlsEl.classList.remove("hidden");
      gmErrorEl.classList.add("hidden");
      startGameBtn.disabled = players.length <= 2;
      if (players.length <= 2) {
        gmErrorEl.textContent =
          "Need at least 3 players to start (You + 2 players).";
        gmErrorEl.classList.remove("hidden");
      }
    } else {
      gmControlsEl.classList.add("hidden");
    }
  }
});

// Start Game Event (Triggered by GM)
startGameBtn.addEventListener("click", () => {
  const question = questionInput.value.trim();
  const answer = answerInput.value.trim();

  if (!question || !answer) {
    gmErrorEl.textContent = "Please enter both question and answer.";
    gmErrorEl.classList.remove("hidden");
    return;
  }

  socket.emit("startGame", { question, answer });
  questionInput.value = "";
  answerInput.value = "";
});

// Game Started
socket.on("gameStarted", ({ question, timeLeft }) => {
  gameStatusEl.textContent = "Game in Progress";
  gameStatusEl.className = "text-sm font-semibold text-green-200";

  gmControlsEl.classList.add("hidden");
  activeQuestionArea.classList.remove("hidden");

  currentQuestionEl.textContent = question;
  timerEl.textContent = timeLeft;
  attemptsLeftEl.textContent = "3";

  addMessage("System", "The game has started!", "system");
});

// Timer Update
socket.on("timerUpdate", (timeLeft) => {
  timerEl.textContent = timeLeft;
});

// Error Message
socket.on("errorMsg", (msg) => {
  addMessage("System", msg, "error");
  if (msg.includes("Game is already in progress. You cannot join right now.")) {
    alert(msg);
    window.location.href = "/";
  }
});

// You Won specific event
socket.on("youWon", (msg) => {
  addMessage("System", msg, "success");
});

// Game Ended
socket.on("gameEnded", ({ reason, answer, winnerId }) => {
  activeQuestionArea.classList.add("hidden");

  addMessage("System", `Game Ended: ${reason}`, "system");
  addMessage("System", `The correct answer was: ${answer}`, "system");
});

// Chat Messages
socket.on("chatMessage", ({ sender, text }) => {
  addMessage(sender, text, sender === "System" ? "system" : "user");
});

// Send Guess/Message
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  socket.emit("sendGuess", text);
  chatInput.value = "";

  if (gameState === "playing" && !isGameMaster) {
    // Update local attempts temporarily before server confirms
    let current = parseInt(attemptsLeftEl.textContent);
    if (current > 0) {
      attemptsLeftEl.textContent = current - 1;
    }
  }
});

// Helper: Add message to chat
function addMessage(sender, text, type) {
  const msgEl = document.createElement("div");
  msgEl.className = "p-2 rounded ";

  if (type === "system") {
    msgEl.className += "bg-gray-200 text-gray-800 text-sm italic text-center";
    msgEl.textContent = text;
  } else if (type === "error") {
    msgEl.className += "bg-red-100 text-red-800 text-sm border border-red-200";
    msgEl.textContent = text;
  } else if (type === "success") {
    msgEl.className +=
      "bg-green-100 text-green-800 text-lg font-bold border border-green-200 text-center py-4";
    msgEl.textContent = text;
  } else {
    msgEl.className += "bg-white border shadow-sm";
    const isMe = sender === currentUsername;
    msgEl.innerHTML = `
            <span class="font-bold ${isMe ? "text-blue-600" : "text-gray-700"}">${sender}:</span> 
            <span class="text-gray-800">${text}</span>
        `;
  }

  chatMessagesEl.appendChild(msgEl);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}
