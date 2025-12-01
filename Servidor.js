const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

app.use(express.static(__dirname + "/public"));

// -----------------------------
// Estruturas de dados
// -----------------------------

let rooms = {};           // { roomId: [socket1, socket2] }
let players = {};         // players[socketId] = { roomId, ships, hits, attacked, ready, wantsRematch }

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

      // Fora do tabuleiro
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
  for (const roomId in rooms) {
    if (rooms[roomId].length === 1) {
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
      return;
    }
  }

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
}

// -----------------------------
// SOCKET IO
// -----------------------------

io.on("connection", (socket) => {
  console.log("Cliente conectado:", socket.id);

  autoJoin(socket);

  // -----------------------------
  // Recebe navios
  // -----------------------------
  socket.on("placeShips", (ships) => {
    const p = players[socket.id];

    if (!validateShips(ships)) {
      socket.emit("invalidShips");
      return;
    }

    p.ships = ships;
    p.ready = true;

    const roomId = p.roomId;
    const [p1, p2] = rooms[roomId];

    if (p1 && p2 && players[p1].ready && players[p2].ready) {
      io.to(roomId).emit("readyToPlay");
      io.to(roomId).emit("turnUpdate", { turn: p1 });
    }
  });

  // -----------------------------
  // Ataque
  // -----------------------------
  socket.on("attack", ({ x, y }) => {
    const p = players[socket.id];
    const roomId = p.roomId;
    const enemyId = getOpponent(roomId, socket.id);
    const enemy = players[enemyId];

    const key = `${x},${y}`;

    // Já atacou esse ponto?
    if (p.attacked.has(key)) {
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
      io.to(roomId).emit("gameOverOptions", { winner: socket.id });
      return;
    }

    // Turno alternado
    io.to(roomId).emit("turnUpdate", { turn: enemyId });
  });

  // -----------------------------
  // Revanche
  // -----------------------------
  socket.on("rematchRequest", () => {
    const p = players[socket.id];
    const roomId = p.roomId;

    p.wantsRematch = true;

    // Notifica adversário
    socket.to(roomId).emit("opponentRematchRequest");

    const [p1, p2] = rooms[roomId];

    if (
      p1 && p2 &&
      players[p1].wantsRematch &&
      players[p2].wantsRematch
    ) {
      // Reset
      for (const pid of rooms[roomId]) {
        players[pid].ships = [];
        players[pid].hits = new Set();
        players[pid].attacked = new Set();
        players[pid].ready = false;
        players[pid].wantsRematch = false;
      }

      io.to(roomId).emit("rematchStart");
    }
  });

  // -----------------------------
  // Nova partida (reset total)
  // -----------------------------
  socket.on("newMatchRequest", () => {
    const roomId = players[socket.id].roomId;

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
  });

  // -----------------------------
  // Desconexão
  // -----------------------------
  socket.on("disconnect", () => {
    const p = players[socket.id];
    if (!p) return;

    const roomId = p.roomId;

    console.log("Cliente saiu:", socket.id);
    io.to(roomId).emit("playerLeft", socket.id);

    rooms[roomId] = rooms[roomId].filter(id => id !== socket.id);
    delete players[socket.id];

    if (rooms[roomId].length === 0) delete rooms[roomId];
  });
});

// -----------------------------
// Inicia servidor
// -----------------------------
http.listen(8080, () => {
  console.log("Servidor rodando em http://localhost:8080");
});
