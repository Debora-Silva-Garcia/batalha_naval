const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const rooms = {};

/* --------------------------------------------------------
   FUNÇÕES AUXILIARES
-------------------------------------------------------- */
function getRoomByPlayer(playerId) {
  for (const roomId in rooms) {
    if (rooms[roomId].players.includes(playerId)) return roomId;
  }
  return null;
}

function makeRoomId() {
  return "room-" + Math.random().toString(36).substring(2, 9);
}

function assignToAvailableRoom(socket) {
  let roomJoined = null;

  for (const roomId in rooms) {
    const room = rooms[roomId];
    if (room.players.length === 1 && !room.gameStarted) {
      room.players.push(socket.id);
      roomJoined = roomId;
      break;
    }
  }

  if (!roomJoined) {
    let newRoom;
    do {
      newRoom = makeRoomId();
    } while (rooms[newRoom]);

    rooms[newRoom] = {
      players: [socket.id],
      ships: {},
      hitsAgainst: {},
      turn: null,
      lock: false,
      gameStarted: false
    };

    roomJoined = newRoom;
  }

  socket.join(roomJoined);
  socket.emit("joinedRoom", roomJoined);

  const room = rooms[roomJoined];

  if (room.players.length === 2) {
    room.turn = room.players[0];
    io.to(roomJoined).emit("startGame");
    io.to(roomJoined).emit("turnUpdate", { turn: room.turn });
  }
}

/* --------------------------------------------------------
   SOCKET CONNECTION
-------------------------------------------------------- */
io.on("connection", (socket) => {

  assignToAvailableRoom(socket);

  /* --------------------------------------------------------
     RECEBENDO NAVIOS
  -------------------------------------------------------- */
  socket.on("placeShips", (ships) => {
    const roomId = getRoomByPlayer(socket.id);
    const room = rooms[roomId];
    room.ships[socket.id] = ships;

    if (Object.keys(room.ships).length === 2) {
      room.gameStarted = true;
      io.to(roomId).emit("readyToPlay");
      io.to(roomId).emit("turnUpdate", { turn: room.turn });
    }
  });

  /* --------------------------------------------------------
     ATAQUE
  -------------------------------------------------------- */
  /* --------------------------------------------------------
   ATAQUE + DETECÇÃO DE VITÓRIA
-------------------------------------------------------- */
  socket.on("attack", ({ x, y }) => {
    const roomId = getRoomByPlayer(socket.id);
    const room = rooms[roomId];

    if (!room.gameStarted) {
      socket.emit("message", "Partida não iniciada.");
      return;
    }

    if (socket.id !== room.turn) {
      socket.emit("message", "⛔ Não é seu turno!");
      return;
    }

    const opponentId = room.players.find(id => id !== socket.id);

    if (!room.hitsAgainst[opponentId]) {
      room.hitsAgainst[opponentId] = new Set();
    }

    let hit = false;

    for (const ship of room.ships[opponentId]) {
      for (let i = 0; i < ship.size; i++) {
        const sx = ship.x + (ship.orientation === "horizontal" ? i : 0);
        const sy = ship.y + (ship.orientation === "vertical" ? i : 0);

        if (sx === x && sy === y) {
          hit = true;
          room.hitsAgainst[opponentId].add(`${sx},${sy}`);
        }
      }
    }

    // Envia resultado
    io.to(roomId).emit("attackResult", {
      attacker: socket.id,
      x, y,
      result: hit ? "hit" : "miss"
    });

    // Alternar turno
    room.turn = opponentId;
    io.to(roomId).emit("turnUpdate", { turn: room.turn });

    // =============================
    //      DETECÇÃO DE VITÓRIA
    // =============================
    const totalShipCells =
      room.ships[opponentId].reduce((sum, s) => sum + s.size, 0);

    const currentHits = room.hitsAgainst[opponentId].size;

    if (currentHits >= totalShipCells) {
      io.to(roomId).emit("gameOverOptions", {
        winner: socket.id
      });

      room.gameStarted = false;
    }
  });

  /* --------------------------------------------------------
     REVANCHE
  -------------------------------------------------------- */
  socket.on("rematchRequest", () => {
    const roomId = getRoomByPlayer(socket.id);
    const room = rooms[roomId];

    if (!room.rematchVotes) room.rematchVotes = new Set();
    room.rematchVotes.add(socket.id);

    if (room.rematchVotes.size === 2) {
      room.ships = {};
      room.hitsAgainst = {};
      room.turn = room.players[0];
      room.gameStarted = false;

      delete room.rematchVotes;

      io.to(roomId).emit("rematchStart");
    }
  });

  /* --------------------------------------------------------
     NOVA PARTIDA
  -------------------------------------------------------- */
  socket.on("newMatchRequest", () => {
    const roomId = getRoomByPlayer(socket.id);

    if (roomId) {
      const room = rooms[roomId];

      socket.leave(roomId);

      room.players
        .filter(id => id !== socket.id)
        .forEach(id => io.to(id).emit("playerLeft", socket.id));

      delete rooms[roomId];
    }

    socket.emit("forceReset");
    assignToAvailableRoom(socket);
  });

  /* --------------------------------------------------------
     DESCONECTOU
  -------------------------------------------------------- */
  socket.on("disconnect", () => {
    const roomId = getRoomByPlayer(socket.id);
    if (!roomId) return;

    const room = rooms[roomId];

    room.players
      .filter(id => id !== socket.id)
      .forEach(id => io.to(id).emit("playerLeft", socket.id));

    delete rooms[roomId];
  });
});

server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
