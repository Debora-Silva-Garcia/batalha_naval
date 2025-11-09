// Conecta ao servidor
const socket = io();

// Elementos da interface
const playerIdElem = document.getElementById("playerId");
const roomIdElem = document.getElementById("roomId");
const statusElem = document.getElementById("status");

// Quando o cliente se conecta
socket.on("connect", () => {
  console.log("Conectado ao servidor:", socket.id);
  playerIdElem.textContent = socket.id;
  statusElem.textContent = "Conectado! Aguardando pareamento...";
  socket.emit("joinGame"); // pede para entrar em uma sala
});

// Quando o servidor informa a sala do jogador
socket.on("joinedRoom", (roomId) => {
  console.log("Entrou na sala:", roomId);
  roomIdElem.textContent = roomId;
  statusElem.textContent = "Esperando outro jogador...";
});

// Quando o jogo é iniciado (2 jogadores na sala)
socket.on("startGame", (data) => {
  console.log("Jogo iniciado na sala:", data.roomId);
  statusElem.textContent = "✅ Jogo iniciado! Boa sorte!";
});

// Quando o outro jogador sai (sala é encerrada)
socket.on("playerLeft", (playerId) => {
  console.log(`Jogador ${playerId} saiu da sala.`);
  statusElem.textContent = `⚠️ O jogador ${playerId} saiu. A sala será encerrada.`;
  roomIdElem.textContent = "Sala desconectada";
});
