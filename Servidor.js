const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

const PORT = process.env.PORT || 8080;   // 🌎 Render binding

app.use(express.static(__dirname + "/public"));

// -----------------------------
// Estruturas de dados
// -----------------------------

let rooms = {};
let players = {};

// -----------------------------
// Funções auxiliares
// -----------------------------

function getOpponent(roomId, socketId) {
  const playersInRoom = rooms[roomId];
  if (!playersInRoom) return null;
  return playersInRoom.find(id => id !== socketId);
}

function cellBelongsToShip(ships, x, y) {
  for (const ship of ships) {
    for (let i = 0; i < ship.size; i++) {
      const tx = ship.orientation === "horizontal" ? ship.x + i : ship.x;
      const ty = ship.orientation === "vertical" ? ship.y + i : ship.y;

      if (tx === x && ty === y) return true;
    }
  }
  return false;
}

function allShipsSunk(player) {
  const totalParts = player.ships.reduce((sum, s) => sum + s.size, 0);
  return player.hits.size >= totalParts;
}

function validateShips(ships) {
  const allowed = { 5: 1, 4: 1, 3: 1 };
  const used = { 5: 0, 4: 0, 3: 0 };

  const occupied = new Set();

  for (const ship of ships) {
    if (!allowed[ship.size]) return false;

    used[ship.size]++;
    if (used[ship.size] > allowed[ship.size]) return false;

    for (let i = 0; i < ship.size; i++) {
      let x = ship.orientation === "horizontal" ? ship.x + i : ship.x;
      let y = ship.orientation === "vertical" ? ship.y + i : ship.y;

      if (x < 0 || x > 9 || y < 0 || y > 9) return false;

      const key = `${x},${y}`;
      if (occupied.has(key)) return false;

      occupied.add(key);
    }
  }

  return true;
}

// -----------------------------
// Pareamento automático
// -----------------------------

function autoJoin(socket) {
  console.log(`🟦 [AUTOJOIN] Tentando parear ${socket.id}`);

  for (const roomId in rooms) {
    if (rooms[roomId].length === 1) {
      console.log(`➡️ Sala encontrada (${roomId}). Conectando ${socket.id}`);

      rooms[roomId].push(socket.id);

      players[socket.id] = {
        roomId,
        ships: [],
        hits: new Set(),
        attacked: new Set(),
        ready: false,
        wantsRematch: false,
      };

      socket.join(roomId);
      socket.emit("joinedRoom", roomId);
      io.to(roomId).emit("startGame");

      console.log(`✅ Jogador pareado em ${roomId}`);
      return;
    }
  }

  // Criar sala nova
  const newRoom = "room-" + socket.id;
  rooms[newRoom] = [socket.id];

  players[socket.id] = {
    roomId: newRoom,
    ships: [],
    hits: new Set(),
    attacked: new Set(),
    ready: false,
    wantsRematch: false,
  };

  socket.join(newRoom);
  socket.emit("joinedRoom", newRoom);

  console.log(`🆕 Criada nova sala ${newRoom} para ${socket.id}`);
}

// -----------------------------
// SOCKET IO
// -----------------------------

io.on("connection", (socket) => {
  console.log(`🟢 Cliente conectado: ${socket.id}`);

  autoJoin(socket);

  // -----------------------------
  // Recebimento de navios
  // -----------------------------
  socket.on("placeShips", (ships) => {
    console.log(`🚢 Recebido navios do jogador ${socket.id}`, ships);

    const p = players[socket.id];

    if (!validateShips(ships)) {
      console.log(`❌ Navios inválidos do jogador ${socket.id}`);
      socket.emit("invalidShips");
      return;
    }

    p.ships = ships;
    p.ready = true;

    const roomId = p.roomId;
    const [p1, p2] = rooms[roomId];

    if (p1 && p2 && players[p1].ready && players[p2].ready) {
      console.log(`🎮 Partida iniciando na sala ${roomId}`);
      io.to(roomId).emit("readyToPlay");

      console.log(`▶️ Turno inicial: ${p1}`);
      io.to(roomId).emit("turnUpdate", { turn: p1 });
    }
  });

  // -----------------------------
  // Ataque
  // -----------------------------
  socket.on("attack", ({ x, y }) => {
    console.log(`🎯 Jogador ${socket.id} atacou (${x}, ${y})`);

    const p = players[socket.id];
    const roomId = p.roomId;
    const enemyId = getOpponent(roomId, socket.id);
    const enemy = players[enemyId];

    const key = `${x},${y}`;

    if (p.attacked.has(key)) {
      console.log("⚠️ Ataque repetido ignorado.");
      socket.emit("attackRejected", { reason: "duplicate" });
      return;
    }

    p.attacked.add(key);

    const hit = cellBelongsToShip(enemy.ships, x, y);
    if (hit) enemy.hits.add(key);

    io.to(roomId).emit("attackResult", {
      attacker: socket.id,
      x,
      y,
      result: hit ? "hit" : "miss",
    });

    // Verifica vitória
    if (allShipsSunk(enemy)) {
      console.log(`🏆 Jogador ${socket.id} venceu!`);
      io.to(roomId).emit("gameOverOptions", { winner: socket.id });
      return;
    }

    console.log(`🔄 Alternando turno → ${enemyId}`);
    io.to(roomId).emit("turnUpdate", { turn: enemyId });
  });

  // -----------------------------
  // Revanche
  // -----------------------------
  socket.on("rematchRequest", () => {
    const p = players[socket.id];
    const roomId = p.roomId;

    console.log(`🔁 ${socket.id} solicitou revanche na sala ${roomId}`);

    p.wantsRematch = true;

    socket.to(roomId).emit("opponentRematchRequest");

    const [p1, p2] = rooms[roomId];

    if (p1 && p2 && players[p1].wantsRematch && players[p2].wantsRematch) {
      console.log(`🔥 Ambos aceitaram a revanche na sala ${roomId}`);

      // Reset
      for (const pid of rooms[roomId]) {
        players[pid].ships = [];
        players[pid].hits = new Set();
        players[pid].attacked = new Set();
        players[pid].ready = false;
        players[pid].wantsRematch = false;
      }

      io.to(roomId).emit("rematchStart");

      // 🔥 FIX IMPORTANTE — reiniciar turno
      console.log(`▶️ Turno iniciado após revanche: ${p1}`);
      io.to(roomId).emit("turnUpdate", { turn: p1 });
    }
  });

  // -----------------------------
  // Nova partida
  // -----------------------------
  socket.on("newMatchRequest", () => {
    const roomId = players[socket.id].roomId;

    console.log(`🆕 Nova partida solicitada na sala ${roomId}`);

    io.to(roomId).emit("forceReset");

    const roomPlayers = rooms[roomId];
    for (const pid of roomPlayers) {
      players[pid].ships = [];
      players[pid].hits = new Set();
      players[pid].attacked = new Set();
      players[pid].ready = false;
      players[pid].wantsRematch = false;
    }

    delete rooms[roomId];

    console.log(`🗑️ Sala ${roomId} removida`);
  });

  // -----------------------------
  // Desconexão
  // -----------------------------
  socket.on("disconnect", () => {
    const p = players[socket.id];
    if (!p) return;

    const roomId = p.roomId;

    console.log(`🔴 Cliente desconectou: ${socket.id}`);

    io.to(roomId).emit("playerLeft", socket.id);

    rooms[roomId] = rooms[roomId].filter(id => id !== socket.id);
    delete players[socket.id];

    if (rooms[roomId].length === 0) {
      delete rooms[roomId];
      console.log(`🗑️ Sala ${roomId} esvaziada e removida`);
    }
  });
});

// -----------------------------
// Inicia servidor
// -----------------------------
http.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
